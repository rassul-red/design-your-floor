"""
Floor Plan Coordinate Extractor
--------------------------------
Given a floor plan image with:
  - Dark walls on white background
  - Colored filled rectangles for furniture:
      Red   → sofa
      Green → rug
      Blue  → coffee table

Extracts pixel coordinates and sizes of all walls and furniture,
saves to output/result.json, and renders a 2D matplotlib visualization.

Usage:
    python extract.py <image_path> [--show] [--min-wall INT] [--min-furniture INT]
"""

import argparse
import json
import math
import os
import sys

import cv2
import numpy as np
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.transforms import Affine2D

# ---------------------------------------------------------------------------
# Color definitions (HSV, OpenCV: H=0-179, S=0-255, V=0-255)
# ---------------------------------------------------------------------------

FURNITURE_COLORS = {
    "sofa": {
        "color": "red",
        "matplotlib_color": "#e53935",
        "ranges": [
            (np.array([0,   80,  80]),  np.array([10,  255, 255])),
            (np.array([165, 80,  80]),  np.array([179, 255, 255])),
        ],
    },
    "rug": {
        "color": "green",
        "matplotlib_color": "#43a047",
        "ranges": [
            (np.array([35, 60, 60]), np.array([90, 255, 255])),
        ],
    },
    "coffee_table": {
        "color": "blue",
        "matplotlib_color": "#1e88e5",
        "ranges": [
            (np.array([95, 60, 60]), np.array([140, 255, 255])),
        ],
    },
}


# ---------------------------------------------------------------------------
# Wall detection (horizontal + vertical only; doors/arcs are ignored)
# ---------------------------------------------------------------------------

def detect_walls(img: np.ndarray, min_length: int = 40):
    # Step 1: mask out colored furniture so their dark borders don't bleed into
    # wall detection (blue fills especially look dark in grayscale).
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    furniture_mask = np.zeros(img.shape[:2], dtype=np.uint8)
    for config in FURNITURE_COLORS.values():
        for lo, hi in config["ranges"]:
            furniture_mask |= cv2.inRange(hsv, lo, hi)
    # Dilate slightly to also erase the black borders drawn around furniture
    furn_dilate = cv2.getStructuringElement(cv2.MORPH_RECT, (12, 12))
    furniture_mask = cv2.dilate(furniture_mask, furn_dilate)

    # Step 2: grayscale threshold — dark pixels (walls) become white
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

    # Erase furniture regions from the binary mask
    binary[furniture_mask > 0] = 0

    walls = []

    # Step 3: horizontal walls
    # A kernel of shape (min_length, 1) acts as a horizontal "gate":
    # only structures at least min_length pixels wide survive the opening.
    # Curved lines, arcs, and short blobs are erased.
    h_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (min_length, 1))
    h_binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, h_kernel)

    h_contours, _ = cv2.findContours(h_binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    for c in h_contours:
        x, y, w, h = cv2.boundingRect(c)
        if w < min_length:
            continue
        walls.append({
            "orientation": "horizontal",
            # centerline endpoints
            "x1": int(x),        "y1": int(y + h // 2),
            "x2": int(x + w),    "y2": int(y + h // 2),
            "length_px": int(w),
            "thickness_px": int(h),
            "bounding_box": {"x": int(x), "y": int(y), "w": int(w), "h": int(h)},
        })

    # Step 4: vertical walls — same idea with a (1, min_length) kernel
    v_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, min_length))
    v_binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, v_kernel)

    v_contours, _ = cv2.findContours(v_binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    for c in v_contours:
        x, y, w, h = cv2.boundingRect(c)
        if h < min_length:
            continue
        walls.append({
            "orientation": "vertical",
            "x1": int(x + w // 2), "y1": int(y),
            "x2": int(x + w // 2), "y2": int(y + h),
            "length_px": int(h),
            "thickness_px": int(w),
            "bounding_box": {"x": int(x), "y": int(y), "w": int(w), "h": int(h)},
        })

    for i, wall in enumerate(walls):
        wall["id"] = i

    return walls


# ---------------------------------------------------------------------------
# Furniture detection
# ---------------------------------------------------------------------------

def _make_mask(hsv: np.ndarray, ranges) -> np.ndarray:
    mask = np.zeros(hsv.shape[:2], dtype=np.uint8)
    for lo, hi in ranges:
        mask |= cv2.inRange(hsv, lo, hi)
    return mask


def _is_rectangular(contour: np.ndarray, threshold: float = 0.75) -> bool:
    rect = cv2.minAreaRect(contour)
    rect_area = rect[1][0] * rect[1][1]
    if rect_area == 0:
        return False
    return (cv2.contourArea(contour) / rect_area) >= threshold


def detect_furniture(img: np.ndarray, min_area: int = 200) -> list:
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)

    furniture = []
    item_id = 0

    for furniture_type, config in FURNITURE_COLORS.items():
        # Build color mask
        mask = _make_mask(hsv, config["ranges"])

        # Fill interior holes, remove noise
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel, iterations=1)

        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        for contour in contours:
            area = cv2.contourArea(contour)
            if area < min_area:
                continue
            if not _is_rectangular(contour):
                continue

            # Rotated bounding rectangle
            rect = cv2.minAreaRect(contour)
            center, (w, h), angle = rect

            # Normalize: ensure width >= height
            if w < h:
                w, h = h, w
                angle += 90
            angle = angle % 180

            box_points = cv2.boxPoints(rect)
            box_points = np.int32(box_points)

            ax, ay, aw, ah = cv2.boundingRect(contour)

            furniture.append({
                "id": item_id,
                "type": furniture_type,
                "color": config["color"],
                "center_x": float(round(center[0], 2)),
                "center_y": float(round(center[1], 2)),
                "width": float(round(w, 2)),
                "height": float(round(h, 2)),
                "angle_deg": float(round(angle, 2)),
                "bounding_box": {"x": int(ax), "y": int(ay), "w": int(aw), "h": int(ah)},
                "box_points": box_points.tolist(),
                "area_px": float(round(area, 2)),
            })
            item_id += 1

    return furniture


# ---------------------------------------------------------------------------
# 2D Matplotlib visualization
# ---------------------------------------------------------------------------

def visualize(img_shape, walls, furniture, output_path: str, show: bool = False):
    h, w = img_shape[:2]

    fig, ax = plt.subplots(figsize=(max(8, w / 100), max(6, h / 100)))
    ax.set_xlim(0, w)
    ax.set_ylim(h, 0)  # invert Y so origin is top-left (matches image coords)
    ax.set_aspect("equal")
    ax.set_facecolor("#f5f5f5")
    ax.set_title("Floor Plan — Extracted Coordinates", fontsize=14)
    ax.set_xlabel("X (pixels)")
    ax.set_ylabel("Y (pixels)")

    # Draw walls as solid rectangles (bounding box preserves actual wall thickness)
    for wall in walls:
        bb = wall["bounding_box"]
        rect = mpatches.Rectangle(
            (bb["x"], bb["y"]), bb["w"], bb["h"],
            facecolor="#444444",
            edgecolor="#222222",
            linewidth=0.5,
            zorder=1,
        )
        ax.add_patch(rect)

    # Draw furniture
    furniture_colors = {ft: cfg["matplotlib_color"] for ft, cfg in FURNITURE_COLORS.items()}

    for item in furniture:
        color = furniture_colors.get(item["type"], "#9e9e9e")
        cx, cy = item["center_x"], item["center_y"]
        fw, fh = item["width"], item["height"]
        angle = item["angle_deg"]

        # Rectangle patch centered at origin, then rotated and translated
        # matplotlib Rectangle origin is bottom-left; we center it manually
        rect_patch = mpatches.FancyBboxPatch(
            (-fw / 2, -fh / 2),
            fw, fh,
            boxstyle="square,pad=0",
            facecolor=color,
            edgecolor="black",
            linewidth=1.2,
            alpha=0.75,
            zorder=2,
        )

        # Rotation transform: rotate around the rectangle's own center, then translate
        # Note: matplotlib uses counter-clockwise degrees; image angle is clockwise,
        # and Y is inverted, so we negate the angle.
        transform = (
            Affine2D()
            .rotate_deg(-angle)
            .translate(cx, cy)
            + ax.transData
        )
        rect_patch.set_transform(transform)
        ax.add_patch(rect_patch)

        label = f"{item['type'].replace('_', ' ')}\n{item['width']:.0f}×{item['height']:.0f}px"
        ax.text(
            cx, cy, label,
            ha="center", va="center",
            fontsize=7, fontweight="bold",
            color="white",
            zorder=3,
        )

    # Legend
    legend_handles = [
        mpatches.Patch(facecolor="#444444", edgecolor="black", label="Wall (H/V)"),
    ]
    for ft, cfg in FURNITURE_COLORS.items():
        legend_handles.append(
            mpatches.Patch(facecolor=cfg["matplotlib_color"], edgecolor="black",
                           label=f"{ft.replace('_', ' ').title()} ({cfg['color']})")
        )
    ax.legend(handles=legend_handles, loc="upper right", fontsize=8)

    plt.tight_layout()
    plt.savefig(output_path, dpi=150, bbox_inches="tight")
    print(f"Visualization saved → {output_path}")

    if show:
        plt.show()

    plt.close()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Extract floor plan wall and furniture coordinates.")
    parser.add_argument("image", help="Path to the floor plan image (PNG/JPG)")
    parser.add_argument("--show", action="store_true", help="Open interactive matplotlib window")
    parser.add_argument("--min-length", type=int, default=40, metavar="PX",
                        help="Minimum wall length in pixels (default: 40)")
    parser.add_argument("--min-furniture", type=int, default=200, metavar="PX2",
                        help="Minimum furniture contour area in pixels² (default: 200)")
    parser.add_argument("--output-dir", default="output", help="Output directory (default: ./output)")
    args = parser.parse_args()

    if not os.path.isfile(args.image):
        print(f"Error: file not found: {args.image}", file=sys.stderr)
        sys.exit(1)

    img = cv2.imread(args.image)
    if img is None:
        print(f"Error: could not read image: {args.image}", file=sys.stderr)
        sys.exit(2)

    h, w = img.shape[:2]
    print(f"Image loaded: {w}×{h} px  ({args.image})")

    print("Detecting walls...")
    walls = detect_walls(img, min_length=args.min_length)
    print(f"  → {len(walls)} wall segment(s) found")

    print("Detecting furniture...")
    furniture = detect_furniture(img, min_area=args.min_furniture)
    print(f"  → {len(furniture)} furniture item(s) found")

    # Summarize furniture counts by type
    by_type: dict[str, int] = {}
    for item in furniture:
        by_type[item["type"]] = by_type.get(item["type"], 0) + 1

    result = {
        "image_path": os.path.abspath(args.image),
        "image_width": w,
        "image_height": h,
        "walls": walls,
        "furniture": furniture,
        "summary": {
            "wall_count": len(walls),
            "furniture_count": len(furniture),
            "furniture_by_type": by_type,
        },
    }

    os.makedirs(args.output_dir, exist_ok=True)

    json_path = os.path.join(args.output_dir, "result.json")
    with open(json_path, "w") as f:
        json.dump(result, f, indent=2)
    print(f"JSON saved → {json_path}")

    stem = os.path.splitext(os.path.basename(args.image))[0]
    viz_path = os.path.join(args.output_dir, f"{stem}_visualization.png")
    visualize(img.shape, walls, furniture, viz_path, show=args.show)

    print("\nSummary:")
    h_walls = [w for w in walls if w["orientation"] == "horizontal"]
    v_walls = [w for w in walls if w["orientation"] == "vertical"]
    print(f"  Walls:     {len(walls)}  (H={len(h_walls)}, V={len(v_walls)})")
    print(f"  Furniture: {len(furniture)}")
    for ftype, count in by_type.items():
        print(f"    {ftype}: {count}")


if __name__ == "__main__":
    main()
