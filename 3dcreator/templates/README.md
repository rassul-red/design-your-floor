# Template Layout

Place furniture symbol templates in per-category subfolders:

- `bed/`
- `sofa/`
- `wardrobe/`
- `table/`
- `dining_table/`
- `chair/`
- `cabinet/`
- `kitchen_unit/`
- `toilet/`
- `sink/`
- `bathtub/`

Use PNG files. Rotation should be in filename suffix:

- `bed_0.png`
- `bed_90.png`
- `bed_180.png`
- `bed_270.png`

The detector reads `_<deg>` from the template filename and stores it as `rotDeg` in `detections.json`.
