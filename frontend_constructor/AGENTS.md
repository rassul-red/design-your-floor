# AGENTS.md — Floor Plan Editor (`frontend_constructor`)

This document describes the codebase for AI agents working on this project.

---

## Project Overview

A browser-based floor plan drawing tool built with React 19, TypeScript, and Vite. Users draw polygonal rooms on an HTML5 canvas, place doors/windows on walls, and export the result as JSON or PNG.

**Tech stack:** React 19 · TypeScript · Vite · Zustand (state) · polygon-clipping (CSG) · file-saver (PNG export)

---

## Project Structure

```
frontend_constructor/
├── src/
│   ├── main.tsx                  # React entry point
│   ├── App.tsx                   # Root layout: Toolbar | Canvas | PropertiesPanel / ExportBar
│   ├── canvas/
│   │   ├── CanvasRenderer.ts     # Imperative HTML5 Canvas drawing logic
│   │   ├── GridRenderer.ts       # Dot/line grid drawing
│   │   ├── ViewportTransform.ts  # Pan/zoom world↔screen coordinate mapping
│   │   └── colors.ts             # Category → fill color mapping
│   ├── components/
│   │   ├── CanvasContainer.tsx   # Canvas element + event wiring + tool dispatch
│   │   ├── Toolbar.tsx           # Tool buttons + room category selector
│   │   ├── PropertiesPanel.tsx   # Selected element properties + metadata fields
│   │   └── ExportBar.tsx         # JSON export + PNG export buttons + import
│   ├── geometry/
│   │   ├── wallGenerator.ts      # Polygon buffer + CSG to produce wall/inner geometry
│   │   ├── polygonOps.ts         # Point-to-segment distance, polygon area
│   │   └── snap.ts               # Grid snapping helper
│   ├── io/
│   │   ├── jsonExport.ts         # Serialize plan → ResPlan-compatible JSON
│   │   ├── jsonImport.ts         # Parse ResPlan JSON → rooms + elements
│   │   └── imageExport.ts        # Render canvas off-screen → PNG blob
│   ├── store/
│   │   ├── planStore.ts          # Zustand store: rooms, elements, undo/redo, metadata
│   │   └── types.ts              # All shared TypeScript types
│   ├── tools/
│   │   ├── ToolManager.ts        # Tool interface definition
│   │   ├── DrawRoomTool.ts       # Click-to-place polygon vertices, close on first vertex
│   │   ├── PlaceDoorTool.ts      # Drag on wall edge to size door/window/front_door rect
│   │   └── SelectTool.ts         # Click to select, drag to move rooms/elements
│   └── types/
│       └── polygon-clipping.d.ts # Type shim for polygon-clipping package
├── index.html
├── vite.config.ts
├── tsconfig.app.json
├── package.json
└── dist/                         # Vite build output (committed)
```

---

## Data Model

All types live in `src/store/types.ts`.

```ts
// A drawn room polygon
Room { id, category: RoomCategory, vertices: Point[], label? }

// A placed door/window rectangle (4 vertices)
PlacedElement { id, category: ElementCategory, vertices: Point[] }

// Canvas/plan configuration
PlanMetadata { id, unitType, pixelsPerMeter, wallDepth, gridSize }

// Available tools
ToolType = 'select' | 'draw_room' | 'draw_wall' | 'place_door' | 'place_window' | 'place_front_door'

// Room categories
RoomCategory = 'living' | 'bedroom' | 'bathroom' | 'kitchen' | 'balcony' | 'storage'

// Element categories
ElementCategory = 'door' | 'window' | 'front_door' | 'wall'
```

---

## State Management

`src/store/planStore.ts` — Zustand store (single global store, no context provider needed).

Key state fields:
- `rooms: Room[]` — all drawn room polygons
- `elements: PlacedElement[]` — placed doors/windows
- `metadata: PlanMetadata` — plan settings (scale, wall depth, grid)
- `selectedId: string | null` — currently selected room or element
- `activeTool: ToolType`
- `undoStack / redoStack` — snapshots of `{ rooms, elements }`, max 50 deep

Key actions: `addRoom`, `removeRoom`, `moveRoom`, `addElement`, `removeElement`, `moveElement`, `undo`, `redo`, `clearAll`, `loadPlan`, `setActiveTool`.

---

## Canvas & Rendering

**`CanvasContainer.tsx`** — owns the `<canvas>` element. On every frame it:
1. Reads state from Zustand
2. Calls `CanvasRenderer.render(...)` which draws: background → grid → walls (behind rooms) → rooms → elements → tool overlay → drag preview

**`CanvasRenderer.ts`** — pure imperative Canvas 2D drawing. Uses `ViewportTransform` to convert world ↔ screen coordinates. Caches wall geometry so it is not recomputed on every mouse move.

**`ViewportTransform.ts`** — stores `scale`, `offsetX`, `offsetY`. Methods: `worldToScreen(pt)`, `screenToWorld(pt)`.

**`GridRenderer.ts`** — draws an evenly-spaced dot grid using the current viewport transform.

**Wall geometry** (`geometry/wallGenerator.ts`):
- Unions all room polygons with `polygon-clipping`
- Buffers the union outward by `wallDepth` pixels
- Subtracts the original union → **wall ring**
- Subtracts placed door/window rectangles from wall ring → openings

---

## Tools

All tools implement the `Tool` interface (`ToolManager.ts`):

```ts
interface Tool {
  onMouseDown(worldPoint, screenPoint, event): void;
  onMouseMove(worldPoint, screenPoint, event): void;
  onMouseUp(worldPoint, screenPoint, event): void;
  getDrawingVertices(): Point[] | null;  // in-progress polygon preview
  getPreviewRect(): Point[] | null;      // door drag preview rect
  getCursor(): string;
  reset(): void;
}
```

**`DrawRoomTool`** — click to add vertices; clicking near the first vertex (within 12px) closes the polygon and calls `store.addRoom(...)`.

**`PlaceDoorTool`** — on mousedown, finds the nearest wall edge within 20px. On drag, projects cursor along the edge and builds a 4-point rectangle of `wallDepth` thickness. On mouseup, snaps to grid and calls `store.addElement(...)`. Reused for `door`, `window`, and `front_door` by passing `category` to constructor.

**`SelectTool`** — click hit-tests rooms then elements; drag moves selected item by delta.

---

## I/O

**`io/jsonExport.ts`** — converts the plan to a ResPlan-compatible JSON structure:
- Rooms grouped by category as GeoJSON `MultiPolygon`
- Elements (door, window, front_door) as GeoJSON `Polygon` or `MultiPolygon`
- Computed `wall` and `inner` MultiPolygons from `generateWalls()`
- `area` (total) and `net_area` (sum of rooms) in m²

**`io/jsonImport.ts`** — parses a ResPlan JSON file, extracts room polygons and element polygons, calls `store.loadPlan(...)`.

**`io/imageExport.ts`** — creates an off-screen canvas at 512×512, calls `CanvasRenderer.renderForExport(...)`, converts to PNG blob, triggers download via `file-saver`.

---

## Key Conventions

- **World coordinates** are in canvas pixels at scale 1 (not screen pixels). Pan/zoom is handled by `ViewportTransform`.
- **Grid snapping** rounds world coordinates to the nearest `gridSize` (default 4px).
- **Wall depth** is stored in world pixels (default 4.5px ≈ 15cm at 30px/m).
- `pixelsPerMeter` (default 30) is only used for area calculations in export; it does not affect drawing coordinates.
- IDs are generated as `${category}_${Date.now()}_${randomSuffix}`.
- No external routing, no backend — fully client-side SPA.
- Undo/redo snapshots only `rooms` and `elements` (not `metadata` or `selectedId`).
