import { ViewportTransform } from './ViewportTransform';

export class GridRenderer {
  render(
    ctx: CanvasRenderingContext2D,
    vt: ViewportTransform,
    gridSize: number,
    worldSize = 256,
  ) {
    ctx.save();

    // Grid lines
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 0.5;

    const steps = Math.ceil(worldSize / gridSize);
    for (let i = 0; i <= steps; i++) {
      const worldPos = i * gridSize;
      if (worldPos > worldSize) break;

      const screenStart = vt.worldToScreen({ x: worldPos, y: 0 });
      const screenEnd = vt.worldToScreen({ x: worldPos, y: worldSize });
      ctx.beginPath();
      ctx.moveTo(screenStart.x, screenStart.y);
      ctx.lineTo(screenEnd.x, screenEnd.y);
      ctx.stroke();

      const hStart = vt.worldToScreen({ x: 0, y: worldPos });
      const hEnd = vt.worldToScreen({ x: worldSize, y: worldPos });
      ctx.beginPath();
      ctx.moveTo(hStart.x, hStart.y);
      ctx.lineTo(hEnd.x, hEnd.y);
      ctx.stroke();
    }

    // World boundary
    const tl = vt.worldToScreen({ x: 0, y: 0 });
    const br = vt.worldToScreen({ x: worldSize, y: worldSize });
    ctx.strokeStyle = '#999';
    ctx.lineWidth = 1;
    ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);

    ctx.restore();
  }
}
