import type { ViewportTransform } from './ViewportTransform';

const RULER_SIZE = 20;
const RULER_BG = '#f0f0f0';
const RULER_TEXT = '#555555';
const TICK_COLOR = '#999999';

export class RulerRenderer {
  render(
    ctx: CanvasRenderingContext2D,
    vt: ViewportTransform,
    width: number,
    height: number,
    pixelsPerMeter: number,
  ) {
    ctx.save();

    // Choose tick interval based on zoom: aim for ~50-100px between labels
    const screenPerMeter = pixelsPerMeter * vt.scale;
    const labelInterval = this.chooseLabelInterval(screenPerMeter);
    const tickInterval = labelInterval;

    // World range visible on screen
    const worldTopLeft = vt.screenToWorld({ x: 0, y: 0 });
    const worldBottomRight = vt.screenToWorld({ x: width, y: height });

    // Horizontal ruler (top)
    ctx.fillStyle = RULER_BG;
    ctx.fillRect(RULER_SIZE, 0, width - RULER_SIZE, RULER_SIZE);

    // Corner square
    ctx.fillRect(0, 0, RULER_SIZE, RULER_SIZE);

    const startMeterX = Math.floor(worldTopLeft.x / pixelsPerMeter / tickInterval) * tickInterval;
    const endMeterX = Math.ceil(worldBottomRight.x / pixelsPerMeter / tickInterval) * tickInterval;

    ctx.font = '9px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';

    for (let m = startMeterX; m <= endMeterX; m += tickInterval) {
      const worldX = m * pixelsPerMeter;
      const screenX = vt.worldToScreen({ x: worldX, y: 0 }).x;
      if (screenX < RULER_SIZE || screenX > width) continue;

      // Tick mark
      ctx.strokeStyle = TICK_COLOR;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(screenX, RULER_SIZE - 6);
      ctx.lineTo(screenX, RULER_SIZE);
      ctx.stroke();

      // Label
      if (m % labelInterval === 0) {
        ctx.fillStyle = RULER_TEXT;
        ctx.fillText(`${m}m`, screenX, RULER_SIZE - 7);
      }
    }

    // Bottom border of horizontal ruler
    ctx.strokeStyle = TICK_COLOR;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(RULER_SIZE, RULER_SIZE);
    ctx.lineTo(width, RULER_SIZE);
    ctx.stroke();

    // Vertical ruler (left)
    ctx.fillStyle = RULER_BG;
    ctx.fillRect(0, RULER_SIZE, RULER_SIZE, height - RULER_SIZE);

    const startMeterY = Math.floor(worldTopLeft.y / pixelsPerMeter / tickInterval) * tickInterval;
    const endMeterY = Math.ceil(worldBottomRight.y / pixelsPerMeter / tickInterval) * tickInterval;

    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    for (let m = startMeterY; m <= endMeterY; m += tickInterval) {
      const worldY = m * pixelsPerMeter;
      const screenY = vt.worldToScreen({ x: 0, y: worldY }).y;
      if (screenY < RULER_SIZE || screenY > height) continue;

      ctx.strokeStyle = TICK_COLOR;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(RULER_SIZE - 6, screenY);
      ctx.lineTo(RULER_SIZE, screenY);
      ctx.stroke();

      if (m % labelInterval === 0) {
        ctx.fillStyle = RULER_TEXT;
        ctx.save();
        ctx.translate(RULER_SIZE - 8, screenY);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(`${m}m`, 0, 0);
        ctx.restore();
      }
    }

    // Right border of vertical ruler
    ctx.strokeStyle = TICK_COLOR;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(RULER_SIZE, RULER_SIZE);
    ctx.lineTo(RULER_SIZE, height);
    ctx.stroke();

    ctx.restore();
  }

  private chooseLabelInterval(screenPerMeter: number): number {
    // Choose interval so labels are ~60-120px apart
    const candidates = [1, 2, 5, 10, 20, 50];
    for (const c of candidates) {
      if (c * screenPerMeter >= 50) return c;
    }
    return 100;
  }
}
