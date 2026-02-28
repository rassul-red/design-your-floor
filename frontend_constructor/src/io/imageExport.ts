import { saveAs } from 'file-saver';
import { CanvasRenderer } from '../canvas/CanvasRenderer';
import { CATEGORY_COLORS } from '../canvas/colors';
import { getBoundingBox } from '../geometry/polygonOps';
import { computeNetRoomArea } from '../geometry/wallGenerator';
import type { Room, PlacedElement, PlanMetadata, Category } from '../store/types';

const TITLE_HEIGHT = 40;
const LEGEND_WIDTH = 170;
const PADDING = 30;
const MIN_PLAN_SIZE = 300;

/** Lowercase category labels for the export legend (matches reference style) */
const EXPORT_LABELS: Record<string, string> = {
  living: 'living',
  bedroom: 'bedroom',
  bathroom: 'bathroom',
  kitchen: 'kitchen',
  balcony: 'balcony',
  storage: 'storage',
  door: 'door',
  window: 'window',
  front_door: 'front door',
  wall: 'wall',
};

export function exportPNG(
  rooms: Room[],
  elements: PlacedElement[],
  metadata: PlanMetadata,
  filename = 'floor-plan.png',
) {
  // 1. Compute bounding box of all vertices
  const allVertices = [
    ...rooms.flatMap((r) => r.vertices),
    ...elements.flatMap((e) => e.vertices),
  ];

  if (allVertices.length === 0) return;

  const bbox = getBoundingBox(allVertices);
  const planWorldW = bbox.maxX - bbox.minX;
  const planWorldH = bbox.maxY - bbox.minY;

  // 2. Determine plan render area
  const planRenderSize = Math.max(MIN_PLAN_SIZE, Math.max(planWorldW, planWorldH) + PADDING * 2);
  const canvasW = planRenderSize + PADDING * 2 + LEGEND_WIDTH;
  const canvasH = planRenderSize + PADDING * 2 + TITLE_HEIGHT;

  // 3. Create offscreen canvas
  const offscreen = document.createElement('canvas');
  offscreen.width = canvasW;
  offscreen.height = canvasH;
  const ctx = offscreen.getContext('2d');
  if (!ctx) return;

  // 4. White background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvasW, canvasH);

  // 5. Set viewport transform to fit plan into left portion
  const renderer = new CanvasRenderer();
  const planAreaW = canvasW - LEGEND_WIDTH;
  const planAreaH = canvasH - TITLE_HEIGHT;

  const scale = Math.min(
    (planAreaW - PADDING * 2) / (planWorldW || 1),
    (planAreaH - PADDING * 2) / (planWorldH || 1),
  );

  const centerX = (bbox.minX + bbox.maxX) / 2;
  const centerY = (bbox.minY + bbox.maxY) / 2;

  renderer.vt.scale = scale;
  renderer.vt.offsetX = planAreaW / 2 - centerX * scale;
  renderer.vt.offsetY = TITLE_HEIGHT + planAreaH / 2 - centerY * scale;

  // 6. Render plan (no grid, no selection, no drawing overlay, no room labels)
  renderer.render(
    ctx, canvasW, canvasH,
    rooms, elements, metadata,
    null, null, null,
    false,
    null, null,
    false,
  );

  // 7. Draw title: "Plan #ID | UnitType | TotalArea m²"
  const ppm = metadata.pixelsPerMeter;
  let totalArea = 0;
  for (const room of rooms) {
    totalArea += computeNetRoomArea(room.vertices, metadata.wallDepth) / (ppm * ppm);
  }

  const titleParts: string[] = [];
  if (metadata.id) titleParts.push(`Plan #${metadata.id}`);
  if (metadata.unitType) titleParts.push(metadata.unitType);
  titleParts.push(`${totalArea.toFixed(1)} m\u00B2`);

  ctx.save();
  ctx.font = '16px sans-serif';
  ctx.fillStyle = '#333333';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(titleParts.join('  |  '), planAreaW / 2, TITLE_HEIGHT / 2);
  ctx.restore();

  // 8. Draw legend
  drawLegend(ctx, rooms, elements, planAreaW, TITLE_HEIGHT, LEGEND_WIDTH);

  // 9. Export
  offscreen.toBlob((blob) => {
    if (blob) saveAs(blob, filename);
  }, 'image/png');
}

function drawLegend(
  ctx: CanvasRenderingContext2D,
  rooms: Room[],
  elements: PlacedElement[],
  x: number,
  y: number,
  _width: number,
) {
  ctx.save();

  // Collect present categories in order (rooms first, then elements, wall last isn't needed — match reference order)
  const categories: Category[] = [];
  const seen = new Set<string>();

  // Room categories first
  for (const room of rooms) {
    if (!seen.has(room.category)) {
      categories.push(room.category);
      seen.add(room.category);
    }
  }

  // Element categories
  for (const el of elements) {
    if (!seen.has(el.category)) {
      categories.push(el.category);
      seen.add(el.category);
    }
  }

  // Wall at end if rooms exist
  if (rooms.length > 0 && !seen.has('wall')) {
    categories.push('wall');
    seen.add('wall');
  }

  const swatchSize = 16;
  const entryHeight = 28;
  let entryY = y + 14;

  ctx.font = '13px sans-serif';
  ctx.textBaseline = 'middle';

  for (const cat of categories) {
    // Rounded color swatch
    const sx = x + 14;
    const sy = entryY;
    const r = 3;
    ctx.beginPath();
    ctx.moveTo(sx + r, sy);
    ctx.lineTo(sx + swatchSize - r, sy);
    ctx.arcTo(sx + swatchSize, sy, sx + swatchSize, sy + r, r);
    ctx.lineTo(sx + swatchSize, sy + swatchSize - r);
    ctx.arcTo(sx + swatchSize, sy + swatchSize, sx + swatchSize - r, sy + swatchSize, r);
    ctx.lineTo(sx + r, sy + swatchSize);
    ctx.arcTo(sx, sy + swatchSize, sx, sy + swatchSize - r, r);
    ctx.lineTo(sx, sy + r);
    ctx.arcTo(sx, sy, sx + r, sy, r);
    ctx.closePath();
    ctx.fillStyle = CATEGORY_COLORS[cat] || '#cccccc';
    ctx.fill();

    // Label
    ctx.fillStyle = '#444444';
    ctx.fillText(EXPORT_LABELS[cat] || cat, sx + swatchSize + 10, entryY + swatchSize / 2);

    entryY += entryHeight;
  }

  ctx.restore();
}
