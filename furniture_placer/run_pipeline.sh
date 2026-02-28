#!/usr/bin/env bash
set -euo pipefail

PLAN_ID="${1:-7031}"
VENV=".venv/bin/python3"

echo "=========================================="
echo "  Floor plan pipeline  —  plan $PLAN_ID"
echo "=========================================="

echo ""
echo "[1/3] Generating per-room PNGs + JSONs..."
$VENV visualize_rooms.py "examples/plan_${PLAN_ID}.json" --out-dir room_views

echo ""
echo "[2/3] Generating furnished room images with Gemini..."
$VENV gen_run_rooms.py room_views/ --out-dir gen_output

echo ""
echo "[3/3] Locating furniture in generated images..."
$VENV locate_furniture.py "$PLAN_ID" \
    --rooms-dir   room_views \
    --images-dir  gen_output \
    --out-dir     room_views_furnished

echo ""
echo "=========================================="
echo "  Done.  Results in room_views_furnished/"
echo "=========================================="
