"""
detect_rooms.py — Per-room banana-pro image analysis.

Detects walls, structural openings, and furniture from AI-generated per-room
floor plan images (banana-pro model output from gen_output/).

Usage:
    python detect_rooms.py                          # all *_banana-pro.png in gen_output/
    python detect_rooms.py gen_output/plan_7031_bedroom_banana-pro.png
    python detect_rooms.py --out-dir my_out/ --min-wall 20
"""

import argparse
import glob as _glob
import json
import os
import re
import sys

import cv2
import numpy as np

try:
    import pytesseract
    TESSERACT_OK = True
except ImportError:
    TESSERACT_OK = False
    print("INFO: pytesseract not found — legend/number parsing disabled.")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

ROOM_FILL_COLORS = {   # hex, from visualize_rooms.py ROOM_COLORS
    "bedroom": "#66c2a5",
    "bathroom": "#fc8d62",
    "kitchen": "#8da0cb",
    "living": "#d9d9d9",
}

STRUCTURAL_ITEMS = [
    ("door",       "#e78ac3"),
    ("window",     "#a6d854"),
    ("front_door", "#a63603"),
]

WALL_GRAY_LO, WALL_GRAY_HI = 150, 190   # #aaaaaa = 170 in grayscale
DIM_RED_HEX = "#c0392b"
DEFAULT_OUT_DIR = "detect_output"

# 9-color palette for furniture visualization
FURNITURE_PALETTE = [
    (255, 100, 100),   # blue-ish
    (100, 200, 100),   # green-ish
    (100, 100, 255),   # red-ish
    (200, 200, 100),   # cyan-ish
    (200, 100, 200),   # magenta-ish
    (100, 200, 200),   # yellow-ish
    (150, 150, 255),   # light red
    (255, 200, 100),   # light blue
    (100, 255, 200),   # light green
]


# ---------------------------------------------------------------------------
# Color helpers (copied verbatim from detect_plan.py)
# ---------------------------------------------------------------------------

def hex_to_bgr(hex_color: str) -> tuple:
    h = hex_color.lstrip("#")
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return (b, g, r)


def hex_to_hsv(hex_color: str) -> tuple:
    h = hex_color.lstrip("#")
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    bgr = np.uint8([[[b, g, r]]])
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)[0][0]
    return int(hsv[0]), int(hsv[1]), int(hsv[2])


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
            (np.array([0,                s_lo, v_lo]), np.array([hue + h_tol,       s_hi, v_hi])),
            (np.array([180 + hue - h_tol, s_lo, v_lo]), np.array([179,              s_hi, v_hi])),
        ]
    # Hue wraparound (red side, hue near 179)
    if hue + h_tol > 179:
        return [
            (np.array([hue - h_tol,      s_lo, v_lo]), np.array([179,              s_hi, v_hi])),
            (np.array([0,                s_lo, v_lo]), np.array([hue + h_tol - 180, s_hi, v_hi])),
        ]

    return [(np.array([hue - h_tol, s_lo, v_lo]), np.array([hue + h_tol, s_hi, v_hi]))]


def _is_rectangular(contour: np.ndarray, fill_thresh: float = 0.70) -> bool:
    rect = cv2.minAreaRect(contour)
    area = rect[1][0] * rect[1][1]
    return area > 0 and (cv2.contourArea(contour) / area) >= fill_thresh


# ---------------------------------------------------------------------------
# 1. parse_filename
# ---------------------------------------------------------------------------

def parse_filename(image_path: str) -> dict:
    """Parse plan_{id}_{room_type[_N]}_banana-pro.png → dict."""
    stem = os.path.splitext(os.path.basename(image_path))[0]
    m = re.match(r'^plan_(\d+)_(.+?)_(banana-pro|banana-2)$', stem)
    if not m:
        return {"plan_id": None, "room_type": stem, "model": "unknown"}
    return {
        "plan_id":   int(m.group(1)),
        "room_type": m.group(2),
        "model":     m.group(3),
    }


# ---------------------------------------------------------------------------
# 2. find_banana_pro_images
# ---------------------------------------------------------------------------

def find_banana_pro_images(search_dir: str) -> list:
    pattern = os.path.join(search_dir, "plan_*_banana-pro.png")
    return [
        p for p in sorted(_glob.glob(pattern))
        if "_stage1" not in os.path.basename(p)
    ]


# ---------------------------------------------------------------------------
# 3. Room-fill HSV mask helpers
# ---------------------------------------------------------------------------

def _room_fill_mask(img: np.ndarray, hsv: np.ndarray, gray: np.ndarray, base_type: str, close: bool = True) -> np.ndarray:
    """Return a mask for the room fill color. Special-case living room."""
    if base_type == "living":
        mask = cv2.inRange(gray, 210, 230)
    else:
        hex_color = ROOM_FILL_COLORS.get(base_type)
        if hex_color is None:
            return np.zeros(img.shape[:2], dtype=np.uint8)
        ranges = make_hsv_ranges(hex_color, h_tol=12, s_tol=60, v_tol=40)
        mask = np.zeros(img.shape[:2], dtype=np.uint8)
        for lo, hi in ranges:
            mask |= cv2.inRange(hsv, lo, hi)

    if close:
        # Use 30×30 kernel, 5 iterations ≈ 150px effective close.
        # This covers room fill + adjacent teal-noise pixels that would otherwise
        # create irregular blobs in the furniture candidate mask.
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (30, 30))
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=5)
    return mask


# ---------------------------------------------------------------------------
# 4. detect_room_interior_mask
# ---------------------------------------------------------------------------

def detect_room_interior_mask(img: np.ndarray, room_type: str, exclusion_mask: np.ndarray) -> np.ndarray:
    """Detect the room interior as a mask (H×W uint8).

    Strategy: find all room-fill pixels (strict HSV detection), then use their
    bounding rectangle as the room mask.  This is robust even when large furniture
    blocks occupy the room center — morphological closing would need to bridge
    400+ px gaps, while the bounding rect approach works regardless.
    """
    H, W = img.shape[:2]
    hsv  = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    # Strip _1/_2 suffix
    base_type = re.sub(r'_\d+$', '', room_type)

    # Strict (no close) detection of room fill color
    fill_strict = _room_fill_mask(img, hsv, gray, base_type, close=False)

    if cv2.countNonZero(fill_strict) == 0:
        # Unknown room type or no fill detected: use full image minus exclusion
        result = np.ones((H, W), dtype=np.uint8) * 255
        result[exclusion_mask > 0] = 0
        return result

    # Bounding rect of all room fill pixels → defines the room area
    pts_y, pts_x = np.where(fill_strict > 0)
    x_min, x_max = int(pts_x.min()), int(pts_x.max())
    y_min, y_max = int(pts_y.min()), int(pts_y.max())

    room_mask = np.zeros((H, W), dtype=np.uint8)
    room_mask[y_min:y_max + 1, x_min:x_max + 1] = 255

    # Apply exclusion
    room_mask[exclusion_mask > 0] = 0

    return room_mask


# ---------------------------------------------------------------------------
# 5. detect_walls
# ---------------------------------------------------------------------------

def detect_walls(img: np.ndarray, exclusion_mask: np.ndarray, min_length: int = 20) -> list:
    """Detect horizontal and vertical walls."""
    H, W = img.shape[:2]
    hsv  = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    # Build colored_mask: all known colored regions to exclude from wall detection
    colored_mask = np.zeros((H, W), dtype=np.uint8)

    # Structural items
    for _name, hex_color in STRUCTURAL_ITEMS:
        for lo, hi in make_hsv_ranges(hex_color, h_tol=12, s_tol=60, v_tol=40):
            colored_mask |= cv2.inRange(hsv, lo, hi)

    # All room fills
    for room_type, hex_color in ROOM_FILL_COLORS.items():
        if room_type == "living":
            colored_mask |= cv2.inRange(gray, 210, 230)
        else:
            for lo, hi in make_hsv_ranges(hex_color, h_tol=12, s_tol=60, v_tol=40):
                colored_mask |= cv2.inRange(hsv, lo, hi)

    # Red dimension lines
    for lo, hi in make_hsv_ranges(DIM_RED_HEX, h_tol=10, s_tol=60, v_tol=40):
        colored_mask |= cv2.inRange(hsv, lo, hi)

    # Dilate colored mask
    dil_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (8, 8))
    colored_mask = cv2.dilate(colored_mask, dil_kernel)

    # Apply exclusion
    colored_mask[exclusion_mask > 0] = 255

    # Otsu threshold
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    binary[colored_mask > 0] = 0

    walls = []

    # Horizontal walls
    h_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (min_length, 1))
    h_opened = cv2.morphologyEx(binary, cv2.MORPH_OPEN, h_kernel)
    for c in cv2.findContours(h_opened, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)[0]:
        x, y, w, h = cv2.boundingRect(c)
        if w < min_length:
            continue
        walls.append({
            "orientation":  "horizontal",
            "bbox":         {"x": int(x), "y": int(y), "w": int(w), "h": int(h)},
            "length_px":    int(w),
            "thickness_px": int(h),
            "x1": int(x),     "y1": int(y + h // 2),
            "x2": int(x + w), "y2": int(y + h // 2),
        })

    # Vertical walls
    v_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, min_length))
    v_opened = cv2.morphologyEx(binary, cv2.MORPH_OPEN, v_kernel)
    for c in cv2.findContours(v_opened, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)[0]:
        x, y, w, h = cv2.boundingRect(c)
        if h < min_length:
            continue
        walls.append({
            "orientation":  "vertical",
            "bbox":         {"x": int(x), "y": int(y), "w": int(w), "h": int(h)},
            "length_px":    int(h),
            "thickness_px": int(w),
            "x1": int(x + w // 2), "y1": int(y),
            "x2": int(x + w // 2), "y2": int(y + h),
        })

    for i, wall in enumerate(walls):
        wall["id"] = i

    return walls


# ---------------------------------------------------------------------------
# 6. detect_structural_items
# ---------------------------------------------------------------------------

def detect_structural_items(img: np.ndarray, exclusion_mask: np.ndarray, min_area: int = 200) -> dict:
    """Detect doors, windows, and front doors."""
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    kernel5 = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    results = {"doors": [], "windows": [], "front_doors": []}
    key_map = {"door": "doors", "window": "windows", "front_door": "front_doors"}
    item_id = 0

    for name, hex_color in STRUCTURAL_ITEMS:
        ranges = make_hsv_ranges(hex_color, h_tol=12, s_tol=60, v_tol=40)
        mask = np.zeros(img.shape[:2], dtype=np.uint8)
        for lo, hi in ranges:
            mask |= cv2.inRange(hsv, lo, hi)

        # Apply exclusion
        mask[exclusion_mask > 0] = 0

        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel5, iterations=2)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN,  kernel5, iterations=1)

        out_key = key_map[name]
        for c in cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)[0]:
            area = cv2.contourArea(c)
            if area < min_area or not _is_rectangular(c, 0.65):
                continue
            x, y, w, h = cv2.boundingRect(c)
            results[out_key].append({
                "id":       item_id,
                "bbox":     {"x": int(x), "y": int(y), "w": int(w), "h": int(h)},
                "center_x": int(x + w // 2),
                "center_y": int(y + h // 2),
            })
            item_id += 1

    return results


# ---------------------------------------------------------------------------
# 7. parse_legend
# ---------------------------------------------------------------------------

def parse_legend(img: np.ndarray) -> dict:
    """Parse legend from the full image using OCR. Returns {number: name}."""
    if not TESSERACT_OK:
        return {}

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    # 3× upscale
    up = cv2.resize(gray, (gray.shape[1] * 3, gray.shape[0] * 3), interpolation=cv2.INTER_CUBIC)
    up = cv2.GaussianBlur(up, (3, 3), 0)

    try:
        text = pytesseract.image_to_string(up, config='--psm 6 --oem 1')
    except Exception:
        return {}

    legend = {}
    for line in text.splitlines():
        m = re.match(r'^(\d+)\s*[—\-–]\s*(.+)$', line.strip())
        if m:
            legend[int(m.group(1))] = m.group(2).strip()

    if len(legend) < 2:
        return {}
    return legend


# ---------------------------------------------------------------------------
# 8. detect_furniture
# ---------------------------------------------------------------------------

def _known_colors_mask(img: np.ndarray, hsv: np.ndarray, gray: np.ndarray) -> np.ndarray:
    """Build mask of all known non-furniture pixels."""
    mask = np.zeros(img.shape[:2], dtype=np.uint8)

    # Structural items
    for _name, hex_color in STRUCTURAL_ITEMS:
        for lo, hi in make_hsv_ranges(hex_color, h_tol=12, s_tol=60, v_tol=40):
            mask |= cv2.inRange(hsv, lo, hi)

    # Wall gray — target #aaaaaa (gray=170) with a NARROW band.
    # Furniture in banana-pro images renders as gray≈150-155, so using 150-190
    # would incorrectly mask it out.  Use a tight near-pure-gray HSV detection:
    # S < 20 (nearly achromatic) AND V in 157-188.  This catches #aaaaaa (S=0,V=170)
    # but misses the blue-gray furniture (S≈30, same V range).
    wall_mask = cv2.inRange(hsv, np.array([0, 0, 157]), np.array([179, 20, 188]))
    mask |= wall_mask

    # Red dimension lines
    for lo, hi in make_hsv_ranges(DIM_RED_HEX, h_tol=10, s_tol=60, v_tol=40):
        mask |= cv2.inRange(hsv, lo, hi)

    # White background (>230)
    mask |= cv2.inRange(gray, 231, 255)

    return mask


def _ocr_number_in_box(img: np.ndarray, bbox: dict) -> int:
    """Try to read a digit from a cropped furniture box. Returns int or -1."""
    if not TESSERACT_OK:
        return -1
    x, y, w, h = bbox["x"], bbox["y"], bbox["w"], bbox["h"]
    crop = img[y:y+h, x:x+w]
    if crop.size == 0:
        return -1
    # 4× upscale
    up = cv2.resize(crop, (crop.shape[1] * 4, crop.shape[0] * 4), interpolation=cv2.INTER_CUBIC)
    up_gray = cv2.cvtColor(up, cv2.COLOR_BGR2GRAY)
    try:
        data = pytesseract.image_to_data(
            up_gray,
            config='--psm 6 --oem 1 -c tessedit_char_whitelist=0123456789',
            output_type=pytesseract.Output.DICT,
        )
    except Exception:
        return -1

    best_conf = -1
    best_num = -1
    for i, text in enumerate(data["text"]):
        text = text.strip()
        if not text.isdigit():
            continue
        conf = int(data["conf"][i])
        if conf > best_conf:
            best_conf = conf
            best_num = int(text)
    return best_num if best_conf >= 0 else -1


def detect_furniture(img: np.ndarray, room_mask: np.ndarray, exclusion_mask: np.ndarray,
                     legend_map: dict, room_type: str = "") -> list:
    """Color-agnostic furniture detection inside the room."""
    H, W = img.shape[:2]
    hsv  = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    # Use the CLOSED room fill for subtraction.
    # A morphological close (30×30, 5 iterations = ~150px effective) covers the room fill
    # color AND its teal-adjacent noise pixels, isolating furniture as distinct islands.
    # We detect ALL room fill colors but only strongly close the one matching this room.
    base_type = re.sub(r'_\d+$', '', room_type) if room_type else ""
    room_fill_strict = np.zeros((H, W), dtype=np.uint8)
    for bt in ROOM_FILL_COLORS.keys():
        # Use tight close for the actual room type (to cover noise), loose for others
        use_close = (bt == base_type)
        fill = _room_fill_mask(img, hsv, gray, bt, close=use_close)
        room_fill_strict |= fill

    known_colors = _known_colors_mask(img, hsv, gray)

    # Candidate mask: inside room, not room fill, not known colors
    candidate = room_mask.copy()
    candidate[room_fill_strict > 0] = 0
    candidate[known_colors > 0] = 0
    candidate[exclusion_mask > 0] = 0

    # Morphological cleanup
    k5 = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    k3 = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    candidate = cv2.morphologyEx(candidate, cv2.MORPH_CLOSE, k5, iterations=2)
    candidate = cv2.morphologyEx(candidate, cv2.MORPH_OPEN,  k3, iterations=1)

    detections = []
    for c in cv2.findContours(candidate, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)[0]:
        area = cv2.contourArea(c)
        if area < 150:
            continue
        if area > 0.35 * H * W:
            continue
        if not _is_rectangular(c, 0.70):
            continue
        x, y, w, h = cv2.boundingRect(c)
        # Reject line-like artifacts (dimension lines, text underscores, etc.)
        if min(w, h) < 8:
            continue
        detections.append({
            "bbox":     {"x": int(x), "y": int(y), "w": int(w), "h": int(h)},
            "center_x": int(x + w // 2),
            "center_y": int(y + h // 2),
            "area_px":  int(area),
        })

    # Sort by position (top-to-bottom, left-to-right) for fallback numbering
    detections.sort(key=lambda d: (d["center_y"], d["center_x"]))

    # Assign numbers and types
    result = []
    for idx, det in enumerate(detections):
        # Try OCR first
        number = _ocr_number_in_box(img, det["bbox"])
        if number <= 0:
            number = idx + 1  # fallback: sequential

        item_type = legend_map.get(number, f"item_{number}")
        result.append({
            "id":       idx,
            "number":   number,
            "type":     item_type,
            "bbox":     det["bbox"],
            "center_x": det["center_x"],
            "center_y": det["center_y"],
            "area_px":  det["area_px"],
        })

    return result


# ---------------------------------------------------------------------------
# 10. draw_and_save_visualization
# ---------------------------------------------------------------------------

def draw_and_save_visualization(img: np.ndarray, result: dict, out_path: str):
    """Draw detections on image and save."""
    out = img.copy()
    overlay = img.copy()

    # 1. Walls
    for wall in result.get("walls", []):
        b = wall["bbox"]
        cv2.rectangle(out, (b["x"], b["y"]), (b["x"] + b["w"], b["y"] + b["h"]),
                      (50, 50, 50), 2)
        orient_label = "H" if wall["orientation"] == "horizontal" else "V"
        mx = b["x"] + b["w"] // 2
        my = b["y"] + b["h"] // 2
        cv2.putText(out, orient_label, (mx, my),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.35, (0, 0, 0), 2, cv2.LINE_AA)
        cv2.putText(out, orient_label, (mx, my),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.35, (255, 255, 255), 1, cv2.LINE_AA)

    # 2-4. Structural items
    struct_draw = [
        ("doors",       "#e78ac3", "door"),
        ("windows",     "#a6d854", "win"),
        ("front_doors", "#a63603", "fdr"),
    ]
    for key, hex_color, label in struct_draw:
        bgr = hex_to_bgr(hex_color)
        for item in result.get(key, []):
            b = item["bbox"]
            cv2.rectangle(out, (b["x"], b["y"]), (b["x"] + b["w"], b["y"] + b["h"]), bgr, 2)
            cv2.putText(out, label, (b["x"] + 2, b["y"] + 11),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.35, (0, 0, 0), 2, cv2.LINE_AA)
            cv2.putText(out, label, (b["x"] + 2, b["y"] + 11),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.35, (255, 255, 255), 1, cv2.LINE_AA)

    # 5. Furniture — semi-transparent filled rects + labels
    for item in result.get("furniture", []):
        b = item["bbox"]
        number = item.get("number", 1)
        item_type = item.get("type", "?")
        color_bgr = FURNITURE_PALETTE[(number - 1) % len(FURNITURE_PALETTE)]

        # Semi-transparent fill (alpha blend)
        sub = overlay[b["y"]:b["y"]+b["h"], b["x"]:b["x"]+b["w"]]
        if sub.size > 0:
            filled = np.full_like(sub, color_bgr)
            cv2.addWeighted(filled, 0.35, sub, 0.65, 0, sub)
            overlay[b["y"]:b["y"]+b["h"], b["x"]:b["x"]+b["w"]] = sub

        # Outline
        cv2.rectangle(overlay, (b["x"], b["y"]), (b["x"] + b["w"], b["y"] + b["h"]), color_bgr, 2)

        # Label centered
        label = f"{number}: {item_type}"
        (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.35, 1)
        tx = b["x"] + max(0, (b["w"] - tw) // 2)
        ty = b["y"] + max(th, (b["h"] + th) // 2)
        # Shadow (black, 2px) then white 1px
        cv2.putText(overlay, label, (tx, ty),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.35, (0, 0, 0), 2, cv2.LINE_AA)
        cv2.putText(overlay, label, (tx, ty),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.35, (255, 255, 255), 1, cv2.LINE_AA)

    # Merge overlay into out
    cv2.addWeighted(overlay, 1.0, out, 0.0, 0, out)

    cv2.imwrite(out_path, out)
    print(f"  PNG  → {out_path}")


# ---------------------------------------------------------------------------
# 11. assemble_result
# ---------------------------------------------------------------------------

def assemble_result(image_path: str, meta: dict, img: np.ndarray,
                    walls: list, structural: dict, furniture: list) -> dict:
    H, W = img.shape[:2]
    return {
        "image_path":  os.path.abspath(image_path),
        "plan_id":     meta["plan_id"],
        "room_type":   meta["room_type"],
        "model":       meta["model"],
        "image_size":  {"width": W, "height": H},
        "walls":       walls,
        "doors":       structural.get("doors", []),
        "windows":     structural.get("windows", []),
        "front_doors": structural.get("front_doors", []),
        "furniture":   furniture,
        "summary": {
            "wall_count":       len(walls),
            "door_count":       len(structural.get("doors", [])),
            "window_count":     len(structural.get("windows", [])),
            "front_door_count": len(structural.get("front_doors", [])),
            "furniture_count":  len(furniture),
        },
    }


# ---------------------------------------------------------------------------
# 12. process_image
# ---------------------------------------------------------------------------

def process_image(image_path: str, out_dir: str, min_wall: int = 20, show: bool = False) -> dict:
    meta = parse_filename(image_path)
    print(f"\n[{os.path.basename(image_path)}]  room={meta['room_type']}  plan={meta['plan_id']}")

    img = cv2.imread(image_path)
    if img is None:
        print(f"  ERROR: could not read image", file=sys.stderr)
        return {}

    H, W = img.shape[:2]

    # No explicit exclusion mask (no legend region to mask out separately —
    # the legend detection is full-image OCR, and we rely on room_mask gating)
    exclusion_mask = np.zeros((H, W), dtype=np.uint8)

    print(f"  Detecting room interior...")
    room_mask = detect_room_interior_mask(img, meta["room_type"], exclusion_mask)
    room_px = cv2.countNonZero(room_mask)
    print(f"    room pixels: {room_px}")

    print(f"  Parsing legend...")
    legend_map = parse_legend(img)
    print(f"    legend entries: {legend_map}")

    print(f"  Detecting walls (min_length={min_wall})...")
    walls = detect_walls(img, exclusion_mask, min_length=min_wall)
    h_count = sum(1 for w in walls if w["orientation"] == "horizontal")
    v_count = sum(1 for w in walls if w["orientation"] == "vertical")
    print(f"    {len(walls)} walls (H={h_count}, V={v_count})")

    print(f"  Detecting structural items...")
    structural = detect_structural_items(img, exclusion_mask)
    print(f"    doors={len(structural['doors'])}  windows={len(structural['windows'])}  front_doors={len(structural['front_doors'])}")

    print(f"  Detecting furniture...")
    furniture = detect_furniture(img, room_mask, exclusion_mask, legend_map,
                                 room_type=meta["room_type"])
    print(f"    {len(furniture)} furniture item(s)")

    result = assemble_result(image_path, meta, img, walls, structural, furniture)

    # Output naming
    os.makedirs(out_dir, exist_ok=True)
    stem = f"plan_{meta['plan_id']}_{meta['room_type']}_{meta['model']}"
    json_path = os.path.join(out_dir, f"{stem}_detected.json")
    png_path  = os.path.join(out_dir, f"{stem}_detected.png")

    with open(json_path, "w") as f:
        json.dump(result, f, indent=2)
    print(f"  JSON → {json_path}")

    draw_and_save_visualization(img, result, png_path)

    if show:
        scale = min(1.0, 1400 / W)
        preview = cv2.resize(img, (int(W * scale), int(H * scale)))
        cv2.imshow(os.path.basename(image_path), preview)
        cv2.waitKey(0)
        cv2.destroyAllWindows()

    return result


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Detect walls, openings, and furniture from banana-pro per-room images."
    )
    parser.add_argument(
        "images", nargs="*",
        help="Paths to images. If omitted, processes all plan_*_banana-pro.png in gen_output/",
    )
    parser.add_argument("--out-dir",  default=DEFAULT_OUT_DIR, metavar="DIR")
    parser.add_argument("--min-wall", type=int, default=20,    metavar="PX",
                        help="Min wall length in px (default: 20)")
    parser.add_argument("--show",     action="store_true",
                        help="Display result in a window after each image")
    parser.add_argument("--search-dir", default="gen_output", metavar="DIR",
                        help="Directory to search for banana-pro images (default: gen_output)")
    args = parser.parse_args()

    if args.images:
        image_paths = args.images
    else:
        image_paths = find_banana_pro_images(args.search_dir)
        if not image_paths:
            print(f"No banana-pro images found in {args.search_dir}/", file=sys.stderr)
            sys.exit(1)
        print(f"Found {len(image_paths)} banana-pro image(s) in {args.search_dir}/")

    results = []
    for path in image_paths:
        if not os.path.isfile(path):
            print(f"WARNING: not found: {path}", file=sys.stderr)
            continue
        r = process_image(path, args.out_dir, min_wall=args.min_wall, show=args.show)
        if r:
            results.append(r)

    print(f"\nDone. Processed {len(results)}/{len(image_paths)} image(s).")
    print(f"Output → {args.out_dir}/")

    # Summary table
    if results:
        print(f"\n{'Room':<20} {'Walls':>6} {'Doors':>6} {'Win':>6} {'Furn':>6}")
        print("-" * 46)
        for r in results:
            s = r.get("summary", {})
            print(f"{r.get('room_type', '?'):<20} "
                  f"{s.get('wall_count', 0):>6} "
                  f"{s.get('door_count', 0):>6} "
                  f"{s.get('window_count', 0):>6} "
                  f"{s.get('furniture_count', 0):>6}")


if __name__ == "__main__":
    main()
