import type { MultiPolygon2, Polygon2, Ring2 } from '../scene/types';

function signedRingArea(ring: Ring2): number {
  let area = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    area += x1 * y2 - x2 * y1;
  }
  return area / 2;
}

export function polygonArea(polygon: Polygon2): number {
  if (polygon.length === 0) {
    return 0;
  }
  const outer = Math.abs(signedRingArea(polygon[0]));
  const holes = polygon.slice(1).reduce((acc, hole) => acc + Math.abs(signedRingArea(hole)), 0);
  return Math.max(0, outer - holes);
}

export function multiPolygonArea(multi: MultiPolygon2): number {
  return multi.reduce((acc, polygon) => acc + polygonArea(polygon), 0);
}
