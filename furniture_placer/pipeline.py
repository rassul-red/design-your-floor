#!/usr/bin/env python3
"""
pipeline.py — Full floor plan furnishing pipeline, end-to-end.

Steps
  1. visualize_rooms    → room_views/         per-room PNGs + JSONs
  2. gen_run_rooms      → gen_output/         Gemini-generated furnished room images
  3. locate_furniture   → room_views_furnished/  furniture coords + per-room renders
  4. Copy final files   → final_output/       plan_{id}_furnished.json  +  .png

Usage:
    python pipeline.py
    python pipeline.py 680          # override plan ID
"""

import os
import shutil
import sys
from pathlib import Path

# ── defaults ──────────────────────────────────────────────────────────────────
PLAN_ID       = int(sys.argv[1]) if len(sys.argv) > 1 else 7031
ROOMS_DIR     = "room_views"
GEN_DIR       = "gen_output"
FURNISHED_DIR = "room_views_furnished"
FINAL_DIR     = "final_output"


def _call(main_fn, argv: list):
    """Temporarily patch sys.argv and call a module's main()."""
    saved = sys.argv[:]
    sys.argv = argv
    try:
        main_fn()
    finally:
        sys.argv = saved


def main():
    print("=" * 58)
    print(f"  Floor plan pipeline  —  plan {PLAN_ID}")
    print("=" * 58)

    # ── Step 1: per-room PNGs + JSONs ─────────────────────────────────────────
    print(f"\n[1/3] Generating per-room PNGs + JSONs → {ROOMS_DIR}/")
    import visualize_rooms
    _call(visualize_rooms.main, [
        "visualize_rooms.py",
        f"examples/plan_{PLAN_ID}.json",
        "--out-dir", ROOMS_DIR,
    ])

    # ── Step 2: Gemini image generation ───────────────────────────────────────
    print(f"\n[2/3] Generating furnished room images → {GEN_DIR}/")
    import gen_run_rooms
    _call(gen_run_rooms.main, [
        "gen_run_rooms.py",
        f"{ROOMS_DIR}/",
        "--out-dir", GEN_DIR,
    ])

    # ── Step 3: furniture localization ────────────────────────────────────────
    print(f"\n[3/3] Locating furniture in generated images → {FURNISHED_DIR}/")
    import locate_furniture
    _call(locate_furniture.main, [
        "locate_furniture.py", str(PLAN_ID),
        "--rooms-dir",  ROOMS_DIR,
        "--images-dir", GEN_DIR,
        "--out-dir",    FURNISHED_DIR,
    ])

    # ── Step 4: copy final outputs ────────────────────────────────────────────
    print(f"\nCopying final outputs → {FINAL_DIR}/")
    os.makedirs(FINAL_DIR, exist_ok=True)

    copied = 0
    for ext in ("json", "png"):
        src = Path(FURNISHED_DIR) / f"plan_{PLAN_ID}_furnished.{ext}"
        if src.exists():
            dst = Path(FINAL_DIR) / src.name
            shutil.copy2(src, dst)
            print(f"  ✓  {dst}")
            copied += 1
        else:
            print(f"  ✗  {src} not found", file=sys.stderr)

    print()
    print("=" * 58)
    if copied:
        print(f"  Done.  Final outputs in {FINAL_DIR}/")
    else:
        print("  WARNING: no final outputs were produced.", file=sys.stderr)
    print("=" * 58)


if __name__ == "__main__":
    main()
