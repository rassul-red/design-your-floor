import type { Tool } from './ToolManager';
import type { Point } from '../store/types';
import { pointInPolygon } from '../geometry/polygonOps';
import { snapToGrid } from '../geometry/snap';
import { usePlanStore } from '../store/planStore';

export class SelectTool implements Tool {
  private isDragging = false;
  private dragStartWorld: Point | null = null;
  private dragLastWorld: Point | null = null;
  private getGridSize: () => number;

  constructor(getGridSize: () => number) {
    this.getGridSize = getGridSize;
  }

  onMouseDown(worldPoint: Point, _screenPoint: Point, event: MouseEvent) {
    if (event.button !== 0) return;

    const store = usePlanStore.getState();
    const { rooms, elements } = store;

    // Hit test elements first (on top), then rooms
    for (let i = elements.length - 1; i >= 0; i--) {
      if (pointInPolygon(worldPoint, elements[i].vertices)) {
        store.setSelectedId(elements[i].id);
        this.isDragging = true;
        this.dragStartWorld = worldPoint;
        this.dragLastWorld = worldPoint;
        return;
      }
    }

    for (let i = rooms.length - 1; i >= 0; i--) {
      if (pointInPolygon(worldPoint, rooms[i].vertices)) {
        store.setSelectedId(rooms[i].id);
        this.isDragging = true;
        this.dragStartWorld = worldPoint;
        this.dragLastWorld = worldPoint;
        return;
      }
    }

    store.setSelectedId(null);
  }

  onMouseMove(worldPoint: Point) {
    if (!this.isDragging || !this.dragLastWorld) return;

    const store = usePlanStore.getState();
    const selectedId = store.selectedId;
    if (!selectedId) return;

    const snapped = snapToGrid(worldPoint, this.getGridSize());
    const lastSnapped = snapToGrid(this.dragLastWorld, this.getGridSize());
    const dx = snapped.x - lastSnapped.x;
    const dy = snapped.y - lastSnapped.y;

    if (dx === 0 && dy === 0) return;

    // Push undo only at drag start
    if (this.dragStartWorld === this.dragLastWorld) {
      store.pushUndo();
    }

    const room = store.rooms.find((r) => r.id === selectedId);
    if (room) {
      store.moveRoom(selectedId, dx, dy);
    } else {
      store.moveElement(selectedId, dx, dy);
    }

    this.dragLastWorld = worldPoint;
  }

  onMouseUp() {
    this.isDragging = false;
    this.dragStartWorld = null;
    this.dragLastWorld = null;
  }

  onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Delete' || event.key === 'Backspace') {
      const store = usePlanStore.getState();
      if (store.selectedId) {
        const isRoom = store.rooms.some((r) => r.id === store.selectedId);
        if (isRoom) {
          store.removeRoom(store.selectedId);
        } else {
          store.removeElement(store.selectedId);
        }
      }
    }
  }

  getDrawingVertices(): Point[] | null {
    return null;
  }

  getCursor(): string {
    return 'default';
  }

  reset() {
    this.isDragging = false;
    this.dragStartWorld = null;
    this.dragLastWorld = null;
  }
}
