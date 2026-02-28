"""
detect_plan.py — detect walls, doors, windows, and furniture from a furnished floor plan image.

Furniture colors match show_furniture.py. Structural element colors match resplan_utils.py.

Usage:
    python detect_plan.py <image_path> [--show] [--min-wall INT] [--min-area INT] [--out-dir DIR]
"""

import argparse
import json
import os
import sys

import cv2
import numpy as np


# ---------------------------------------------------------------------------
# Color definitions
# ---------------------------------------------------------------------------

# Furniture: (name, hex, room) — canonical colors from show_furniture.py
FURNITURE_ITEMS = [
    ("bed",           "#ff00ff", "bedroom"),   # fuchsia
    ("bedside_table", "#00bfff", "bedroom"),   # deepskyblue
    ("wardrobe",      "#ffff00", "bedroom"),   # yellow
    ("sofa",          "#808000", "living"),    # olive
    ("coffee_table",  "#00fa9a", "living"),    # mediumspringgreen
    ("tv_unit",       "#dda0dd", "living"),    # plum
    ("counter",       "#00ffff", "kitchen"),   # aqua
    ("fridge",        "#7fff00", "kitchen"),   # chartreuse
    ("stove",         "#fa8072", "kitchen"),   # salmon
    ("kitchen_sink",  "#7f007f", "kitchen"),   # purple2
    ("dining_table",  "#ff1493", "dining"),    # deeppink
    ("dining_chair",  "#ffdead", "dining"),    # navajowhite
    ("toilet",        "#ff0000", "bathroom"),  # red
    ("bathroom_sink", "#4169e1", "bathroom"),  # royalblue
    ("shower",        "#2e8b57", "bathroom"),  # seagreen
    ("bathtub",       "#ff8c00", "bathroom"),  # darkorange
    ("shoe_rack",     "#696969", "hallway"),   # dimgray
    ("console",       "#0000ff", "hallway"),   # blue
]

# Structural elements: (name, hex) — from resplan_utils.py CATEGORY_COLORS
STRUCTURAL_ITEMS = [
    ("door",       "#e78ac3"),  # pink
    ("window",     "#a6d854"),  # lime
    ("front_door", "#a63603"),  # dark reddish-brown
]

# Per-color HSV tolerance overrides for dense hue clusters.
# Blues (aqua H=90, deepskyblue H=100, royalblue H=113, blue H=120) need tight H.
# Greens (chartreuse H=45, seagreen H=73, mediumspringgreen H=86) need tight H.
TOLERANCES = {
    "#00ffff": dict(h_tol=6),   # aqua
    "#00bfff": dict(h_tol=6),   # deepskyblue
    "#4169e1": dict(h_tol=6),   # royalblue
    "#0000ff": dict(h_tol=6),   # blue
    "#7fff00": dict(h_tol=6),   # chartreuse
    "#2e8b57": dict(h_tol=6),   # seagreen
    "#00fa9a": dict(h_tol=6),   # mediumspringgreen
    "#ff00ff": dict(h_tol=6),   # fuchsia
    "#7f007f": dict(h_tol=6),   # purple2
    "#dda0dd": dict(h_tol=6, s_tol=35),  # plum — low saturation
    "#808000": dict(h_tol=6, v_tol=40),  # olive — low value
    "#696969": dict(h_tol=0),   # dimgray — pure gray, handled via sat=0 path
}


# ---------------------------------------------------------------------------
# Color helpers
# ---------------------------------------------------------------------------

def hex_to_hsv(hex_color: str) -> tuple:
    h = hex_color.lstrip("#")
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    bgr = np.uint8([[[b, g, r]]])
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)[0][0]
    return int(hsv[0]), int(hsv[1]), int(hsv[2])


def hex_to_bgr(hex_color: str) -> tuple:
    h = hex_color.lstrip("#")
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return (b, g, r)


def make_hsv_ranges(hex_color: str, h_tol: int = 10, s_tol: int = 60, v_tol: int = 60) -> list:
    """Return list of (lo, hi) np.array pairs for cv2.inRange, with hue-wraparound handling."""
    hue, sat, val = hex_to_hsv(hex_color)
    s_lo = max(0,   sat - s_tol)
    s_hi = min(255, sat + s_tol)
    v_lo = max(0,   val - v_tol)
    v_hi = min(255, val + v_tol)

    # Pure / near-gray: match by low saturation + value band, ignore hue
    if sat < 25:
        return [(np.array([0, 0, v_lo]), np.array([179, 40, v_hi]))]

    # Hue wraparound (red side, hue near 0)
    if hue - h_tol < 0:
        return [
            (np.array([0,               s_lo, v_lo]), np.array([hue + h_tol,      s_hi, v_hi])),
            (np.array([180 + hue - h_tol, s_lo, v_lo]), np.array([179,            s_hi, v_hi])),
        ]
    # Hue wraparound (red side, hue near 179)
    if hue + h_tol > 179:
        return [
            (np.array([hue - h_tol,      s_lo, v_lo]), np.array([179,             s_hi, v_hi])),
            (np.array([0,               s_lo, v_lo]), np.array([hue + h_tol - 180, s_hi, v_hi])),
        ]

    return [(np.array([hue - h_tol, s_lo, v_lo]), np.array([hue + h_tol, s_hi, v_hi]))]


def _build_configs(items_with_room, structural=False):
    configs = {}
    for entry in items_with_room:
        name, hex_color = entry[0], entry[1]
        tol = TOLERANCES.get(hex_color, {})
        cfg = {
            "hex": hex_color,
            "bgr": hex_to_bgr(hex_color),
            "ranges": make_hsv_ranges(hex_color, **tol),
        }
        if not structural:
            cfg["room"] = entry[2]
        configs[name] = cfg
    return configs


FURN_CONFIGS   = _build_configs(FURNITURE_ITEMS)
STRUCT_CONFIGS = _build_configs(STRUCTURAL_ITEMS, structural=True)


# ---------------------------------------------------------------------------
# Wall detection  (reused from extract.py)
# ---------------------------------------------------------------------------

def detect_walls(img: np.ndarray, min_length: int = 40) -> list:
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)

    # Mask out all colored regions so their dark borders don't bleed into wall detection
    colored_mask = np.zeros(img.shape[:2], dtype=np.uint8)
    for cfg in list(FURN_CONFIGS.values()) + list(STRUCT_CONFIGS.values()):
        for lo, hi in cfg["ranges"]:
            colored_mask |= cv2.inRange(hsv, lo, hi)
    colored_mask = cv2.dilate(
        colored_mask, cv2.getStructuringElement(cv2.MORPH_RECT, (12, 12))
    )

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    binary[colored_mask > 0] = 0

    walls = []

    # Horizontal walls
    h_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (min_length, 1))
    for c in cv2.findContours(
        cv2.morphologyEx(binary, cv2.MORPH_OPEN, h_kernel),
        cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
    )[0]:
        x, y, w, h = cv2.boundingRect(c)
        if w < min_length:
            continue
        walls.append({
            "orientation": "horizontal",
            "x1": x, "y1": y + h // 2, "x2": x + w, "y2": y + h // 2,
            "length_px": w, "thickness_px": h,
            "bbox": {"x": x, "y": y, "w": w, "h": h},
        })

    # Vertical walls
    v_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, min_length))
    for c in cv2.findContours(
        cv2.morphologyEx(binary, cv2.MORPH_OPEN, v_kernel),
        cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
    )[0]:
        x, y, w, h = cv2.boundingRect(c)
        if h < min_length:
            continue
        walls.append({
            "orientation": "vertical",
            "x1": x + w // 2, "y1": y, "x2": x + w // 2, "y2": y + h,
            "length_px": h, "thickness_px": w,
            "bbox": {"x": x, "y": y, "w": w, "h": h},
        })

    for i, wall in enumerate(walls):
        wall["id"] = i
    return walls


# ---------------------------------------------------------------------------
# Colored-region detection (furniture + structural)
# ---------------------------------------------------------------------------

def _is_rectangular(contour: np.ndarray, threshold: float = 0.70) -> bool:
    rect = cv2.minAreaRect(contour)
    area = rect[1][0] * rect[1][1]
    return area > 0 and (cv2.contourArea(contour) / area) >= threshold


def detect_colored_items(img: np.ndarray, configs: dict, min_area: int = 200) -> dict:
    """Detect items by HSV color mask. Returns {name: [item, ...]}."""
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    results = {}
    item_id = 0

    for name, cfg in configs.items():
        mask = np.zeros(hsv.shape[:2], dtype=np.uint8)
        for lo, hi in cfg["ranges"]:
            mask |= cv2.inRange(hsv, lo, hi)
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN,  kernel, iterations=1)

        items = []
        for c in cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)[0]:
            area = cv2.contourArea(c)
            if area < min_area or not _is_rectangular(c):
                continue
            x, y, w, h = cv2.boundingRect(c)
            items.append({
                "id":       item_id,
                "bbox":     {"x": int(x), "y": int(y), "w": int(w), "h": int(h)},
                "center_x": int(x + w // 2),
                "center_y": int(y + h // 2),
                "area_px":  int(area),
            })
            item_id += 1

        if items:
            results[name] = items

    return results


# ---------------------------------------------------------------------------
# Visualization
# ---------------------------------------------------------------------------

def draw_detections(img: np.ndarray, walls: list, furniture: dict, structural: dict) -> np.ndarray:
    out = img.copy()

    # Walls — dark outline
    for wall in walls:
        b = wall["bbox"]
        cv2.rectangle(out, (b["x"], b["y"]), (b["x"] + b["w"], b["y"] + b["h"]), (40, 40, 40), 2)

    # Structural elements
    for name, items in structural.items():
        bgr = STRUCT_CONFIGS[name]["bgr"]
        for item in items:
            b = item["bbox"]
            cv2.rectangle(out, (b["x"], b["y"]), (b["x"] + b["w"], b["y"] + b["h"]), bgr, 2)
            cv2.putText(out, name, (b["x"] + 2, b["y"] + 11),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.33, (0, 0, 0), 2, cv2.LINE_AA)
            cv2.putText(out, name, (b["x"] + 2, b["y"] + 11),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.33, bgr, 1, cv2.LINE_AA)

    # Furniture
    for name, items in furniture.items():
        bgr  = FURN_CONFIGS[name]["bgr"]
        label = name.replace("_", " ")
        for item in items:
            b = item["bbox"]
            cv2.rectangle(out, (b["x"], b["y"]), (b["x"] + b["w"], b["y"] + b["h"]), bgr, 2)
            (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.32, 1)
            tx = b["x"] + max(0, (b["w"] - tw) // 2)
            ty = b["y"] + max(th, (b["h"] + th) // 2)
            # Black outline + colored text for legibility on any background
            cv2.putText(out, label, (tx, ty), cv2.FONT_HERSHEY_SIMPLEX, 0.32, (0, 0, 0), 2, cv2.LINE_AA)
            cv2.putText(out, label, (tx, ty), cv2.FONT_HERSHEY_SIMPLEX, 0.32, bgr,       1, cv2.LINE_AA)

    return out


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Detect walls and furniture from a furnished floor plan image.")
    parser.add_argument("image")
    parser.add_argument("--show",     action="store_true", help="Display result in a window")
    parser.add_argument("--min-wall", type=int, default=40,  metavar="PX",  help="Min wall length (default 40)")
    parser.add_argument("--min-area", type=int, default=200, metavar="PX2", help="Min furniture area (default 200)")
    parser.add_argument("--out-dir",  default="output")
    args = parser.parse_args()

    if not os.path.isfile(args.image):
        print(f"Error: not found: {args.image}", file=sys.stderr); sys.exit(1)
    img = cv2.imread(args.image)
    if img is None:
        print(f"Error: could not read: {args.image}", file=sys.stderr); sys.exit(2)

    h, w = img.shape[:2]
    print(f"Image: {w}×{h}  ({args.image})")

    print("Detecting walls...")
    walls = detect_walls(img, min_length=args.min_wall)
    print(f"  {len(walls)} walls  (H={sum(1 for x in walls if x['orientation']=='horizontal')}, "
          f"V={sum(1 for x in walls if x['orientation']=='vertical')})")

    print("Detecting structural elements...")
    structural = detect_colored_items(img, STRUCT_CONFIGS, min_area=args.min_area)
    for name, items in structural.items():
        print(f"  {len(items)} {name}(s)")

    print("Detecting furniture...")
    furniture = detect_colored_items(img, FURN_CONFIGS, min_area=args.min_area)
    for name, items in furniture.items():
        print(f"  {len(items)} {name}(s)")

    os.makedirs(args.out_dir, exist_ok=True)

    # JSON output
    by_type = {name: len(items) for name, items in furniture.items()}
    result = {
        "image_path":  os.path.abspath(args.image),
        "image_size":  {"width": w, "height": h},
        "walls":       walls,
        "doors":       structural.get("door",       []),
        "windows":     structural.get("window",     []),
        "front_doors": structural.get("front_door", []),
        "furniture":   furniture,
        "summary": {
            "wall_count":        len(walls),
            "door_count":        len(structural.get("door",   [])),
            "window_count":      len(structural.get("window", [])),
            "furniture_count":   sum(len(v) for v in furniture.values()),
            "furniture_by_type": by_type,
        },
    }
    json_path = os.path.join(args.out_dir, "result.json")
    with open(json_path, "w") as f:
        json.dump(result, f, indent=2)
    print(f"\nJSON  → {json_path}")

    # Visualization
    vis = draw_detections(img, walls, furniture, structural)
    stem    = os.path.splitext(os.path.basename(args.image))[0]
    vis_path = os.path.join(args.out_dir, f"{stem}_detected.png")
    cv2.imwrite(vis_path, vis)
    print(f"Image → {vis_path}")

    print(f"\nSummary: {len(walls)} walls | "
          f"{len(structural.get('door',[]))} doors | "
          f"{len(structural.get('window',[]))} windows | "
          f"{sum(len(v) for v in furniture.values())} furniture items")

    if args.show:
        scale = min(1.0, 1400 / w)
        preview = cv2.resize(vis, (int(w * scale), int(h * scale)))
        cv2.imshow("detect_plan", preview)
        cv2.waitKey(0)
        cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
