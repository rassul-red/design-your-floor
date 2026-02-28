#!/usr/bin/env python3
"""
visualize_rooms.py — Per-room PNG visualizations from a ResPlan-style JSON plan file.

For each room in the plan, outputs a cropped PNG showing:
  - The room polygon filled with its category colour
  - Adjacent doors / windows / front-doors
  - Every bounding wall segment annotated with its real-world length in metres

Usage:
    python visualize_rooms.py                              # uses default plan
    python visualize_rooms.py examples/plan_680.json
    python visualize_rooms.py examples/plan_7031.json --out-dir my_rooms --padding 8
    python visualize_rooms.py examples/plan_7031.json --scale 0.035  # override scale

The scale (metres/coordinate-unit) is auto-computed from the plan's `area` field.
Use --scale to override when the JSON has no area or for known-scale images.
"""

import argparse
import json
import math
import os
import sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.patches import FancyArrowPatch

import numpy as np
import geopandas as gpd
from shapely.geometry import shape, mapping as shapely_mapping, MultiPolygon, Polygon, GeometryCollection
from shapely.ops import unary_union

from resplan_utils import FURNITURE_COLORS

# ── default plan ──────────────────────────────────────────────────────────────
DEFAULT_PLAN = os.path.join(os.path.dirname(__file__), "examples", "plan_7031.json")

# ── visual constants ──────────────────────────────────────────────────────────
ROOM_CATEGORIES = ["living", "bedroom", "bathroom", "kitchen", "balcony",
                   "storage", "veranda", "garden", "stair"]

ROOM_COLORS = {
    "living":   "#d9d9d9",
    "bedroom":  "#66c2a5",
    "bathroom": "#fc8d62",
    "kitchen":  "#8da0cb",
    "balcony":  "#b3b3b3",
    "storage":  "#e5d8bd",
    "veranda":  "#ccebc5",
    "garden":   "#b2e2e2",
    "stair":    "#f2f2f2",
}

STRUCT_COLORS = {
    "door":       "#e78ac3",
    "window":     "#a6d854",
    "front_door": "#a63603",
    "wall":       "#888888",
}

DIM_COLOR  = "#c0392b"   # red for dimension lines
WALL_FACE  = "#aaaaaa"
WALL_EDGE  = "#333333"


# ── geometry helpers ──────────────────────────────────────────────────────────

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


def wall_dims(poly: Polygon):
    """Return (cx, cy, length, thickness, is_horizontal) for a thin wall polygon."""
    minx, miny, maxx, maxy = poly.bounds
    w = maxx - minx
    h = maxy - miny
    cx = (minx + maxx) / 2
    cy = (miny + maxy) / 2
    if w >= h:
        return cx, cy, w, h, True
    else:
        return cx, cy, h, w, False


def compute_scale(plan: dict) -> float:
    """
    Derive metres-per-coordinate-unit from the plan's `area` (m²) and the
    sum of room polygon areas in coordinate² units.
    Falls back to 0.033 m/unit if area is missing or zero.
    """
    area_m2 = plan.get("area", 0.0)
    if not area_m2:
        return 0.033

    total_px2 = 0.0
    for key in ROOM_CATEGORIES:
        g = load_geom(plan, key)
        if g is not None:
            total_px2 += g.area

    if total_px2 <= 0:
        return 0.033

    return math.sqrt(area_m2 / total_px2)


# ── per-room figure ───────────────────────────────────────────────────────────

def _clip_to_region(geom, clip_poly):
    """Intersect geom with clip_poly; return None if result is empty."""
    try:
        result = geom.intersection(clip_poly)
        return None if result.is_empty else result
    except Exception:
        return None


def _compute_crop_bounds(room_poly: Polygon, walls_geom, doors_geom,
                         windows_geom, front_doors_geom,
                         wall_depth: float, pad: float):
    """
    Compute the padded crop bounding box for a room (same logic as draw_room).
    Returns (minx, miny, maxx, maxy) in plan coordinates, with padding applied.
    """
    clip_region = room_poly.buffer(wall_depth * 1.2)
    proximity   = wall_depth * 0.6

    clipped_walls = []
    if walls_geom is not None:
        for wp in iter_polys(walls_geom):
            if room_poly.distance(wp) < proximity:
                c = _clip_to_region(wp, clip_region)
                if c is not None:
                    clipped_walls.append(c)

    def _touching(geom):
        if geom is None:
            return []
        out = []
        for p in iter_polys(geom):
            if room_poly.distance(p) < proximity:
                c = _clip_to_region(p, clip_region)
                if c is not None:
                    out.append(c)
        return out

    all_geoms = ([room_poly] + clipped_walls
                 + _touching(doors_geom)
                 + _touching(windows_geom)
                 + _touching(front_doors_geom))
    crop_union = unary_union(all_geoms)
    minx, miny, maxx, maxy = crop_union.bounds
    return minx - pad, miny - pad, maxx + pad, maxy + pad


def draw_room(ax, room_poly: Polygon, room_key: str, walls_geom,
              doors_geom, windows_geom, front_doors_geom,
              scale: float, pad: float, wall_depth: float,
              furniture: list | None = None):
    """
    Populate *ax* with one room visualisation for a single Polygon.

    Walls are filtered by actual shapely distance (< wall_depth) from the room
    polygon, then clipped to the room's boundary region so only the relevant
    portion of each wall is drawn and measured.
    """
    room_color = ROOM_COLORS.get(room_key, "#eeeeee")

    # Region used to clip walls/openings: room polygon + one wall-depth outward
    clip_region = room_poly.buffer(wall_depth * 1.2)
    # Tighter buffer used only for distance-based filtering
    proximity   = wall_depth * 0.6

    # ── identify and clip walls adjacent to this room ────────────────────────
    touching_walls = []   # list of (original_poly, clipped_poly)
    if walls_geom is not None:
        for wp in iter_polys(walls_geom):
            if room_poly.distance(wp) < proximity:
                clipped = _clip_to_region(wp, clip_region)
                if clipped is not None:
                    touching_walls.append((wp, clipped))

    # ── identify structural openings that touch this room ────────────────────
    def touching_clipped(geom):
        if geom is None:
            return []
        results = []
        for p in iter_polys(geom):
            if room_poly.distance(p) < proximity:
                c = _clip_to_region(p, clip_region)
                if c is not None:
                    results.append(c)
        return results

    t_doors      = touching_clipped(doors_geom)
    t_windows    = touching_clipped(windows_geom)
    t_frontdoors = touching_clipped(front_doors_geom)

    # ── compute crop bounds from room + clipped walls/openings ───────────────
    clipped_wall_geoms = [c for _, c in touching_walls]
    all_geoms  = [room_poly] + clipped_wall_geoms + t_doors + t_windows + t_frontdoors
    crop_union = unary_union(all_geoms)
    minx, miny, maxx, maxy = crop_union.bounds
    minx -= pad;  miny -= pad
    maxx += pad;  maxy += pad

    # ── draw room fill ────────────────────────────────────────────────────────
    gpd.GeoSeries([room_poly]).plot(ax=ax, color=room_color, edgecolor="none", zorder=1)

    # ── draw walls (clipped versions) ────────────────────────────────────────
    if clipped_wall_geoms:
        # Flatten into individual polygons (clipping may produce MultiPolygon)
        flat = []
        for cg in clipped_wall_geoms:
            flat.extend(iter_polys(cg))
        if flat:
            gpd.GeoSeries(flat).plot(
                ax=ax, color=WALL_FACE, edgecolor=WALL_EDGE, linewidth=0.6, zorder=2
            )

    # ── draw structural openings ──────────────────────────────────────────────
    for polys, key in [(t_doors, "door"), (t_windows, "window"),
                       (t_frontdoors, "front_door")]:
        if polys:
            flat = []
            for p in polys:
                flat.extend(iter_polys(p))
            if flat:
                gpd.GeoSeries(flat).plot(
                    ax=ax, color=STRUCT_COLORS[key], edgecolor="black",
                    linewidth=0.5, alpha=0.85, zorder=3
                )

    # ── dimension annotations (use clipped wall bounds for length) ────────────
    rcx, rcy = room_poly.centroid.x, room_poly.centroid.y

    for _orig, clipped in touching_walls:
        # Annotate each clipped fragment individually
        for frag in iter_polys(clipped):
            cx, cy, length, thickness, horiz = wall_dims(frag)
            length_m = length * scale
            if length_m < 0.05:      # skip slivers
                continue
            minx_w, miny_w, maxx_w, maxy_w = frag.bounds

            if horiz:
                offset = thickness / 2 + pad * 0.35
                sign   = -1 if cy > rcy else 1
                ly     = cy + sign * offset
                lx1, lx2 = minx_w, maxx_w

                ax.annotate(
                    "", xy=(lx2, ly), xytext=(lx1, ly),
                    arrowprops=dict(arrowstyle="<->", color=DIM_COLOR,
                                    lw=1.0, mutation_scale=8),
                    zorder=5,
                )
                for lx in (lx1, lx2):
                    ax.plot([lx, lx], [ly - pad * 0.15, ly + pad * 0.15],
                            color=DIM_COLOR, lw=0.8, zorder=5)
                ax.text(
                    (lx1 + lx2) / 2, ly + sign * pad * 0.2,
                    f"{length_m:.2f} m",
                    ha="center", va="center",
                    fontsize=6.5, color=DIM_COLOR, fontweight="bold", zorder=6,
                    bbox=dict(boxstyle="round,pad=0.15", fc="white", ec="none", alpha=0.8),
                )
            else:
                offset = thickness / 2 + pad * 0.35
                sign   = 1 if cx > rcx else -1
                lx     = cx + sign * offset
                ly1, ly2 = miny_w, maxy_w

                ax.annotate(
                    "", xy=(lx, ly2), xytext=(lx, ly1),
                    arrowprops=dict(arrowstyle="<->", color=DIM_COLOR,
                                    lw=1.0, mutation_scale=8),
                    zorder=5,
                )
                for ly in (ly1, ly2):
                    ax.plot([lx - pad * 0.15, lx + pad * 0.15], [ly, ly],
                            color=DIM_COLOR, lw=0.8, zorder=5)
                ax.text(
                    lx + sign * pad * 0.2, (ly1 + ly2) / 2,
                    f"{length_m:.2f} m",
                    ha="center", va="center",
                    fontsize=6.5, color=DIM_COLOR, fontweight="bold",
                    rotation=90, zorder=6,
                    bbox=dict(boxstyle="round,pad=0.15", fc="white", ec="none", alpha=0.8),
                )

    # ── room area label ───────────────────────────────────────────────────────
    area_m2 = room_poly.area * scale ** 2
    rc = room_poly.centroid
    ax.text(
        rc.x, rc.y, f"{area_m2:.1f} m²",
        ha="center", va="center", fontsize=9, fontweight="bold",
        color="#222222", zorder=7,
        bbox=dict(boxstyle="round,pad=0.25", fc="white", ec="none", alpha=0.7),
    )

    # ── furniture overlay ─────────────────────────────────────────────────────
    if furniture:
        for item in furniture:
            x_c = item.get("x_coord")
            y_c = item.get("y_coord")
            w   = item.get("width_coord", 0)
            h   = item.get("height_coord", 0)
            if x_c is None or y_c is None or w <= 0 or h <= 0:
                continue
            ftype = str(item.get("type", "")).lower()
            color = FURNITURE_COLORS.get(ftype, "#cccccc")
            rect = mpatches.Rectangle(
                (x_c - w / 2, y_c - h / 2), w, h,
                facecolor=color, edgecolor="black",
                linewidth=0.5, alpha=0.75, zorder=8,
            )
            ax.add_patch(rect)
            ax.text(
                x_c, y_c, ftype,
                ha="center", va="center", fontsize=5, zorder=9,
                bbox=dict(boxstyle="round,pad=0.1", fc="white", ec="none", alpha=0.5),
            )

    # ── axes limits & appearance ──────────────────────────────────────────────
    ax.set_xlim(minx, maxx)
    ax.set_ylim(miny, maxy)
    ax.set_aspect("equal", adjustable="box")
    ax.set_axis_off()

    # ── legend ───────────────────────────────────────────────────────────────
    handles = [
        mpatches.Patch(facecolor=room_color, edgecolor="black",
                       label=room_key.replace("_", " ").title()),
    ]
    if clipped_wall_geoms:
        handles.append(mpatches.Patch(facecolor=WALL_FACE, edgecolor=WALL_EDGE,
                                      label="wall"))
    for polys, key in [(t_doors, "door"), (t_windows, "window"),
                       (t_frontdoors, "front door")]:
        if polys:
            handles.append(mpatches.Patch(
                facecolor=STRUCT_COLORS.get(key.replace(" ", "_"), "#ccc"),
                edgecolor="black", label=key,
            ))
    ax.legend(handles=handles, loc="upper left",
              bbox_to_anchor=(1.01, 1), borderaxespad=0,
              frameon=True, fontsize=8)


# ── per-room JSON ─────────────────────────────────────────────────────────────

def build_room_json(plan: dict, room_poly: Polygon, room_key: str,
                    room_index: int | None,
                    walls_geom, doors_geom, windows_geom, front_doors_geom,
                    scale: float, wall_depth: float,
                    crop_bounds: dict | None = None) -> dict:
    """
    Build a per-room dict that mirrors the original plan JSON format.

    All coordinates are in the original plan coordinate system (no shift).
    Only structural elements (walls, doors, windows, front_door) that are
    adjacent to this specific room polygon are included.
    """
    proximity = wall_depth * 0.6

    def adjacent_polys(geom):
        """Return individual polygons from *geom* that are adjacent to room_poly."""
        if geom is None:
            return []
        return [p for p in iter_polys(geom) if room_poly.distance(p) < proximity]

    def to_geojson(polys):
        """Merge a list of Polygons into a single GeoJSON geometry dict, or None."""
        if not polys:
            return None
        return shapely_mapping(unary_union(polys))

    adj_walls      = adjacent_polys(walls_geom)
    adj_doors      = adjacent_polys(doors_geom)
    adj_windows    = adjacent_polys(windows_geom)
    adj_frontdoors = adjacent_polys(front_doors_geom)

    result = {
        # ── plan-level metadata ────────────────────────────────────────────────
        "id":           plan.get("id"),
        "unitType":     plan.get("unitType"),
        "area":         plan.get("area"),
        "net_area":     plan.get("net_area"),
        "wall_depth":   plan.get("wall_depth"),
        "scale":        scale,              # metres per coordinate unit
        # ── room identity ──────────────────────────────────────────────────────
        "room_type":    room_key,
        "room_index":   room_index,         # None for single-polygon rooms
        "room_area_m2": round(room_poly.area * scale ** 2, 4),
        # ── image crop bounds (plan coordinates, with padding) ─────────────────
        "crop_bounds":  crop_bounds,        # {minx, miny, maxx, maxy, pad} or None
        # ── room polygon tight bounding box (plan coordinates, no padding) ──────
        # This is the reference frame for furniture frac→coord conversion.
        # x_frac=0 = left edge, x_frac=1 = right edge of the room polygon.
        # y_frac=0 = top edge (high plan-y), y_frac=1 = bottom edge (low plan-y).
        "room_bounds":  {
            "minx": round(room_poly.bounds[0], 6),
            "miny": round(room_poly.bounds[1], 6),
            "maxx": round(room_poly.bounds[2], 6),
            "maxy": round(room_poly.bounds[3], 6),
        },
        # ── geometries (original coordinate system) ───────────────────────────
        room_key:       shapely_mapping(room_poly),
        "wall":         to_geojson(adj_walls),
        "door":         to_geojson(adj_doors),
        "window":       to_geojson(adj_windows),
        "front_door":   to_geojson(adj_frontdoors),
    }
    return result


# ── main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Per-room PNGs with wall dimensions from a ResPlan JSON file."
    )
    parser.add_argument(
        "json_file", nargs="?", default=DEFAULT_PLAN,
        help=f"Path to plan JSON (default: {DEFAULT_PLAN})",
    )
    parser.add_argument("--out-dir",  default="room_views", metavar="DIR",
                        help="Output directory (default: room_views)")
    parser.add_argument("--scale",    type=float, default=None, metavar="M_PER_UNIT",
                        help="Metres per coordinate unit (auto-computed from area if omitted)")
    parser.add_argument("--padding",  type=float, default=6.0,  metavar="UNITS",
                        help="Padding around each room crop in coord units (default: 6)")
    parser.add_argument("--furnished-dir", default=None, metavar="DIR",
                        help="Directory with furnished per-room JSONs; when set, "
                             "furniture is overlaid on each room PNG")
    args = parser.parse_args()

    # ── load ──────────────────────────────────────────────────────────────────
    if not os.path.isfile(args.json_file):
        print(f"Error: not found: {args.json_file}", file=sys.stderr)
        sys.exit(1)
    with open(args.json_file) as f:
        plan = json.load(f)

    plan_id = plan.get("id", os.path.splitext(os.path.basename(args.json_file))[0])
    area_m2 = plan.get("area", 0.0)

    # ── scale ─────────────────────────────────────────────────────────────────
    if args.scale is not None:
        scale = args.scale
        print(f"Scale: {scale:.6f} m/unit  (from --scale)")
    else:
        scale = compute_scale(plan)
        print(f"Scale: {scale:.6f} m/unit  (auto from area={area_m2:.2f} m²)")

    # ── preload shared geometries ─────────────────────────────────────────────
    walls_geom      = load_geom(plan, "wall")
    doors_geom      = load_geom(plan, "door")
    windows_geom    = load_geom(plan, "window")
    frontdoors_geom = load_geom(plan, "front_door")

    # wall_depth used for proximity-based wall filtering
    wall_depth = float(plan.get("wall_depth") or 5.0)

    os.makedirs(args.out_dir, exist_ok=True)
    print(f"\nPlan #{plan_id}  |  {plan.get('unitType', '')}  |  {area_m2:.2f} m²")
    print(f"Wall depth: {wall_depth:.2f} units  |  Output → {args.out_dir}/\n")

    generated = 0
    for room_key in ROOM_CATEGORIES:
        room_geom = load_geom(plan, room_key)
        if room_geom is None:
            continue

        # Split MultiPolygon into individual polygons — each gets its own PNG
        parts = list(iter_polys(room_geom))
        multi = len(parts) > 1

        for idx, room_poly in enumerate(parts, start=1):
            room_area_m2 = room_poly.area * scale ** 2
            suffix = f"_{idx}" if multi else ""
            label  = f"{room_key}{suffix}"
            print(f"  {label:16s}  {room_area_m2:6.2f} m²", end="")

            # ── compute crop bounds (for JSON + optional furniture overlay) ────
            cb_minx, cb_miny, cb_maxx, cb_maxy = _compute_crop_bounds(
                room_poly, walls_geom, doors_geom, windows_geom,
                frontdoors_geom, wall_depth, args.padding,
            )
            crop_bounds = {
                "minx": cb_minx, "miny": cb_miny,
                "maxx": cb_maxx, "maxy": cb_maxy,
                "pad": args.padding,
            }

            # ── optional furniture from --furnished-dir ───────────────────────
            furniture = None
            if args.furnished_dir:
                furn_json_path = os.path.join(
                    args.furnished_dir, f"plan_{plan_id}_{label}.json"
                )
                if os.path.isfile(furn_json_path):
                    with open(furn_json_path) as _fj:
                        _fd = json.load(_fj)
                    furniture = _fd.get("furniture") or None

            fig, ax = plt.subplots(figsize=(7, 7))
            fig.patch.set_facecolor("white")

            draw_room(
                ax=ax,
                room_poly=room_poly,
                room_key=room_key,
                walls_geom=walls_geom,
                doors_geom=doors_geom,
                windows_geom=windows_geom,
                front_doors_geom=frontdoors_geom,
                scale=scale,
                pad=args.padding,
                wall_depth=wall_depth,
                furniture=furniture,
            )

            title_suffix = f" ({idx}/{len(parts)})" if multi else ""
            ax.set_title(
                f"Plan #{plan_id}  —  {room_key.replace('_', ' ').title()}"
                f"{title_suffix}  ({room_area_m2:.1f} m²)",
                fontsize=11, fontweight="bold", pad=8,
            )

            out_name = f"plan_{plan_id}_{label}.png"
            out_path = os.path.join(args.out_dir, out_name)
            fig.savefig(out_path, dpi=130, bbox_inches="tight", facecolor="white")
            plt.close(fig)

            # ── per-room JSON ─────────────────────────────────────────────────
            room_json = build_room_json(
                plan=plan,
                room_poly=room_poly,
                room_key=room_key,
                room_index=idx if multi else None,
                walls_geom=walls_geom,
                doors_geom=doors_geom,
                windows_geom=windows_geom,
                front_doors_geom=frontdoors_geom,
                scale=scale,
                wall_depth=wall_depth,
                crop_bounds=crop_bounds,
            )
            json_name = f"plan_{plan_id}_{label}.json"
            json_path = os.path.join(args.out_dir, json_name)
            with open(json_path, "w") as jf:
                json.dump(room_json, jf, indent=2)

            print(f"  →  {out_path}  +  {json_name}")
            generated += 1

    print(f"\n{generated} room image(s) saved to {args.out_dir}/")


if __name__ == "__main__":
    main()
