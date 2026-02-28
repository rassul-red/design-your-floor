import type { Point } from '../store/types';

export class ViewportTransform {
  // Offset in screen pixels
  offsetX = 0;
  offsetY = 0;
  scale = 1;

  /** Fit the 256x256 world into the given screen dimensions with padding */
  fitToScreen(screenWidth: number, screenHeight: number, worldSize = 256, padding = 40) {
    const availW = screenWidth - padding * 2;
    const availH = screenHeight - padding * 2;
    this.scale = Math.min(availW / worldSize, availH / worldSize);
    this.offsetX = (screenWidth - worldSize * this.scale) / 2;
    this.offsetY = (screenHeight - worldSize * this.scale) / 2;
  }

  /** World coords -> screen coords */
  worldToScreen(p: Point): Point {
    return {
      x: p.x * this.scale + this.offsetX,
      y: p.y * this.scale + this.offsetY,
    };
  }

  /** Screen coords -> world coords */
  screenToWorld(p: Point): Point {
    return {
      x: (p.x - this.offsetX) / this.scale,
      y: (p.y - this.offsetY) / this.scale,
    };
  }

  /** Zoom centered on screen point */
  zoomAt(screenPoint: Point, delta: number) {
    const worldBefore = this.screenToWorld(screenPoint);
    const factor = delta > 0 ? 0.9 : 1.1;
    this.scale = Math.max(0.5, Math.min(20, this.scale * factor));
    const worldAfter = this.screenToWorld(screenPoint);
    this.offsetX += (worldAfter.x - worldBefore.x) * this.scale;
    this.offsetY += (worldAfter.y - worldBefore.y) * this.scale;
  }

  /** Pan by screen pixel delta */
  pan(dx: number, dy: number) {
    this.offsetX += dx;
    this.offsetY += dy;
  }
}
