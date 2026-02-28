import type { Room, PlacedElement, RoomCategory, ElementCategory, PlanMetadata, Point } from '../store/types';

interface GeoJSON {
  type: string;
  coordinates: number[][][][] | number[][][];
}

const ROOM_CATEGORIES: RoomCategory[] = [
  'living', 'bedroom', 'bathroom', 'kitchen', 'balcony', 'storage',
];

const ELEMENT_CATEGORIES: ElementCategory[] = ['door', 'window', 'front_door'];

function ringToPoints(ring: number[][]): Point[] {
  // Remove closing point if present
  const points = ring.map(([x, y]) => ({ x, y }));
  if (
    points.length > 1 &&
    points[0].x === points[points.length - 1].x &&
    points[0].y === points[points.length - 1].y
  ) {
    points.pop();
  }
  return points;
}

function extractPolygons(geo: GeoJSON | null | undefined): Point[][] {
  if (!geo) return [];

  if (geo.type === 'MultiPolygon') {
    const coords = geo.coordinates as number[][][][];
    return coords.map((polygon) => {
      // Take outer ring only (index 0)
      return ringToPoints(polygon[0]);
    });
  }

  if (geo.type === 'Polygon') {
    const coords = geo.coordinates as number[][][];
    return [ringToPoints(coords[0])];
  }

  return [];
}

export function importPlanJSON(
  data: Record<string, unknown>,
): { rooms: Room[]; elements: PlacedElement[]; metadata: Partial<PlanMetadata> } {
  const rooms: Room[] = [];
  const elements: PlacedElement[] = [];

  // Import rooms
  for (const cat of ROOM_CATEGORIES) {
    const geo = data[cat] as GeoJSON | null | undefined;
    const polygons = extractPolygons(geo);
    for (let i = 0; i < polygons.length; i++) {
      if (polygons[i].length < 3) continue;
      rooms.push({
        id: `${cat}_${i}_${Date.now()}`,
        category: cat,
        vertices: polygons[i],
      });
    }
  }

  // Import elements
  for (const cat of ELEMENT_CATEGORIES) {
    const geo = data[cat] as GeoJSON | null | undefined;
    const polygons = extractPolygons(geo);
    for (let i = 0; i < polygons.length; i++) {
      if (polygons[i].length < 3) continue;
      elements.push({
        id: `${cat}_${i}_${Date.now()}`,
        category: cat,
        vertices: polygons[i],
      });
    }
  }

  const metadata: Partial<PlanMetadata> = {};
  if (typeof data.id === 'number') metadata.id = data.id;
  if (typeof data.unitType === 'string') metadata.unitType = data.unitType;
  if (typeof data.wall_depth === 'number') metadata.wallDepth = data.wall_depth;

  return { rooms, elements, metadata };
}
