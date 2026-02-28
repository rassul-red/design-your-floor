import type { Tool } from './ToolManager';
import type { Point, ElementCategory, Room } from '../store/types';
import { snapToGrid } from '../geometry/snap';
import { pointToSegmentDistance } from '../geometry/polygonOps';
import { usePlanStore } from '../store/planStore';

interface WallSegment {
  a: Point;
  b: Point;
  /** Unit vector along wall (a→b) */
  ux: number;
  uy: number;
  /** Normal (perpendicular) to wall */
  nx: number;
  ny: number;
  length: number;
}

const MIN_LENGTHS: Partial<Record<ElementCategory, number>> = {
  door: 8,
  window: 6,
  front_door: 10,
};

function findNearestWallSegment(
  worldPoint: Point,
  rooms: Room[],
  threshold: number,
): WallSegment | null {
  let bestDist = Infinity;
  let bestSeg: WallSegment | null = null;

  for (const room of rooms) {
    const verts = room.vertices;
    for (let i = 0; i < verts.length; i++) {
      const a = verts[i];
      const b = verts[(i + 1) % verts.length];
      const result = pointToSegmentDistance(worldPoint, a, b);
      if (result.distance < bestDist) {
        bestDist = result.distance;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        bestSeg = {
          a,
          b,
          ux: dx / len,
          uy: dy / len,
          nx: -dy / len,
          ny: dx / len,
          length: len,
        };
      }
    }
  }

  return bestDist < threshold ? bestSeg : null;
}

/** Project point onto segment a→b, return parameter t clamped to [0, 1] */
function projectOntoSegment(p: Point, seg: WallSegment): number {
  const apx = p.x - seg.a.x;
  const apy = p.y - seg.a.y;
  const t = (apx * seg.ux + apy * seg.uy) / seg.length;
  return Math.max(0, Math.min(1, t));
}

function buildRect(seg: WallSegment, t1: number, t2: number, wallDepth: number): Point[] {
  const tMin = Math.min(t1, t2);
  const tMax = Math.max(t1, t2);

  const p1x = seg.a.x + tMin * seg.length * seg.ux;
  const p1y = seg.a.y + tMin * seg.length * seg.uy;
  const p2x = seg.a.x + tMax * seg.length * seg.ux;
  const p2y = seg.a.y + tMax * seg.length * seg.uy;

  // Normal (nx, ny) points inward (into the room).
  // Wall band extends from room edge outward (the -n direction) by wallDepth.
  // Place the element rect from room edge to wallDepth outward so it fully covers the wall.
  return [
    { x: p1x, y: p1y },
    { x: p2x, y: p2y },
    { x: p2x - seg.nx * wallDepth, y: p2y - seg.ny * wallDepth },
    { x: p1x - seg.nx * wallDepth, y: p1y - seg.ny * wallDepth },
  ];
}

export class PlaceDoorTool implements Tool {
  private category: ElementCategory;
  private getWallDepth: () => number;

  // Drag state
  private dragging = false;
  private wallSegment: WallSegment | null = null;
  private t1 = 0;
  private t2 = 0;
  private previewRect: Point[] | null = null;

  constructor(category: ElementCategory, getWallDepth: () => number) {
    this.category = category;
    this.getWallDepth = getWallDepth;
  }

  onMouseDown(worldPoint: Point, _screenPoint: Point, event: MouseEvent) {
    if (event.button !== 0) return;

    const store = usePlanStore.getState();
    const nearest = findNearestWallSegment(worldPoint, store.rooms, 20);
    if (!nearest) return;

    this.dragging = true;
    this.wallSegment = nearest;
    this.t1 = projectOntoSegment(worldPoint, nearest);
    this.t2 = this.t1;
    this.previewRect = buildRect(nearest, this.t1, this.t2, this.getWallDepth());
  }

  onMouseMove(worldPoint: Point, _screenPoint: Point, _event: MouseEvent) {
    if (!this.dragging || !this.wallSegment) return;

    this.t2 = projectOntoSegment(worldPoint, this.wallSegment);
    this.previewRect = buildRect(this.wallSegment, this.t1, this.t2, this.getWallDepth());
  }

  onMouseUp(worldPoint: Point, _screenPoint: Point, event: MouseEvent) {
    if (event.button !== 0 || !this.dragging || !this.wallSegment) {
      this.reset();
      return;
    }

    this.t2 = projectOntoSegment(worldPoint, this.wallSegment);

    const store = usePlanStore.getState();
    const wallDepth = this.getWallDepth();
    const gridSize = store.metadata.gridSize;

    let tMin = Math.min(this.t1, this.t2);
    let tMax = Math.max(this.t1, this.t2);
    let lengthAlongWall = (tMax - tMin) * this.wallSegment.length;

    // If the user barely dragged (click without drag), use a minimum length
    const minLen = MIN_LENGTHS[this.category] ?? 4;
    if (lengthAlongWall < minLen) {
      const tCenter = (tMin + tMax) / 2;
      const halfT = (minLen / 2) / this.wallSegment.length;
      tMin = Math.max(0, tCenter - halfT);
      tMax = Math.min(1, tCenter + halfT);
      lengthAlongWall = (tMax - tMin) * this.wallSegment.length;
    }

    // Skip if still too small (segment too short)
    if (lengthAlongWall < 1) {
      this.reset();
      return;
    }

    // Snap the endpoints along the wall to grid
    const p1Raw = {
      x: this.wallSegment.a.x + tMin * this.wallSegment.length * this.wallSegment.ux,
      y: this.wallSegment.a.y + tMin * this.wallSegment.length * this.wallSegment.uy,
    };
    const p2Raw = {
      x: this.wallSegment.a.x + tMax * this.wallSegment.length * this.wallSegment.ux,
      y: this.wallSegment.a.y + tMax * this.wallSegment.length * this.wallSegment.uy,
    };

    const p1 = snapToGrid(p1Raw, gridSize);
    const p2 = snapToGrid(p2Raw, gridSize);

    // Re-project snapped points back onto wall
    const tSnap1 = projectOntoSegment(p1, this.wallSegment);
    const tSnap2 = projectOntoSegment(p2, this.wallSegment);

    const vertices = buildRect(this.wallSegment, tSnap1, tSnap2, wallDepth);

    const id = `${this.category}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    store.addElement({ id, category: this.category, vertices });

    this.reset();
  }

  getDrawingVertices(): Point[] | null {
    return null;
  }

  getPreviewRect(): Point[] | null {
    return this.previewRect;
  }

  getCursor(): string {
    return 'crosshair';
  }

  reset() {
    this.dragging = false;
    this.wallSegment = null;
    this.t1 = 0;
    this.t2 = 0;
    this.previewRect = null;
  }
}
