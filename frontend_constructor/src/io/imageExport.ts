import { saveAs } from 'file-saver';
import { CanvasRenderer } from '../canvas/CanvasRenderer';
import type { Room, PlacedElement, PlanMetadata } from '../store/types';

export function exportPNG(
  rooms: Room[],
  elements: PlacedElement[],
  metadata: PlanMetadata,
  filename = 'floor-plan.png',
) {
  const size = 512;
  const offscreen = document.createElement('canvas');
  offscreen.width = size;
  offscreen.height = size;
  const ctx = offscreen.getContext('2d');
  if (!ctx) return;

  const renderer = new CanvasRenderer();
  renderer.vt.scale = size / 256;
  renderer.vt.offsetX = 0;
  renderer.vt.offsetY = 0;

  renderer.render(ctx, size, size, rooms, elements, metadata, null, null, null, false);

  offscreen.toBlob((blob) => {
    if (blob) saveAs(blob, filename);
  }, 'image/png');
}
