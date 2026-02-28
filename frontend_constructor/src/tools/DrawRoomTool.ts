import type { Tool } from './ToolManager';
import type { Point, RoomCategory } from '../store/types';
import { snapToGrid, distanceBetween } from '../geometry/snap';
import { usePlanStore } from '../store/planStore';

export class DrawRoomTool implements Tool {
  private vertices: Point[] = [];
  private getGridSize: () => number;
  private getCategory: () => RoomCategory;
  private justFinished = false;

  constructor(getGridSize: () => number, getCategory: () => RoomCategory) {
    this.getGridSize = getGridSize;
    this.getCategory = getCategory;
  }

  onMouseDown(worldPoint: Point, _screenPoint: Point, event: MouseEvent) {
    if (event.button !== 0) return;

    // Skip the click right after finishing a room (from dblclick's second mousedown)
    if (this.justFinished) {
      this.justFinished = false;
      return;
    }

    const snapped = snapToGrid(worldPoint, this.getGridSize());

    // Check if clicking near first vertex to close
    if (this.vertices.length >= 3) {
      if (distanceBetween(snapped, this.vertices[0]) < this.getGridSize() * 1.5) {
        this.finishRoom();
        return;
      }
    }

    // Check not duplicate of last vertex
    if (this.vertices.length > 0) {
      const last = this.vertices[this.vertices.length - 1];
      if (last.x === snapped.x && last.y === snapped.y) return;
    }

    this.vertices.push(snapped);
  }

  onMouseMove() {}
  onMouseUp() {}

  onDoubleClick() {
    // The two clicks of the dblclick already added up to 2 extra vertices.
    // Remove the last one (duplicate from 2nd click), then close if enough vertices.
    if (this.vertices.length > 0) {
      // Remove the vertex added by the 2nd click of dblclick
      this.vertices.pop();
    }
    if (this.vertices.length >= 3) {
      this.finishRoom();
      this.justFinished = true;
    }
  }

  onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      this.vertices = [];
    } else if (event.key === 'Backspace' && this.vertices.length > 0) {
      this.vertices.pop();
    }
  }

  private finishRoom() {
    if (this.vertices.length < 3) return;

    const id = `room_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const room = {
      id,
      category: this.getCategory(),
      vertices: [...this.vertices],
    };

    usePlanStore.getState().addRoom(room);
    this.vertices = [];
  }

  getDrawingVertices(): Point[] | null {
    return this.vertices.length > 0 ? this.vertices : null;
  }

  getCursor(): string {
    return 'crosshair';
  }

  reset() {
    this.vertices = [];
    this.justFinished = false;
  }
}
