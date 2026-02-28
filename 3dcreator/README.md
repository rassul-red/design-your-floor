# 3D Creator MVP

Minimal end-to-end pipeline:

1. Load ResPlan JSON geometry.
2. Optionally detect furniture from layout image via template matching.
3. Build simple 3D blockout scene.
4. Render one image from user camera point + heading.

## Install

```bash
npm install
pip3 install -r python/requirements.txt
npx playwright install chromium
```

## Run

```bash
npm run pipeline -- \
  --plan "json examples/plan_346.json" \
  --image "layout_example.png" \
  --templates "templates" \
  --cameraPx "120,180" \
  --headingDeg 45 \
  --out out
```

## Interactive UI

```bash
npm run ui
```

Then open `http://127.0.0.1:4174`.

In the UI you can:
- Load plan JSON and optional furniture JSON.
- Load a layout image as overlay for camera picking.
- Click on the 2D picker to place the camera point.
- Adjust heading/pitch/FOV and inspect with orbit controls.
- Export the current viewport as PNG.

## Notes

- Wall height is fixed at `3.0m`.
- Camera height is fixed at `1.8m`.
- If no furniture JSON is provided and no templates are available, render still works with empty furniture.
