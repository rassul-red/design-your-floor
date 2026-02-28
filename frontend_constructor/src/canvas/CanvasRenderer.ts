import { ViewportTransform } from './ViewportTransform';
import { GridRenderer } from './GridRenderer';
import { CATEGORY_COLORS } from './colors';
import { generateWalls, multiPolygonToPoints } from '../geometry/wallGenerator';
import type { Room, PlacedElement, Point, PlanMetadata } from '../store/types';

export class CanvasRenderer {
  private gridRenderer = new GridRenderer();
  vt = new ViewportTransform();

  // Wall cache
  private wallCacheKey = '';
  private cachedWallPoints: Point[][][][] = [];
  private cachedInnerPoints: Point[][][][] = [];

  private computeWalls(rooms: Room[], wallDepth: number, elements: PlacedElement[] = []) {
    // Build a cache key from room ids, vertex positions, wall depth, and elements
    const roomKey = rooms
      .map((r) => `${r.id}:${r.vertices.map((v) => `${v.x},${v.y}`).join(';')}`)
      .join('|');
    const elemKey = elements
      .map((e) => `${e.id}:${e.vertices.map((v) => `${v.x},${v.y}`).join(';')}`)
      .join('|');
    const key = `${roomKey}|wd:${wallDepth}|el:${elemKey}`;

    if (key === this.wallCacheKey) return;
    this.wallCacheKey = key;

    if (rooms.length === 0) {
      this.cachedWallPoints = [];
      this.cachedInnerPoints = [];
      return;
    }

    const { walls, inner } = generateWalls(rooms, wallDepth, elements);
    this.cachedWallPoints = multiPolygonToPoints(walls).map((p) => [p]);
    this.cachedInnerPoints = multiPolygonToPoints(inner).map((p) => [p]);
  }

  render(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    rooms: Room[],
    elements: PlacedElement[],
    metadata: PlanMetadata,
    selectedId: string | null,
    drawingVertices: Point[] | null,
    cursorWorld: Point | null,
    showGrid = true,
    previewRect: Point[] | null = null,
    previewColor: string | null = null,
  ) {
    ctx.clearRect(0, 0, width, height);

    // 1. White background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    // 2. Grid
    if (showGrid) {
      this.gridRenderer.render(ctx, this.vt, metadata.gridSize);
    }

    // 3-4. Compute and draw walls (behind rooms), subtracting door/window openings
    this.computeWalls(rooms, metadata.wallDepth, elements);

    // Inner polygon (white fill to cover grid)
    for (const polygonGroup of this.cachedInnerPoints) {
      for (const polygon of polygonGroup) {
        this.drawPolygonRings(ctx, polygon, '#ffffff', null, 0);
      }
    }

    // Walls (yellow)
    for (const polygonGroup of this.cachedWallPoints) {
      for (const polygon of polygonGroup) {
        this.drawPolygonRings(ctx, polygon, CATEGORY_COLORS.wall, '#000000', 0.5);
      }
    }

    // 5. Rooms
    for (const room of rooms) {
      const isSelected = room.id === selectedId;
      this.drawRoom(ctx, room, isSelected);
    }

    // 6. Doors/windows/front_door
    for (const element of elements) {
      const isSelected = element.id === selectedId;
      this.drawElement(ctx, element, isSelected);
    }

    // 9. Tool overlay - drawing preview
    if (drawingVertices && drawingVertices.length > 0) {
      this.drawToolOverlay(ctx, drawingVertices, cursorWorld);
    }

    // 10. Element placement preview (door/window drag)
    if (previewRect && previewRect.length >= 3) {
      this.drawElementPreview(ctx, previewRect, previewColor);
    }
  }

  private drawPolygonRings(
    ctx: CanvasRenderingContext2D,
    rings: Point[][],
    fillColor: string | null,
    strokeColor: string | null,
    lineWidth: number,
  ) {
    if (rings.length === 0 || rings[0].length === 0) return;
    ctx.save();
    ctx.beginPath();

    for (const ring of rings) {
      const screenPts = ring.map((p) => this.vt.worldToScreen(p));
      if (screenPts.length < 3) continue;
      ctx.moveTo(screenPts[0].x, screenPts[0].y);
      for (let i = 1; i < screenPts.length; i++) {
        ctx.lineTo(screenPts[i].x, screenPts[i].y);
      }
      ctx.closePath();
    }

    if (fillColor) {
      ctx.fillStyle = fillColor;
      ctx.fill('evenodd');
    }
    if (strokeColor && lineWidth > 0) {
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawRoom(ctx: CanvasRenderingContext2D, room: Room, isSelected: boolean) {
    const screenPts = room.vertices.map((v) => this.vt.worldToScreen(v));
    if (screenPts.length < 3) return;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(screenPts[0].x, screenPts[0].y);
    for (let i = 1; i < screenPts.length; i++) {
      ctx.lineTo(screenPts[i].x, screenPts[i].y);
    }
    ctx.closePath();

    ctx.fillStyle = CATEGORY_COLORS[room.category];
    ctx.fill();

    ctx.strokeStyle = isSelected ? '#0066ff' : '#000000';
    ctx.lineWidth = isSelected ? 2 : 1;
    ctx.stroke();

    if (isSelected) {
      for (const sp of screenPts) {
        ctx.fillStyle = '#0066ff';
        ctx.fillRect(sp.x - 3, sp.y - 3, 6, 6);
      }
    }

    ctx.restore();
  }

  private drawElement(ctx: CanvasRenderingContext2D, element: PlacedElement, isSelected: boolean) {
    const screenPts = element.vertices.map((v) => this.vt.worldToScreen(v));
    if (screenPts.length < 3) return;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(screenPts[0].x, screenPts[0].y);
    for (let i = 1; i < screenPts.length; i++) {
      ctx.lineTo(screenPts[i].x, screenPts[i].y);
    }
    ctx.closePath();

    ctx.fillStyle = CATEGORY_COLORS[element.category];
    ctx.fill();

    if (element.category === 'wall' && !isSelected) {
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 0.5;
    } else {
      ctx.strokeStyle = isSelected ? '#0066ff' : '#000000';
      ctx.lineWidth = isSelected ? 2 : 0.5;
    }
    ctx.stroke();

    ctx.restore();
  }

  private drawToolOverlay(
    ctx: CanvasRenderingContext2D,
    vertices: Point[],
    cursorWorld: Point | null,
  ) {
    const screenPts = vertices.map((v) => this.vt.worldToScreen(v));
    const cursorScreen = cursorWorld ? this.vt.worldToScreen(cursorWorld) : null;

    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = '#0066ff';
    ctx.lineWidth = 1.5;
    ctx.fillStyle = 'rgba(0, 102, 255, 0.1)';

    ctx.beginPath();
    ctx.moveTo(screenPts[0].x, screenPts[0].y);
    for (let i = 1; i < screenPts.length; i++) {
      ctx.lineTo(screenPts[i].x, screenPts[i].y);
    }
    if (cursorScreen) {
      ctx.lineTo(cursorScreen.x, cursorScreen.y);
    }
    if (screenPts.length >= 3) {
      ctx.closePath();
      ctx.fill();
    }
    ctx.stroke();

    // Draw vertex dots
    ctx.setLineDash([]);
    for (const sp of screenPts) {
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#0066ff';
      ctx.fill();
    }

    // Close indicator
    if (cursorScreen && screenPts.length >= 3) {
      const dx = cursorScreen.x - screenPts[0].x;
      const dy = cursorScreen.y - screenPts[0].y;
      if (Math.sqrt(dx * dx + dy * dy) < 12) {
        ctx.beginPath();
        ctx.arc(screenPts[0].x, screenPts[0].y, 8, 0, Math.PI * 2);
        ctx.strokeStyle = '#00cc44';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  private drawElementPreview(
    ctx: CanvasRenderingContext2D,
    vertices: Point[],
    color: string | null,
  ) {
    const screenPts = vertices.map((v) => this.vt.worldToScreen(v));
    ctx.save();

    ctx.beginPath();
    ctx.moveTo(screenPts[0].x, screenPts[0].y);
    for (let i = 1; i < screenPts.length; i++) {
      ctx.lineTo(screenPts[i].x, screenPts[i].y);
    }
    ctx.closePath();

    // Semi-transparent fill
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = color ?? '#e78ac3';
    ctx.fill();

    // Dashed outline
    ctx.globalAlpha = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = color ?? '#e78ac3';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.restore();
  }

  /** Render for export: no grid, at a given size */
  renderForExport(
    ctx: CanvasRenderingContext2D,
    rooms: Room[],
    elements: PlacedElement[],
    metadata: PlanMetadata,
    size = 512,
  ) {
    const savedVt = this.vt;
    this.vt = new ViewportTransform();
    this.vt.scale = size / 256;
    this.vt.offsetX = 0;
    this.vt.offsetY = 0;

    this.render(ctx, size, size, rooms, elements, metadata, null, null, null, false);
    this.vt = savedVt;
  }
}
