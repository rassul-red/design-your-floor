# Floor Plan Editor

A browser-based floor plan drawing tool. Draw polygonal rooms, place doors and windows on walls, then export the result as a ResPlan-compatible JSON or a PNG image.

## Features

- Draw freeform polygonal rooms (click vertices, close by clicking near the start)
- Place doors, windows, and front doors by dragging along any wall edge
- Automatic wall geometry generated from room polygons (with door/window openings cut out)
- Select and drag rooms or elements to reposition them
- Undo / Redo (Ctrl+Z / Ctrl+Shift+Z)
- Pan (middle-mouse drag or Space+drag) and zoom (scroll wheel)
- Export plan as JSON (ResPlan format with GeoJSON geometry)
- Export plan as PNG (512×512, no grid)
- Import a saved JSON plan

## Getting Started

```bash
npm install
npm run dev
```

Open `http://localhost:5173` in your browser.

## Build

```bash
npm run build
```

Output is placed in `dist/`.

## Usage

### Drawing Rooms

1. Select a room category from the toolbar (Living, Bedroom, Bathroom, Kitchen, Balcony, Storage).
2. Click on the canvas to place polygon vertices.
3. Click near the first vertex (highlighted in green) to close the room.

### Placing Doors & Windows

1. Select **Door**, **Window**, or **Front Door** from the toolbar.
2. Click and drag along any room wall edge. Release to place.
3. A minimum size is enforced (click without dragging for a default-size opening).

### Selecting & Moving

1. Switch to the **Select** tool.
2. Click a room or element to select it (shown with a blue outline).
3. Drag to move it. Press **Delete** to remove the selected item.

### Exporting

- **Export JSON** — downloads a ResPlan-format `.json` file with room polygons, element polygons, generated wall geometry, and computed areas (m²).
- **Export PNG** — downloads a 512×512 PNG of the plan (no grid).
- **Import JSON** — load a previously exported plan.

## Plan Settings

Accessible in the **Properties Panel** (right sidebar) when nothing is selected:

| Setting | Default | Description |
|---|---|---|
| Unit Type | Apartment | Label included in JSON export |
| Pixels / Meter | 30 | Used for area calculation in export |
| Wall Depth | 4.5 px | Thickness of generated walls |
| Grid Size | 4 px | Snapping resolution |

## JSON Export Format

The exported JSON follows the ResPlan schema used by the 3D creator pipeline:

```json
{
  "id": 0,
  "unitType": "Apartment",
  "area": 45.2,
  "net_area": 42.1,
  "wall_depth": 4.5,
  "living":    { "type": "MultiPolygon", "coordinates": [...] },
  "bedroom":   { "type": "MultiPolygon", "coordinates": [...] },
  "door":      { "type": "MultiPolygon", "coordinates": [...] },
  "window":    null,
  "front_door": { "type": "Polygon", "coordinates": [...] },
  "wall":      { "type": "MultiPolygon", "coordinates": [...] },
  "inner":     { "type": "MultiPolygon", "coordinates": [...] }
}
```

All coordinates are in canvas pixels. `area` and `net_area` are in m² (computed using `pixelsPerMeter`).

## Tech Stack

- React 19
- TypeScript
- Vite
- Zustand — global state + undo/redo
- polygon-clipping — CSG boolean ops for wall generation
- file-saver — PNG download
