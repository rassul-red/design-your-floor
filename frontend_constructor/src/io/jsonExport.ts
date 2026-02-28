import type { Room, PlacedElement, PlanMetadata, RoomCategory, ElementCategory } from '../store/types';
import { generateWalls } from '../geometry/wallGenerator';
import { polygonArea } from '../geometry/polygonOps';

type Coord = [number, number];
type Ring = Coord[];
type GeoPolygon = Ring[];
type MultiPolygon = GeoPolygon[];

interface PlanJSON {
  id: number;
  unitType: string;
  area: number;
  net_area: number;
  wall_depth: number;
  [key: string]: unknown;
}

const ROOM_CATEGORIES: RoomCategory[] = [
  'living', 'bedroom', 'bathroom', 'kitchen', 'balcony', 'storage',
];

const ELEMENT_CATEGORIES: ElementCategory[] = ['door', 'window', 'front_door'];

const ALL_KEYS = [
  'living', 'bedroom', 'bathroom', 'kitchen', 'door', 'window',
  'wall', 'front_door', 'balcony', 'inner', 'garden', 'parking',
  'pool', 'stair', 'veranda', 'land', 'storage', 'neighbor',
];

function pointsToRing(vertices: { x: number; y: number }[]): Ring {
  const ring: Ring = vertices.map((v) => [v.x, v.y]);
  // Close ring
  if (ring.length > 0 && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) {
    ring.push([...ring[0]]);
  }
  return ring;
}

export function exportPlanJSON(
  rooms: Room[],
  elements: PlacedElement[],
  metadata: PlanMetadata,
): PlanJSON {
  const result: PlanJSON = {
    id: metadata.id,
    unitType: metadata.unitType,
    area: 0,
    net_area: 0,
    wall_depth: metadata.wallDepth,
  };

  // Compute areas
  let totalRoomArea = 0;
  for (const room of rooms) {
    totalRoomArea += polygonArea(room.vertices);
  }
  const ppm = metadata.pixelsPerMeter;
  result.net_area = totalRoomArea / (ppm * ppm);

  // Group rooms by category
  for (const cat of ROOM_CATEGORIES) {
    const catRooms = rooms.filter((r) => r.category === cat);
    if (catRooms.length > 0) {
      const polygons: MultiPolygon = catRooms.map((r) => [pointsToRing(r.vertices)]);
      result[cat] = {
        type: 'MultiPolygon',
        coordinates: polygons,
      };
    } else {
      result[cat] = null;
    }
  }

  // Elements
  for (const cat of ELEMENT_CATEGORIES) {
    const catElems = elements.filter((e) => e.category === cat);
    if (catElems.length > 0) {
      if (cat === 'front_door' && catElems.length === 1) {
        result[cat] = {
          type: 'Polygon',
          coordinates: [pointsToRing(catElems[0].vertices)],
        };
      } else {
        const polygons: MultiPolygon = catElems.map((e) => [pointsToRing(e.vertices)]);
        result[cat] = {
          type: 'MultiPolygon',
          coordinates: polygons,
        };
      }
    } else {
      result[cat] = null;
    }
  }

  // Generate walls and inner
  if (rooms.length > 0) {
    const { wallStrips, inner } = generateWalls(rooms, metadata.wallDepth, elements);

    if (wallStrips.length > 0) {
      result.wall = { type: 'MultiPolygon', coordinates: wallStrips };
    } else {
      result.wall = null;
    }

    if (inner.length > 0) {
      result.inner = { type: 'MultiPolygon', coordinates: inner };
      // Compute total area (inner boundary)
      let totalArea = 0;
      for (const poly of inner) {
        if (poly.length > 0) {
          const ring = poly[0];
          let a = 0;
          for (let i = 0; i < ring.length; i++) {
            const j = (i + 1) % ring.length;
            a += ring[i][0] * ring[j][1] - ring[j][0] * ring[i][1];
          }
          totalArea += Math.abs(a) / 2;
        }
      }
      result.area = totalArea / (ppm * ppm);
    } else {
      result.inner = null;
    }
  } else {
    result.wall = null;
    result.inner = null;
  }

  // Null out unused keys
  for (const key of ALL_KEYS) {
    if (!(key in result)) {
      result[key] = null;
    }
  }

  return result;
}
