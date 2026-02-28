"""
combine_rooms.py — Merge per-room detect_rooms.py detections into a furnished plan JSON.

For each room's detect_output/*_detected.json, uses Gemini (text API) to understand
the spatial relationship between pixel-space detected features and the plan's real-world
coordinate geometry, then converts furniture bounding boxes to metre coordinates.

The output plan JSON is identical to the original plan.json except for one new top-level
key added:
  "furniture": {
      "bedroom":   [ {"id": ..., "type": ..., "center_x_m": ..., ...}, ... ],
      "bathroom_1": [ ... ],
      ...
  }

All rooms are processed in parallel via ThreadPoolExecutor.

Usage:
    python combine_rooms.py 7031
    python combine_rooms.py 7031 --detect-dir detect_output/ --plans-dir examples/
    python combine_rooms.py          # auto-detect plan_id from detect_output/
    python combine_rooms.py 7031 --model gemini-2.5-pro
"""

import argparse
import copy
import glob as _glob
import json
import math
import os
import re
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from dotenv import load_dotenv
from google import genai
from google.genai import types as genai_types
from shapely.geometry import shape, MultiPolygon, Polygon, GeometryCollection
from shapely.ops import unary_union

load_dotenv()

API_KEY = os.environ.get("GEMINI_API_KEY")
if not API_KEY:
    raise EnvironmentError("GEMINI_API_KEY not set. Add it to .env or export it.")

client = genai.Client(api_key=API_KEY)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

DEFAULT_DETECT_DIR = "detect_output"
DEFAULT_PLANS_DIR  = "examples"
DEFAULT_OUT_DIR    = "furnished_output"
DEFAULT_TEXT_MODEL = "gemini-2.5-flash-preview-04-17"

ROOM_CATEGORIES = [
    "living", "bedroom", "bathroom", "kitchen",
    "balcony", "storage", "veranda", "garden", "stair",
]

# ---------------------------------------------------------------------------
# Geometry helpers (mirrors visualize_rooms.py)
# ---------------------------------------------------------------------------

def load_geom(plan: dict, key: str):
    """Return a shapely geometry or None for a plan key."""
    raw = plan.get(key)
    if raw is None:
        return None
    try:
        g = shape(raw)
        return None if g.is_empty else g
    except Exception:
        return None


def iter_polys(geom):
    """Yield individual Polygon objects from any geometry type."""
    if geom is None:
        return
    if isinstance(geom, Polygon):
        if not geom.is_empty:
            yield geom
    elif isinstance(geom, (MultiPolygon, GeometryCollection)):
        for g in geom.geoms:
            yield from iter_polys(g)


def compute_scale(plan: dict) -> float:
    """
    Derive metres-per-coordinate-unit from the plan's `area` (m²) and the
    sum of room polygon areas in coordinate² units.
    Falls back to 0.033 m/unit if area is missing or zero.
    Mirrors visualize_rooms.py logic exactly.
    """
    area_m2 = plan.get("area", 0.0)
    if not area_m2:
        return 0.033

    total_coord2 = 0.0
    for key in ROOM_CATEGORIES:
        g = load_geom(plan, key)
        if g is not None:
            total_coord2 += g.area

    if total_coord2 <= 0:
        return 0.033

    return math.sqrt(area_m2 / total_coord2)


def filter_near_room(geom, room_poly: Polygon, wall_depth: float) -> list:
    """
    Return a list of element dicts (bbox in plan coords) for elements
    within proximity of the room polygon. Mirrors visualize_rooms.py filtering.
    """
    if geom is None:
        return []
    proximity = wall_depth * 0.6
    result = []
    for i, poly in enumerate(iter_polys(geom)):
        if room_poly.distance(poly) < proximity:
            minx, miny, maxx, maxy = poly.bounds
            result.append({
                "id":      i,
                "bbox":    {"minx": round(minx, 3), "miny": round(miny, 3),
                             "maxx": round(maxx, 3), "maxy": round(maxy, 3)},
                "cx":      round((minx + maxx) / 2, 3),
                "cy":      round((miny + maxy) / 2, 3),
                "w_coord": round(maxx - minx, 3),
                "h_coord": round(maxy - miny, 3),
            })
    return result


# ---------------------------------------------------------------------------
# Input discovery
# ---------------------------------------------------------------------------

def find_detected_jsons(detect_dir: str, plan_id: int) -> dict:
    """
    Find all detect_output files for plan_id.
    Returns {room_key: json_path} — prefers banana-pro model over banana-2
    when both exist for the same room.
    """
    pattern = os.path.join(detect_dir, f"plan_{plan_id}_*_detected.json")
    found = {}
    for path in sorted(_glob.glob(pattern)):
        stem = os.path.basename(path)
        m = re.match(r'^plan_\d+_(.+?)_(banana-pro|banana-2)_detected\.json$', stem)
        if not m:
            continue
        room_key  = m.group(1)
        model_tag = m.group(2)
        if room_key not in found or model_tag == "banana-pro":
            found[room_key] = path
    return found


def auto_detect_plan_id(detect_dir: str):
    """Try to infer plan_id from files in detect_dir. Returns int or None."""
    files = _glob.glob(os.path.join(detect_dir, "plan_*_detected.json"))
    ids = set()
    for f in files:
        m = re.match(r'plan_(\d+)_', os.path.basename(f))
        if m:
            ids.add(int(m.group(1)))
    if len(ids) == 1:
        return ids.pop()
    if ids:
        print(f"Multiple plan IDs found: {sorted(ids)}. "
              f"Specify one as a positional argument.", file=sys.stderr)
    return None


# ---------------------------------------------------------------------------
# Gemini prompt + call
# ---------------------------------------------------------------------------

_PROMPT_TEMPLATE = """\
You are a floor plan analyst. Your task is to convert furniture bounding boxes \
from image pixel coordinates to real-world metre coordinates.

=== ROOM CONTEXT ===
Room type        : {room_type}
Image size       : {img_w}×{img_h} pixels
Coordinate scale : {scale_m:.6f} metres per plan-coordinate unit

=== ROOM POLYGON (plan coordinates — real-world geometry) ===
Exterior vertices (sampled): {room_coords_json}

Room bounding box (plan coords):
  minx={minx:.3f}  miny={miny:.3f}  maxx={maxx:.3f}  maxy={maxy:.3f}
Approximate real size: {room_w_m:.2f} m wide × {room_h_m:.2f} m tall

=== STRUCTURAL ELEMENTS NEAR THIS ROOM (plan coordinates) ===
Walls   : {plan_walls_json}
Doors   : {plan_doors_json}
Windows : {plan_windows_json}

=== DETECTED FROM RENDERED IMAGE (pixel coordinates, 0–{img_w}) ===
Detected walls   : {det_walls_json}
Detected doors   : {det_doors_json}
Detected windows : {det_windows_json}

=== FURNITURE TO CONVERT (pixel coordinates) ===
{furniture_json}

=== TASK ===
The rendered image was produced by fitting the room's bounding box (including
surrounding walls) into a {img_w}×{img_h} pixel canvas. The exact crop may
include a padding margin and a legend, so the literal pixel-to-coord mapping
is not a simple division. Use the detected walls/doors/windows as anchor
points to identify the best-fit linear transform:

  plan_x = offset_x + scale_px_x * pixel_x
  plan_y = offset_y + scale_px_y * pixel_y

Important: the y-axis is often flipped (image pixels increase downward;
plan coordinates may increase upward).

Steps:
1. Match detected structural elements (walls/doors/windows, in pixels) to the
   plan's structural elements (plan coordinates). Use these correspondences to
   estimate offset_x, scale_px_x, offset_y, scale_px_y.
2. Apply the transform to each furniture item's bounding box to get plan coords.
3. Multiply plan coordinates by {scale_m:.6f} to convert to metres.
4. Return ONLY a valid JSON array — no prose, no markdown, no code fences.

Output schema (one entry per furniture item):
[
  {{
    "id": 0,
    "type": "bed",
    "center_x_m": 1.5,
    "center_y_m": 2.3,
    "width_m": 1.8,
    "height_m": 2.0,
    "bbox_m": {{"x": 0.6, "y": 1.3, "w": 1.8, "h": 2.0}}
  }}
]

If there is no furniture to convert, return an empty array: []
"""


def _strip_fences(text: str) -> str:
    """Remove markdown code fences that Gemini sometimes adds."""
    text = text.strip()
    text = re.sub(r'^```(?:json)?\s*', '', text, flags=re.MULTILINE)
    text = re.sub(r'```\s*$', '', text, flags=re.MULTILINE)
    return text.strip()


def _simplify_det_walls(walls: list) -> str:
    out = []
    for w in walls[:15]:
        out.append({
            "id": w.get("id"), "orient": w.get("orientation"),
            "x1": w.get("x1"), "y1": w.get("y1"),
            "x2": w.get("x2"), "y2": w.get("y2"),
            "len_px": w.get("length_px"),
        })
    return json.dumps(out)


def _simplify_det_openings(items: list) -> str:
    out = []
    for it in items[:8]:
        b = it.get("bbox", {})
        out.append({
            "id": it.get("id"),
            "cx_px": it.get("center_x"), "cy_px": it.get("center_y"),
            "w_px": b.get("w"), "h_px": b.get("h"),
        })
    return json.dumps(out)


def _simplify_furniture(items: list) -> str:
    out = []
    for it in items:
        b = it.get("bbox", {})
        out.append({
            "id":    it.get("id"),
            "type":  it.get("type", "unknown"),
            "cx_px": it.get("center_x"), "cy_px": it.get("center_y"),
            "x_px":  b.get("x"), "y_px": b.get("y"),
            "w_px":  b.get("w"), "h_px": b.get("h"),
        })
    return json.dumps(out, indent=2)


def call_gemini_for_room(
    room_key: str,
    detected: dict,
    plan: dict,
    room_poly: Polygon,
    scale_m: float,
    model: str,
) -> list:
    """
    Call Gemini to convert pixel-space furniture for one room to metres.
    Returns list of furniture dicts (empty on failure or no furniture).
    """
    wall_depth = float(plan.get("wall_depth") or 5.0)

    plan_walls   = filter_near_room(load_geom(plan, "wall"),       room_poly, wall_depth)
    plan_doors   = filter_near_room(load_geom(plan, "door"),       room_poly, wall_depth)
    plan_windows = filter_near_room(load_geom(plan, "window"),     room_poly, wall_depth)
    # front_door treated as door for distance matching
    for fd in filter_near_room(load_geom(plan, "front_door"), room_poly, wall_depth):
        fd["is_front"] = True
        plan_doors.append(fd)

    minx, miny, maxx, maxy = room_poly.bounds
    room_w_m = (maxx - minx) * scale_m
    room_h_m = (maxy - miny) * scale_m

    img_w = detected.get("image_size", {}).get("width",  1024)
    img_h = detected.get("image_size", {}).get("height", 1024)

    # Sample room polygon exterior (keep prompt concise)
    coords = list(room_poly.exterior.coords)
    if len(coords) > 30:
        step = max(1, len(coords) // 30)
        coords = coords[::step]
    room_coords_json = json.dumps([[round(x, 2), round(y, 2)] for x, y in coords])

    prompt = _PROMPT_TEMPLATE.format(
        room_type        = room_key,
        img_w            = img_w,
        img_h            = img_h,
        scale_m          = scale_m,
        room_coords_json = room_coords_json,
        minx=minx, miny=miny, maxx=maxx, maxy=maxy,
        room_w_m         = room_w_m,
        room_h_m         = room_h_m,
        plan_walls_json  = json.dumps(plan_walls[:20]),
        plan_doors_json  = json.dumps(plan_doors),
        plan_windows_json= json.dumps(plan_windows),
        det_walls_json   = _simplify_det_walls(detected.get("walls",   [])),
        det_doors_json   = _simplify_det_openings(detected.get("doors",   [])),
        det_windows_json = _simplify_det_openings(detected.get("windows", [])),
        furniture_json   = _simplify_furniture(detected.get("furniture", [])),
    )

    try:
        response = client.models.generate_content(
            model=model,
            contents=prompt,
            config=genai_types.GenerateContentConfig(temperature=0.2),
        )
        raw_text = response.candidates[0].content.parts[0].text
        clean    = _strip_fences(raw_text)
        result   = json.loads(clean)
        if not isinstance(result, list):
            raise ValueError(f"Expected JSON array, got {type(result).__name__}")
        return result
    except Exception as exc:
        print(f"  WARNING [{room_key}]: Gemini call failed — {exc}", file=sys.stderr)
        return []


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------

def process_plan(
    plan_id: int,
    detect_dir: str,
    plans_dir: str,
    out_dir: str,
    model: str,
) -> "Path | None":
    """Run the full pipeline for one plan_id. Returns output path or None."""

    # 1. Load original plan JSON
    plan_path = os.path.join(plans_dir, f"plan_{plan_id}.json")
    if not os.path.isfile(plan_path):
        print(f"ERROR: plan JSON not found: {plan_path}", file=sys.stderr)
        return None

    with open(plan_path) as f:
        plan = json.load(f)

    scale_m    = compute_scale(plan)
    wall_depth = float(plan.get("wall_depth") or 5.0)
    print(f"\nPlan {plan_id}  |  area={plan.get('area', 0):.2f} m²  |  "
          f"scale={scale_m:.5f} m/unit  |  wall_depth={wall_depth:.2f}")

    # 2. Discover per-room detection files
    detected_files = find_detected_jsons(detect_dir, plan_id)
    if not detected_files:
        print(f"ERROR: no *_detected.json files for plan {plan_id} in {detect_dir}/",
              file=sys.stderr)
        return None

    print(f"  Rooms found: {sorted(detected_files.keys())}")

    # 3. Build jobs: map room_key → (detected_dict, room_poly)
    jobs = {}
    for room_key, json_path in sorted(detected_files.items()):
        with open(json_path) as f:
            detected = json.load(f)

        # Strip numeric suffix to get the plan.json key (e.g., "bathroom_1" → "bathroom")
        base_key  = re.sub(r'_\d+$', '', room_key)
        room_geom = load_geom(plan, base_key)
        if room_geom is None:
            print(f"  WARN: no polygon for '{base_key}' in plan — skipping {room_key}")
            continue

        # If plan has multiple polygons for this room type, pick by suffix index
        parts = list(iter_polys(room_geom))
        m = re.search(r'_(\d+)$', room_key)
        if m and len(parts) >= int(m.group(1)):
            room_poly = parts[int(m.group(1)) - 1]
        else:
            room_poly = max(parts, key=lambda p: p.area)

        furniture = detected.get("furniture", [])
        if not furniture:
            print(f"  [{room_key}] 0 furniture items — skipping Gemini call")
            jobs[room_key] = None          # placeholder so we track it
        else:
            jobs[room_key] = (detected, room_poly)

    # 4. Launch Gemini calls in parallel for rooms that have furniture
    active_jobs = {k: v for k, v in jobs.items() if v is not None}
    furniture_by_room = {k: [] for k in jobs}   # pre-fill with empty lists

    if active_jobs:
        print(f"\n  Calling Gemini ({model}) for "
              f"{len(active_jobs)} room(s) in parallel...")

        with ThreadPoolExecutor(max_workers=len(active_jobs)) as pool:
            futures = {}
            for room_key, (detected, room_poly) in active_jobs.items():
                fut = pool.submit(
                    call_gemini_for_room,
                    room_key, detected, plan, room_poly, scale_m, model,
                )
                futures[fut] = room_key

            for future in as_completed(futures):
                room_key = futures[future]
                try:
                    result = future.result()
                    furniture_by_room[room_key] = result
                    print(f"  [{room_key}] → {len(result)} furniture item(s)")
                except Exception as exc:
                    print(f"  [{room_key}] ERROR: {exc}", file=sys.stderr)
    else:
        print("  No rooms with detected furniture — output will have empty furniture.")

    # 5. Build output: deep-copy original plan + add "furniture" key
    output_plan = copy.deepcopy(plan)
    output_plan["furniture"] = furniture_by_room

    # 6. Save
    os.makedirs(out_dir, exist_ok=True)
    out_path = Path(out_dir) / f"plan_{plan_id}_furnished.json"
    with open(out_path, "w") as f:
        json.dump(output_plan, f, indent=2)

    # Summary
    total_items = sum(len(v) for v in furniture_by_room.values())
    print(f"\n{'Room':<22} {'Furniture items':>16}")
    print("-" * 40)
    for rk in sorted(furniture_by_room):
        n = len(furniture_by_room[rk])
        print(f"  {rk:<20} {n:>16}")
    print(f"  {'TOTAL':<20} {total_items:>16}")
    print(f"\nOutput → {out_path}")
    return out_path


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description=(
            "Combine per-room detect_rooms.py detections into a furnished plan JSON. "
            "Uses Gemini to convert pixel furniture positions to real-world metres."
        )
    )
    parser.add_argument(
        "plan_id", nargs="?", type=int,
        help="Plan ID (integer). If omitted, auto-detected from --detect-dir.",
    )
    parser.add_argument(
        "--detect-dir", default=DEFAULT_DETECT_DIR, metavar="DIR",
        help=f"Directory containing *_detected.json files (default: {DEFAULT_DETECT_DIR})",
    )
    parser.add_argument(
        "--plans-dir", default=DEFAULT_PLANS_DIR, metavar="DIR",
        help=f"Directory containing plan JSON files (default: {DEFAULT_PLANS_DIR})",
    )
    parser.add_argument(
        "--out-dir", default=DEFAULT_OUT_DIR, metavar="DIR",
        help=f"Output directory (default: {DEFAULT_OUT_DIR})",
    )
    parser.add_argument(
        "--model", default=DEFAULT_TEXT_MODEL, metavar="MODEL",
        help=f"Gemini text model for coordinate reasoning (default: {DEFAULT_TEXT_MODEL})",
    )
    args = parser.parse_args()

    plan_id = args.plan_id
    if plan_id is None:
        plan_id = auto_detect_plan_id(args.detect_dir)
        if plan_id is None:
            print("ERROR: Could not auto-detect plan_id. "
                  "Pass it as a positional argument.", file=sys.stderr)
            sys.exit(1)
        print(f"Auto-detected plan_id: {plan_id}")

    result = process_plan(
        plan_id    = plan_id,
        detect_dir = args.detect_dir,
        plans_dir  = args.plans_dir,
        out_dir    = args.out_dir,
        model      = args.model,
    )
    sys.exit(0 if result else 1)


if __name__ == "__main__":
    main()
