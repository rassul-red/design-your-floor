<div align="center">

# ✏️ Floor Plan Editor

### *Browser-based vector floor plan drawing tool*

[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?style=flat-square&logo=typescript)](https://www.typescriptlang.org)
[![Vite](https://img.shields.io/badge/Vite-7-646CFF?style=flat-square&logo=vite)](https://vitejs.dev)
[![Zustand](https://img.shields.io/badge/Zustand-5-orange?style=flat-square)](https://zustand-demo.pmnd.rs)

Draw polygonal rooms, place doors and windows on walls, then export the result as a **ResPlan-compatible JSON** or a **PNG image** — ready for the 3D creator and furniture placement pipeline.

</div>

---

## ✨ Features

| Feature | Details |
|---|---|
| 🖊️ **Polygon rooms** | Click vertices on canvas, click near the start (green dot) to close |
| 🚪 **Doors & Windows** | Drag along any wall edge to place — front door, door, or window |
| 🧱 **Auto wall geometry** | Walls generated from room polygons with openings cut out via polygon-clipping |
| 🖱️ **Select & Move** | Click any room/element to select; drag to reposition; `Delete` to remove |
| ↩️ **Undo / Redo** | Full history stack — `Ctrl+Z` / `Ctrl+Shift+Z` |
| 🔍 **Pan & Zoom** | Middle-mouse drag or `Space+drag` to pan; scroll wheel to zoom |
| 📐 **Ruler & Grid** | Live ruler overlay and snapping grid |
| 📤 **Export JSON** | ResPlan-format with GeoJSON geometry and computed areas (m²) |
| 🖼️ **Export PNG** | Clean 512×512 plan image (grid hidden) |
| 📥 **Import JSON** | Reload any previously saved plan |

---

## 🚀 Getting Started

```bash
cd frontend_constructor
npm install
npm run dev
```

Open **http://localhost:5173** in your browser.

### Build for production

```bash
npm run build
# output → dist/
```

---

## 🎨 Room Categories & Colors

| Category | Color | Keyboard Shortcut |
|---|---|---|
| 🟤 Living | `#d9d9d9` (light grey) | select in toolbar |
| 🟢 Bedroom | `#66c2a5` (teal) | select in toolbar |
| 🟠 Bathroom | `#fc8d62` (orange) | select in toolbar |
| 🔵 Kitchen | `#8da0cb` (blue) | select in toolbar |
| ⚫ Balcony | `#b3b3b3` (grey) | select in toolbar |
| 🟡 Storage | `#e5c494` (sand) | select in toolbar |

---

## ⌨️ Keyboard Shortcuts

| Key | Action |
|---|---|
| `S` | Switch to Select tool |
| `R` | Switch to Draw Room tool |
| `L` | Draw Wall |
| `D` | Place Door |
| `W` | Place Window |
| `F` | Place Front Door |
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` | Redo |
| `Delete` | Remove selected element |
| `Space + Drag` | Pan canvas |
| `Scroll` | Zoom in / out |

---

## 🖱️ Usage Guide

### Drawing Rooms

1. Select a room category from the toolbar (`Living`, `Bedroom`, `Bathroom`, `Kitchen`, `Balcony`, `Storage`).
2. Click on the canvas to place polygon vertices.
3. Click near the **first vertex** (highlighted in green) to close and finalize the room.

### Placing Doors & Windows

1. Select **Door**, **Window**, or **Front Door** from the toolbar.
2. **Click and drag** along any room wall edge. Release to place the opening.
3. A minimum size is enforced — a single click places a default-size opening.

### Selecting & Moving

1. Switch to the **Select** tool (`S`).
2. Click a room or element to select it (highlighted with a blue outline).
3. **Drag** to reposition. Press **`Delete`** to remove.

---

## ⚙️ Plan Settings

Accessible in the **Properties Panel** (right sidebar) when nothing is selected:

| Setting | Default | Description |
|---|---|---|
| Unit Type | `Apartment` | Label included in JSON export |
| Pixels / Meter | `30` | Used for m² area calculation |
| Wall Depth | `4.5 px` | Thickness of generated walls |
| Grid Size | `4 px` | Snapping resolution |

---

## 📦 JSON Export Format

The exported JSON follows the **ResPlan schema** consumed by the 3D creator and furniture placement pipeline:

```json
{
  "id": 0,
  "unitType": "Apartment",
  "area": 45.2,
  "net_area": 42.1,
  "wall_depth": 4.5,
  "living":     { "type": "MultiPolygon", "coordinates": [...] },
  "bedroom":    { "type": "MultiPolygon", "coordinates": [...] },
  "door":       { "type": "MultiPolygon", "coordinates": [...] },
  "window":     null,
  "front_door": { "type": "Polygon",      "coordinates": [...] },
  "wall":       { "type": "MultiPolygon", "coordinates": [...] },
  "inner":      { "type": "MultiPolygon", "coordinates": [...] }
}
```

All coordinates are in **canvas pixels**. `area` and `net_area` are in **m²** computed using `pixelsPerMeter`.

---

## 🗂️ Project Structure

```
frontend_constructor/
├── src/
│   ├── App.tsx                   # Root layout (Toolbar + Canvas + Properties + ExportBar)
│   ├── main.tsx                  # Entry point
│   ├── canvas/
│   │   ├── CanvasRenderer.ts     # Main render loop (rooms, walls, grid, rulers)
│   │   ├── colors.ts             # Category → hex color & label maps
│   │   ├── GridRenderer.ts       # Dot/line grid rendering
│   │   ├── RulerRenderer.ts      # Ruler overlay
│   │   └── ViewportTransform.ts  # Pan / zoom coordinate transform
│   ├── components/
│   │   ├── CanvasContainer.tsx   # Canvas mount + event forwarding
│   │   ├── ExportBar.tsx         # JSON / PNG export + import buttons
│   │   ├── PropertiesPanel.tsx   # Right sidebar settings panel
│   │   └── Toolbar.tsx           # Tool & room category buttons
│   ├── geometry/
│   │   ├── polygonOps.ts         # Area, centroid, helpers
│   │   ├── snap.ts               # Grid snap logic
│   │   └── wallGenerator.ts      # Polygon-offset wall CSG operations
│   ├── io/
│   │   ├── imageExport.ts        # Canvas → 512×512 PNG
│   │   ├── jsonExport.ts         # State → ResPlan JSON
│   │   └── jsonImport.ts         # ResPlan JSON → State
│   ├── store/
│   │   ├── planStore.ts          # Zustand store + undo/redo
│   │   └── types.ts              # Room, Element, PlanMetadata types
│   └── tools/
│       ├── DrawRoomTool.ts       # Polygon-drawing state machine
│       ├── PlaceDoorTool.ts      # Door/window drag placement
│       ├── SelectTool.ts         # Selection + drag-move
│       └── ToolManager.ts        # Tool registry & switching
├── package.json
├── vite.config.ts
└── tsconfig.json
```

---

## 🔧 Tech Stack

| Library | Purpose |
|---|---|
| **React 19** | UI rendering |
| **TypeScript 5.9** | Type safety |
| **Vite 7** | Dev server & build |
| **Zustand 5** | Global state + undo/redo stacks |
| **polygon-clipping** | CSG boolean ops for wall generation |
| **file-saver** | Client-side file download |
