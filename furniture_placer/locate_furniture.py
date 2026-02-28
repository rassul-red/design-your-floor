#!/usr/bin/env python3
"""
locate_furniture.py — Gemini vision pipeline: find furniture in generated room images.

For each per-room JSON + generated image pair:
  1. Calls Gemini vision to identify furniture as normalised image fractions
  2. Converts fractions → plan coordinates → metres using crop_bounds from the room JSON
  3. Saves a furnished per-room JSON and a per-room PNG with furniture overlaid
  4. Merges all rooms into a full furnished plan JSON
  5. Renders a complete floor plan PNG with all furniture

Usage:
    python locate_furniture.py 7031
    python locate_furniture.py 7031 \\
        --rooms-dir   room_views/ \\
        --images-dir  gen_output/ \\
        --model-label banana-pro \\
        --out-dir     room_views_furnished/ \\
        --model       gemini-2.5-pro
"""

import argparse
import copy
import glob as _glob
import json
import os
import re
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

from dotenv import load_dotenv
from google import genai
from google.genai import types as genai_types
from shapely.geometry import shape as shp_shape, Polygon

from visualize_rooms import draw_room, iter_polys, load_geom, compute_scale, ROOM_CATEGORIES
from resplan_utils import plot_plan_furnished

load_dotenv()

API_KEY = os.environ.get("GEMINI_API_KEY")
if not API_KEY:
    raise EnvironmentError("GEMINI_API_KEY not set. Add it to .env or export it.")

client = genai.Client(api_key=API_KEY)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

DEFAULT_ROOMS_DIR   = "room_views"
DEFAULT_IMAGES_DIR  = "gen_output"
DEFAULT_MODEL_LABEL = "banana-2"
DEFAULT_OUT_DIR     = "room_views_furnished"
DEFAULT_GEMINI_MODEL = "gemini-3.1-pro-preview"   # latest Gemini vision model; use --model to override
DEFAULT_PLANS_DIR   = "examples"
PROMPT_FILE         = Path(__file__).parent / "locate_furniture_prompt.txt"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _extract_json(text: str) -> str:
    """
    Extract the JSON array from the model response.
    Prefers the <json>...</json> block the prompt requests.
    Falls back to stripping markdown fences for older-style responses.
    """
    # Preferred: <json> tag
    m = re.search(r'<json>\s*(.*?)\s*</json>', text, flags=re.DOTALL)
    if m:
        return m.group(1).strip()
    # Fallback: strip markdown fences
    text = text.strip()
    text = re.sub(r'^```(?:json)?\s*', '', text, flags=re.MULTILINE)
    text = re.sub(r'```\s*$', '', text, flags=re.MULTILINE)
    return text.strip()


def _load_prompt_template() -> str:
    if not PROMPT_FILE.exists():
        raise FileNotFoundError(f"Prompt file not found: {PROMPT_FILE}")
    return PROMPT_FILE.read_text(encoding="utf-8")


def _find_room_jsons(rooms_dir: str, plan_id: int) -> dict:
    """
    Return {room_label: json_path} for all per-room JSONs matching plan_id.
    room_label is e.g. 'bedroom', 'bathroom_1'.
    """
    pattern = os.path.join(rooms_dir, f"plan_{plan_id}_*.json")
    result = {}
    for path in sorted(_glob.glob(pattern)):
        stem = os.path.basename(path).replace(".json", "")
        m = re.match(rf'^plan_{plan_id}_(.+)$', stem)
        if m:
            result[m.group(1)] = path
    return result


def _find_image(images_dir: str, plan_id: int, room_label: str,
                model_label: str) -> str | None:
    """
    Find the generated image for a room.
    Filename convention: plan_{id}_{room_label}_{model_label}.png
    """
    name = f"plan_{plan_id}_{room_label}_{model_label}.png"
    path = os.path.join(images_dir, name)
    return path if os.path.isfile(path) else None


# ---------------------------------------------------------------------------
# Coordinate conversion
# ---------------------------------------------------------------------------

def _fracs_to_plan_coords(item: dict, room_bounds: dict) -> dict:
    """
    Convert room-polygon-relative fractions to plan coordinates.

    Reference frame: the room polygon's tight bounding box.
      x_frac=0  → left edge  of room polygon (plan minx)
      x_frac=1  → right edge of room polygon (plan maxx)
      y_frac=0  → top edge   of room polygon (plan maxy — y is flipped in image)
      y_frac=1  → bottom edge of room polygon (plan miny)

    x_plan = room_minx + x_frac * (room_maxx - room_minx)
    y_plan = room_maxy - y_frac * (room_maxy - room_miny)   # y-axis flipped
    """
    minx = room_bounds["minx"]
    miny = room_bounds["miny"]
    maxx = room_bounds["maxx"]
    maxy = room_bounds["maxy"]

    dx = maxx - minx
    dy = maxy - miny

    x_frac = item["x_frac"]
    y_frac = item["y_frac"]
    w_frac = item.get("w_frac", 0.0)
    h_frac = item.get("h_frac", 0.0)

    x_plan = minx + x_frac * dx
    y_plan = maxy - y_frac * dy          # y-axis is flipped
    w_plan = w_frac * dx
    h_plan = h_frac * dy

    return {
        "x_coord":      round(x_plan, 4),
        "y_coord":      round(y_plan, 4),
        "width_coord":  round(w_plan, 4),
        "height_coord": round(h_plan, 4),
    }


def _coords_to_metres(coords: dict, scale: float) -> dict:
    x_plan = coords["x_coord"]
    y_plan = coords["y_coord"]
    w_plan = coords["width_coord"]
    h_plan = coords["height_coord"]

    center_x_m = round(x_plan * scale, 4)
    center_y_m = round(y_plan * scale, 4)
    width_m    = round(w_plan * scale, 4)
    height_m   = round(h_plan * scale, 4)
    bbox_m = {
        "x": round((x_plan - w_plan / 2) * scale, 4),
        "y": round((y_plan - h_plan / 2) * scale, 4),
        "w": width_m,
        "h": height_m,
    }
    return {
        "center_x_m": center_x_m,
        "center_y_m": center_y_m,
        "width_m":    width_m,
        "height_m":   height_m,
        "bbox_m":     bbox_m,
    }


# ---------------------------------------------------------------------------
# Per-room Gemini call
# ---------------------------------------------------------------------------

def process_room(room_label: str, json_path: str, img_path: str,
                 prompt_template: str, model: str) -> list:
    """
    Call Gemini vision for one room image.
    Returns list of furniture item dicts with plan coords + metres, or [] on failure.
    """
    with open(json_path) as f:
        room_json = json.load(f)

    scale      = room_json.get("scale", 0.033)
    room_type  = room_json.get("room_type", room_label.rstrip("_0123456789"))
    area_m2    = room_json.get("room_area_m2", 0.0)

    # Room polygon bounds — the reference frame for frac→coord conversion.
    # Prefer the pre-computed room_bounds; fall back to computing from GeoJSON.
    room_bounds = room_json.get("room_bounds")
    room_geom_raw = room_json.get(room_type)
    room_w_m = room_h_m = 0.0
    if room_geom_raw:
        try:
            rp = shp_shape(room_geom_raw)
            rx1, ry1, rx2, ry2 = rp.bounds
            room_w_m = (rx2 - rx1) * scale
            room_h_m = (ry2 - ry1) * scale
            if not room_bounds:
                room_bounds = {"minx": rx1, "miny": ry1, "maxx": rx2, "maxy": ry2}
        except Exception:
            pass

    if not room_bounds:
        print(f"  [{room_label}] WARNING: no room_bounds — skipping", file=sys.stderr)
        return []

    # Count structural elements
    def _count_polys(geom_raw):
        if not geom_raw:
            return 0
        try:
            return sum(1 for _ in iter_polys(shp_shape(geom_raw)))
        except Exception:
            return 0

    wall_count   = _count_polys(room_json.get("wall"))
    door_count   = _count_polys(room_json.get("door"))
    window_count = _count_polys(room_json.get("window"))

    bed_w_frac = (1.6 / room_w_m) if room_w_m > 0 else 0.5
    prompt_text = prompt_template.format(
        room_type    = room_type,
        area_m2      = area_m2,
        room_w_m     = room_w_m,
        room_h_m     = room_h_m,
        wall_count   = wall_count,
        door_count   = door_count,
        window_count = window_count,
        bed_w_frac   = bed_w_frac,
        room_minx_m  = round(room_bounds["minx"] * scale, 3),
        room_miny_m  = round(room_bounds["miny"] * scale, 3),
        room_maxx_m  = round(room_bounds["maxx"] * scale, 3),
        room_maxy_m  = round(room_bounds["maxy"] * scale, 3),
    )

    with open(img_path, "rb") as f:
        img_bytes = f.read()

    try:
        response = client.models.generate_content(
            model=model,
            contents=[
                genai_types.Part.from_bytes(data=img_bytes, mime_type="image/png"),
                prompt_text,
            ],
            config=genai_types.GenerateContentConfig(temperature=0.2),
        )
        raw_text = response.candidates[0].content.parts[0].text
        clean    = _extract_json(raw_text)
        items    = json.loads(clean)
        if not isinstance(items, list):
            raise ValueError(f"Expected JSON array, got {type(items).__name__}")
    except Exception as exc:
        print(f"  [{room_label}] WARNING: Gemini call failed — {exc}", file=sys.stderr)
        return []

    # Convert fractions → plan coords + metres
    result = []
    for idx, item in enumerate(items):
        if not isinstance(item, dict):
            continue
        # Validate required fields
        if not all(k in item for k in ("x_frac", "y_frac")):
            continue
        coords  = _fracs_to_plan_coords(item, room_bounds)
        metres  = _coords_to_metres(coords, scale)
        result.append({
            "id":   idx,
            "type": str(item.get("type", "unknown")).lower(),
            **coords,
            **metres,
        })

    return result


# ---------------------------------------------------------------------------
# Per-room rendering
# ---------------------------------------------------------------------------

def render_room_png(room_json: dict, furniture: list, out_path: str) -> None:
    """Render a per-room PNG with furniture overlaid and save to out_path."""
    room_type = room_json.get("room_type", "room")
    room_geom_raw = room_json.get(room_type)
    if not room_geom_raw:
        return

    try:
        room_poly = shp_shape(room_geom_raw)
        if room_poly.is_empty:
            return
        # If MultiPolygon, pick largest part
        parts = list(iter_polys(room_poly))
        if not parts:
            return
        room_poly = max(parts, key=lambda p: p.area) if len(parts) > 1 else parts[0]
    except Exception as exc:
        print(f"  WARNING: could not load room geometry — {exc}", file=sys.stderr)
        return

    scale      = room_json.get("scale", 0.033)
    wall_depth = room_json.get("wall_depth") or 5.0
    pad        = (room_json.get("crop_bounds") or {}).get("pad", 6.0)

    walls_geom   = load_geom(room_json, "wall")
    doors_geom   = load_geom(room_json, "door")
    windows_geom = load_geom(room_json, "window")
    fd_geom      = load_geom(room_json, "front_door")

    area_m2 = room_json.get("room_area_m2", room_poly.area * scale ** 2)
    plan_id = room_json.get("id", "?")

    fig, ax = plt.subplots(figsize=(7, 7))
    fig.patch.set_facecolor("white")

    draw_room(
        ax=ax,
        room_poly=room_poly,
        room_key=room_type,
        walls_geom=walls_geom,
        doors_geom=doors_geom,
        windows_geom=windows_geom,
        front_doors_geom=fd_geom,
        scale=scale,
        pad=pad,
        wall_depth=wall_depth,
        furniture=furniture if furniture else None,
    )

    ax.set_title(
        f"Plan #{plan_id}  —  {room_type.replace('_', ' ').title()}"
        f"  ({area_m2:.1f} m²)  [furnished]",
        fontsize=11, fontweight="bold", pad=8,
    )

    fig.savefig(out_path, dpi=130, bbox_inches="tight", facecolor="white")
    plt.close(fig)


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description=(
            "Use Gemini vision to locate furniture in generated room images, "
            "convert positions to plan/metre coordinates, and build a full "
            "furnished floor plan."
        )
    )
    parser.add_argument("plan_id", nargs="?", type=int, default=7031,
                        help="Plan ID (default: 7031)")
    parser.add_argument("--rooms-dir",   default=DEFAULT_ROOMS_DIR,  metavar="DIR",
                        help=f"Per-room JSON directory (default: {DEFAULT_ROOMS_DIR})")
    parser.add_argument("--images-dir",  default=DEFAULT_IMAGES_DIR, metavar="DIR",
                        help=f"Generated room image directory (default: {DEFAULT_IMAGES_DIR})")
    parser.add_argument("--model-label", default=DEFAULT_MODEL_LABEL, metavar="LABEL",
                        help=f"Image filename suffix, e.g. banana-pro (default: {DEFAULT_MODEL_LABEL})")
    parser.add_argument("--out-dir",     default=DEFAULT_OUT_DIR,    metavar="DIR",
                        help=f"Output directory (default: {DEFAULT_OUT_DIR})")
    parser.add_argument("--model",       default=DEFAULT_GEMINI_MODEL, metavar="MODEL",
                        help=f"Gemini model (default: {DEFAULT_GEMINI_MODEL})")
    parser.add_argument("--plans-dir",   default=DEFAULT_PLANS_DIR,  metavar="DIR",
                        help=f"Full plan JSON directory (default: {DEFAULT_PLANS_DIR})")
    parser.add_argument("--padding",     type=float, default=6.0,    metavar="UNITS",
                        help="Padding used when room_views were generated (default: 6.0)")
    args = parser.parse_args()

    plan_id     = args.plan_id
    rooms_dir   = args.rooms_dir
    images_dir  = args.images_dir
    model_label = args.model_label
    out_dir     = args.out_dir
    model       = args.model

    os.makedirs(out_dir, exist_ok=True)

    # ── load prompt template ─────────────────────────────────────────────────
    prompt_template = _load_prompt_template()

    # ── discover per-room JSONs ───────────────────────────────────────────────
    room_jsons = _find_room_jsons(rooms_dir, plan_id)
    if not room_jsons:
        print(f"ERROR: no per-room JSONs found for plan {plan_id} in {rooms_dir}/",
              file=sys.stderr)
        sys.exit(1)

    print(f"\nPlan {plan_id}  |  model: {model}  |  image label: {model_label}")
    print(f"  Rooms: {sorted(room_jsons.keys())}\n")

    # ── build jobs: only rooms that have a matching image ────────────────────
    jobs = {}   # room_label → (json_path, img_path)
    for room_label, json_path in sorted(room_jsons.items()):
        img_path = _find_image(images_dir, plan_id, room_label, model_label)
        if img_path is None:
            print(f"  [{room_label}] no image found — skipping")
            continue
        jobs[room_label] = (json_path, img_path)

    if not jobs:
        print("ERROR: no matching image files found.", file=sys.stderr)
        sys.exit(1)

    # ── parallel Gemini calls ────────────────────────────────────────────────
    print(f"  Calling Gemini ({model}) for {len(jobs)} room(s) in parallel...\n")

    furniture_by_room: dict[str, list] = {}

    with ThreadPoolExecutor(max_workers=len(jobs)) as pool:
        futures = {}
        for room_label, (json_path, img_path) in jobs.items():
            fut = pool.submit(
                process_room,
                room_label, json_path, img_path, prompt_template, model,
            )
            futures[fut] = room_label

        for future in as_completed(futures):
            room_label = futures[future]
            try:
                items = future.result()
                furniture_by_room[room_label] = items
                print(f"  [{room_label}] → {len(items)} furniture item(s)")
            except Exception as exc:
                print(f"  [{room_label}] ERROR: {exc}", file=sys.stderr)
                furniture_by_room[room_label] = []

    # ── save per-room furnished JSONs + PNGs ─────────────────────────────────
    print()
    for room_label, json_path in sorted(room_jsons.items()):
        with open(json_path) as f:
            room_json = json.load(f)

        furniture = furniture_by_room.get(room_label, [])
        room_json["furniture"] = furniture

        out_json = os.path.join(out_dir, f"plan_{plan_id}_{room_label}.json")
        with open(out_json, "w") as f:
            json.dump(room_json, f, indent=2)

        out_png = os.path.join(out_dir, f"plan_{plan_id}_{room_label}.png")
        render_room_png(room_json, furniture, out_png)
        print(f"  {room_label:18s} → {out_json}  +  {os.path.basename(out_png)}")

    # ── build full furnished plan JSON ────────────────────────────────────────
    plan_path = os.path.join(args.plans_dir, f"plan_{plan_id}.json")
    if not os.path.isfile(plan_path):
        print(f"\nWARNING: full plan JSON not found at {plan_path} — "
              f"skipping full plan rendering.", file=sys.stderr)
    else:
        with open(plan_path) as f:
            full_plan = json.load(f)

        scale = full_plan.get("scale") or compute_scale(full_plan)

        # Merge furniture: room_label may include index suffix (e.g. bathroom_1).
        # Group by room_type for the full plan.
        merged_furniture: dict[str, list] = {}
        for room_label, items in furniture_by_room.items():
            if items:
                merged_furniture[room_label] = items

        output_plan = copy.deepcopy(full_plan)
        output_plan["furniture"] = merged_furniture

        out_full_json = os.path.join(out_dir, f"plan_{plan_id}_furnished.json")
        with open(out_full_json, "w") as f:
            json.dump(output_plan, f, indent=2)
        print(f"\n  Full plan  → {out_full_json}")

        # ── full plan PNG ─────────────────────────────────────────────────────
        fig, ax = plt.subplots(figsize=(10, 10))
        fig.patch.set_facecolor("white")
        try:
            plot_plan_furnished(
                plan=output_plan,
                furniture=merged_furniture,
                scale=scale,
                ax=ax,
                legend=True,
                title=f"Plan #{plan_id}  —  furnished",
            )
        except Exception as exc:
            print(f"  WARNING: full plan plot failed — {exc}", file=sys.stderr)

        out_full_png = os.path.join(out_dir, f"plan_{plan_id}_furnished.png")
        fig.savefig(out_full_png, dpi=130, bbox_inches="tight", facecolor="white")
        plt.close(fig)
        print(f"  Full plan  → {out_full_png}")

    # ── summary table ─────────────────────────────────────────────────────────
    total = sum(len(v) for v in furniture_by_room.values())
    print(f"\n{'Room':<22}  {'Items':>5}")
    print("-" * 30)
    for room_label in sorted(furniture_by_room):
        n = len(furniture_by_room[room_label])
        print(f"  {room_label:<20}  {n:>5}")
    print(f"  {'TOTAL':<20}  {total:>5}")
    print(f"\nOutput → {out_dir}/")


if __name__ == "__main__":
    main()
