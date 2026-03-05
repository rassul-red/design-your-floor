"""
pipeline.py — In-process async pipeline for floor plan furnishing.

Performance improvements over the original subprocess-based approach:
  1. All steps run IN-PROCESS — no subprocess.run(), no re-importing heavy libs.
  2. Room visualization, image generation, and furniture location run as a
     STREAMING PIPELINE: as soon as one room's PNG is ready, its gen + locate
     tasks fire immediately — no waiting for all rooms to finish step 1 first.
  3. Gemini client is initialised ONCE at module load and reused across all jobs.
  4. matplotlib is imported once (Agg backend) and reused.
  5. Uses asyncio + ThreadPoolExecutor so the FastAPI event loop is never blocked.
"""

from __future__ import annotations

import asyncio
import copy
import io
import json
import logging
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches

from dotenv import load_dotenv
from google import genai
from google.genai import types as genai_types
from PIL import Image
from shapely.geometry import shape as shp_shape

load_dotenv()

# ── Shared Gemini client (created once, reused forever) ───────────────────────
API_KEY = os.environ.get("GEMINI_API_KEY")
if not API_KEY:
    raise EnvironmentError("GEMINI_API_KEY not set. Add it to .env or export it.")

gemini_client = genai.Client(api_key=API_KEY)

log = logging.getLogger("pipeline")

_HERE = Path(__file__).resolve().parent

import gen_config as cfg
from visualize_rooms import (
    draw_room, iter_polys, load_geom, compute_scale,
    ROOM_CATEGORIES, ROOM_COLORS, build_room_json,
)
from resplan_utils import plot_plan_furnished

PROMPT_BY_ROOM_FILE = _HERE / "prompt_by_room.txt"
LOCATE_PROMPT_FILE  = _HERE / "locate_furniture_prompt.txt"

IMAGE_EXTS = {".png", ".jpg", ".jpeg"}

# ── Thread pool shared across all jobs ────────────────────────────────────────
# Sized to allow plenty of concurrent Gemini calls.
_pool = ThreadPoolExecutor(max_workers=24)


# ═══════════════════════════════════════════════════════════════════════════════
#  Step 1: Visualize rooms  (was visualize_rooms.py via subprocess)
# ═══════════════════════════════════════════════════════════════════════════════

def _compute_crop_bounds(room_poly, walls_geom, doors_geom, windows_geom,
                         front_doors_geom, wall_depth, pad):
    from shapely.ops import unary_union
    clip_region = room_poly.buffer(wall_depth * 1.2)
    proximity = wall_depth * 0.6

    def _touching(geom):
        if geom is None:
            return []
        out = []
        for p in iter_polys(geom):
            if room_poly.distance(p) < proximity:
                try:
                    c = geom.intersection(clip_region) if hasattr(geom, 'intersection') else p.intersection(clip_region)
                except Exception:
                    c = None
                if c is not None and not c.is_empty:
                    out.append(c)
                elif p is not None and not p.is_empty:
                    out.append(p)
        return out

    clipped_walls = _touching(walls_geom)
    all_geoms = ([room_poly] + clipped_walls
                 + _touching(doors_geom)
                 + _touching(windows_geom)
                 + _touching(front_doors_geom))
    crop_union = unary_union(all_geoms)
    minx, miny, maxx, maxy = crop_union.bounds
    return minx - pad, miny - pad, maxx + pad, maxy + pad


def visualize_one_room(
    plan: dict, room_poly, room_key: str, room_index: int | None,
    walls_geom, doors_geom, windows_geom, frontdoors_geom,
    scale: float, wall_depth: float, padding: float,
    out_dir: Path, plan_id,
) -> tuple[str, str]:
    """Render one room PNG + JSON. Returns (label, json_path)."""
    suffix = f"_{room_index}" if room_index else ""
    label = f"{room_key}{suffix}"

    cb = _compute_crop_bounds(room_poly, walls_geom, doors_geom, windows_geom,
                              frontdoors_geom, wall_depth, padding)
    crop_bounds = {"minx": cb[0], "miny": cb[1], "maxx": cb[2], "maxy": cb[3], "pad": padding}

    # PNG
    fig, ax = plt.subplots(figsize=(7, 7))
    fig.patch.set_facecolor("white")
    draw_room(ax=ax, room_poly=room_poly, room_key=room_key,
              walls_geom=walls_geom, doors_geom=doors_geom,
              windows_geom=windows_geom, front_doors_geom=frontdoors_geom,
              scale=scale, pad=padding, wall_depth=wall_depth)
    room_area_m2 = room_poly.area * scale ** 2
    ax.set_title(f"Plan #{plan_id} — {room_key.replace('_',' ').title()} ({room_area_m2:.1f} m²)",
                 fontsize=11, fontweight="bold", pad=8)
    png_path = out_dir / f"plan_{plan_id}_{label}.png"
    fig.savefig(str(png_path), dpi=130, bbox_inches="tight", facecolor="white")
    plt.close(fig)

    # JSON
    room_json = build_room_json(
        plan=plan, room_poly=room_poly, room_key=room_key,
        room_index=room_index if room_index else None,
        walls_geom=walls_geom, doors_geom=doors_geom,
        windows_geom=windows_geom, front_doors_geom=frontdoors_geom,
        scale=scale, wall_depth=wall_depth, crop_bounds=crop_bounds,
    )
    json_path = out_dir / f"plan_{plan_id}_{label}.json"
    json_path.write_text(json.dumps(room_json, indent=2))

    return label, str(json_path)


def visualize_all_rooms(plan: dict, out_dir: Path, padding: float = 6.0):
    """
    Synchronous: generate all per-room PNGs + JSONs.
    Returns dict: {room_label: json_path}.
    """
    plan_id = plan.get("id", "unknown")
    scale = plan.get("scale") or compute_scale(plan)
    walls_geom = load_geom(plan, "wall")
    doors_geom = load_geom(plan, "door")
    windows_geom = load_geom(plan, "window")
    frontdoors_geom = load_geom(plan, "front_door")
    wall_depth = float(plan.get("wall_depth") or 5.0)
    out_dir.mkdir(parents=True, exist_ok=True)

    results = {}
    for room_key in ROOM_CATEGORIES:
        room_geom = load_geom(plan, room_key)
        if room_geom is None:
            continue
        parts = list(iter_polys(room_geom))
        multi = len(parts) > 1
        for idx, room_poly in enumerate(parts, start=1):
            index = idx if multi else None
            label, json_path = visualize_one_room(
                plan, room_poly, room_key, index,
                walls_geom, doors_geom, windows_geom, frontdoors_geom,
                scale, wall_depth, padding, out_dir, plan_id,
            )
            results[label] = json_path
    return results


# ═══════════════════════════════════════════════════════════════════════════════
#  Step 2: Generate furnished room images  (was gen_run_rooms.py via subprocess)
# ═══════════════════════════════════════════════════════════════════════════════

def _pil_to_bytes(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _call_gen_model(model: str, contents: list) -> Image.Image:
    response = gemini_client.models.generate_content(
        model=model,
        contents=contents,
        config=genai_types.GenerateContentConfig(
            image_config=genai_types.ImageConfig(
                aspect_ratio=cfg.ASPECT_RATIO,
                image_size=cfg.IMAGE_SIZE,
            ),
            temperature=cfg.TEMPERATURE,
        ),
    )
    for part in response.candidates[0].content.parts:
        if part.inline_data:
            return Image.open(io.BytesIO(part.inline_data.data))
    raise RuntimeError(f"No image returned by {model}")


def generate_one_image(image_path: Path, model: str, model_label: str,
                       prompt: str, out_dir: Path) -> str:
    """Generate one furnished room image. Returns output path."""
    pil_img = Image.open(image_path).convert("RGB")
    img_bytes = _pil_to_bytes(pil_img)
    contents = [
        genai_types.Part.from_bytes(data=img_bytes, mime_type="image/png"),
        prompt,
    ]
    result = _call_gen_model(model, contents)
    ext = "jpg" if cfg.OUTPUT_FORMAT == "image/jpeg" else "png"
    out_path = out_dir / f"{image_path.stem}_{model_label}.{ext}"
    result.save(str(out_path))
    return str(out_path)


def generate_images_for_room(room_png: Path, out_dir: Path, prompt: str) -> list[str]:
    """Generate images for one room from both models. Returns list of output paths."""
    out_dir.mkdir(parents=True, exist_ok=True)
    outputs = []
    for model, label in [(cfg.MODEL_A, cfg.MODEL_A_LABEL),
                          (cfg.MODEL_B, cfg.MODEL_B_LABEL)]:
        try:
            p = generate_one_image(room_png, model, label, prompt, out_dir)
            outputs.append(p)
            log.info("  [gen] %s + %s → %s", room_png.name, label, p)
        except Exception as e:
            log.error("  [gen] %s + %s FAILED: %s", room_png.name, label, e)
    return outputs


# ═══════════════════════════════════════════════════════════════════════════════
#  Step 3: Locate furniture  (was locate_furniture.py via subprocess)
# ═══════════════════════════════════════════════════════════════════════════════

DEFAULT_GEMINI_MODEL = "gemini-3.1-pro-preview"
DEFAULT_MODEL_LABEL  = "banana-2"


def _extract_json(text: str) -> str:
    m = re.search(r'<json>\s*(.*?)\s*</json>', text, flags=re.DOTALL)
    if m:
        return m.group(1).strip()
    text = text.strip()
    text = re.sub(r'^```(?:json)?\s*', '', text, flags=re.MULTILINE)
    text = re.sub(r'```\s*$', '', text, flags=re.MULTILINE)
    return text.strip()


def _fracs_to_plan_coords(item: dict, room_bounds: dict) -> dict:
    minx, miny = room_bounds["minx"], room_bounds["miny"]
    maxx, maxy = room_bounds["maxx"], room_bounds["maxy"]
    dx, dy = maxx - minx, maxy - miny
    x_plan = minx + item["x_frac"] * dx
    y_plan = maxy - item["y_frac"] * dy
    w_plan = item.get("w_frac", 0.0) * dx
    h_plan = item.get("h_frac", 0.0) * dy
    return {
        "x_coord": round(x_plan, 4), "y_coord": round(y_plan, 4),
        "width_coord": round(w_plan, 4), "height_coord": round(h_plan, 4),
    }


def _coords_to_metres(coords: dict, scale: float) -> dict:
    x, y = coords["x_coord"], coords["y_coord"]
    w, h = coords["width_coord"], coords["height_coord"]
    return {
        "center_x_m": round(x * scale, 4), "center_y_m": round(y * scale, 4),
        "width_m": round(w * scale, 4), "height_m": round(h * scale, 4),
        "bbox_m": {
            "x": round((x - w / 2) * scale, 4), "y": round((y - h / 2) * scale, 4),
            "w": round(w * scale, 4), "h": round(h * scale, 4),
        },
    }


def locate_furniture_in_room(
    room_label: str, room_json: dict, img_path: str,
    prompt_template: str, model: str = DEFAULT_GEMINI_MODEL,
) -> list[dict]:
    """Call Gemini vision for one room. Returns list of furniture items."""
    scale = room_json.get("scale", 0.033)
    room_type = room_json.get("room_type", room_label.rstrip("_0123456789"))
    area_m2 = room_json.get("room_area_m2", 0.0)

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
        log.warning("[%s] No room_bounds — skipping", room_label)
        return []

    def _count_polys(geom_raw):
        if not geom_raw:
            return 0
        try:
            return sum(1 for _ in iter_polys(shp_shape(geom_raw)))
        except Exception:
            return 0

    bed_w_frac = (1.6 / room_w_m) if room_w_m > 0 else 0.5
    prompt_text = prompt_template.format(
        room_type=room_type, area_m2=area_m2,
        room_w_m=room_w_m, room_h_m=room_h_m,
        wall_count=_count_polys(room_json.get("wall")),
        door_count=_count_polys(room_json.get("door")),
        window_count=_count_polys(room_json.get("window")),
        bed_w_frac=bed_w_frac,
        room_minx_m=round(room_bounds["minx"] * scale, 3),
        room_miny_m=round(room_bounds["miny"] * scale, 3),
        room_maxx_m=round(room_bounds["maxx"] * scale, 3),
        room_maxy_m=round(room_bounds["maxy"] * scale, 3),
    )

    with open(img_path, "rb") as f:
        img_bytes = f.read()

    t0 = time.time()
    try:
        response = gemini_client.models.generate_content(
            model=model,
            contents=[
                genai_types.Part.from_bytes(data=img_bytes, mime_type="image/png"),
                prompt_text,
            ],
            config=genai_types.GenerateContentConfig(temperature=0.2),
        )
        raw_text = response.candidates[0].content.parts[0].text
        log.info("[%s] Gemini locate responded in %.1fs", room_label, time.time() - t0)
        clean = _extract_json(raw_text)
        items = json.loads(clean)
        if not isinstance(items, list):
            raise ValueError(f"Expected JSON array, got {type(items).__name__}")
    except Exception as exc:
        log.error("[%s] Gemini locate FAILED after %.1fs — %s", room_label, time.time() - t0, exc)
        return []

    result = []
    for idx, item in enumerate(items):
        if not isinstance(item, dict) or not all(k in item for k in ("x_frac", "y_frac")):
            continue
        coords = _fracs_to_plan_coords(item, room_bounds)
        metres = _coords_to_metres(coords, scale)
        result.append({"id": idx, "type": str(item.get("type", "unknown")).lower(), **coords, **metres})
    return result


# ═══════════════════════════════════════════════════════════════════════════════
#  Full pipeline — streaming / pipelined approach
# ═══════════════════════════════════════════════════════════════════════════════

async def run_pipeline(
    plan: dict,
    workspace: Path,
    plan_id: int,
    on_progress: Any = None,
) -> Path:
    """
    Run the full furnishing pipeline, returning the path to the final JSON.

    Key speed improvements:
      • All code runs IN-PROCESS (no subprocess spawning).
      • As soon as a room PNG is ready, its gen+locate tasks start immediately
        (streaming pipeline rather than waterfall).
      • All Gemini API calls run concurrently via thread pool.
    """
    loop = asyncio.get_event_loop()

    rooms_dir     = workspace / "room_views"
    gen_dir       = workspace / "gen_output"
    furnished_dir = workspace / "furnished"
    for d in (rooms_dir, gen_dir, furnished_dir):
        d.mkdir(parents=True, exist_ok=True)

    # Load prompts once
    gen_prompt    = PROMPT_BY_ROOM_FILE.read_text(encoding="utf-8").strip()
    locate_prompt = LOCATE_PROMPT_FILE.read_text(encoding="utf-8")

    # ── Step 1: visualize all rooms (CPU-bound, fast) ─────────────────────────
    t0 = time.time()
    log.info("[pipeline] Step 1: visualize rooms")
    room_jsons = await loop.run_in_executor(
        _pool, visualize_all_rooms, plan, rooms_dir
    )
    log.info("[pipeline] Step 1 done in %.1fs — %d rooms", time.time() - t0, len(room_jsons))

    if not room_jsons:
        raise RuntimeError("No rooms found in plan")

    # ── Steps 2+3: streaming pipeline per room ───────────────────────────────
    # For each room, fire gen → locate concurrently across all rooms.
    t1 = time.time()
    log.info("[pipeline] Steps 2+3: generate images + locate furniture (streaming)")

    furniture_by_room: dict[str, list] = {}

    async def process_one_room(room_label: str, json_path: str):
        """Gen images for one room, then locate furniture — runs concurrently."""
        room_png = rooms_dir / f"plan_{plan_id}_{room_label}.png"
        if not room_png.exists():
            log.warning("[%s] No PNG found, skipping", room_label)
            return

        # Step 2: generate furnished images (2 models, parallel in thread pool)
        gen_outputs = await loop.run_in_executor(
            _pool, generate_images_for_room, room_png, gen_dir, gen_prompt
        )
        if not gen_outputs:
            log.warning("[%s] No generated images", room_label)
            return

        # Step 3: locate furniture using the first generated image
        # Use the preferred model label
        img_for_locate = None
        for gp in gen_outputs:
            if DEFAULT_MODEL_LABEL in gp:
                img_for_locate = gp
                break
        if img_for_locate is None:
            img_for_locate = gen_outputs[0]

        with open(json_path) as f:
            room_json = json.load(f)

        items = await loop.run_in_executor(
            _pool, locate_furniture_in_room,
            room_label, room_json, img_for_locate, locate_prompt,
        )
        furniture_by_room[room_label] = items
        log.info("[%s] Done — %d furniture items", room_label, len(items))

    # Fire all rooms concurrently
    tasks = [
        process_one_room(label, jp)
        for label, jp in room_jsons.items()
    ]
    await asyncio.gather(*tasks)
    log.info("[pipeline] Steps 2+3 done in %.1fs", time.time() - t1)

    # ── Save per-room furnished JSONs ─────────────────────────────────────────
    for room_label, json_path in room_jsons.items():
        with open(json_path) as f:
            room_json = json.load(f)
        room_json["furniture"] = furniture_by_room.get(room_label, [])
        out_json = furnished_dir / f"plan_{plan_id}_{room_label}.json"
        out_json.write_text(json.dumps(room_json, indent=2))

    # ── Build full furnished plan JSON ────────────────────────────────────────
    scale = plan.get("scale") or compute_scale(plan)
    output_plan = copy.deepcopy(plan)
    output_plan["furniture"] = {
        k: v for k, v in furniture_by_room.items() if v
    }

    final_json = furnished_dir / f"plan_{plan_id}_furnished.json"
    final_json.write_text(json.dumps(output_plan, indent=2))
    log.info("[pipeline] Furnished plan saved → %s", final_json)

    # ── Render full plan PNG (optional, non-blocking) ─────────────────────────
    try:
        def _render_full():
            fig, ax = plt.subplots(figsize=(10, 10))
            fig.patch.set_facecolor("white")
            plot_plan_furnished(
                plan=output_plan,
                furniture=output_plan["furniture"],
                scale=scale, ax=ax, legend=True,
                title=f"Plan #{plan_id} — furnished",
            )
            png_path = furnished_dir / f"plan_{plan_id}_furnished.png"
            fig.savefig(str(png_path), dpi=130, bbox_inches="tight", facecolor="white")
            plt.close(fig)
            return str(png_path)

        png_path = await loop.run_in_executor(_pool, _render_full)
        log.info("[pipeline] Full plan PNG → %s", png_path)
    except Exception as exc:
        log.warning("[pipeline] Full plan PNG failed: %s", exc)

    total_items = sum(len(v) for v in furniture_by_room.values())
    log.info("[pipeline] COMPLETE — %d rooms, %d total furniture items, %.1fs total",
             len(room_jsons), total_items, time.time() - t0)

    return final_json
