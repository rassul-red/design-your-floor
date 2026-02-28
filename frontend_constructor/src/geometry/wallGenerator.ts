import polygonClipping from 'polygon-clipping';
import type { Room, PlacedElement, Point } from '../store/types';

type Ring = [number, number][];
type Polygon = Ring[];
type MultiPolygon = Polygon[];

function verticesToRing(vertices: Point[]): Ring {
  const ring: Ring = vertices.map((v) => [v.x, v.y]);
  if (
    ring.length > 0 &&
    (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])
  ) {
    ring.push([...ring[0]]);
  }
  return ring;
}

/**
 * Offset a polygon ring by `offset` using the edge-offset-and-intersect method.
 * Positive offset = outward (for CCW outer rings).
 */
function bufferPolygon(ring: Ring, offset: number): Ring {
  const n = ring.length - 1; // exclude closing point
  if (n < 3) return ring;

  // For each edge, compute the offset line (shifted by `offset` along outward normal)
  interface OffsetEdge {
    p1: [number, number];
    p2: [number, number];
  }

  const offsetEdges: OffsetEdge[] = [];
  for (let i = 0; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-10) continue;

    // Outward normal for screen coords (Y-down): (dy, -dx) normalized
    const nx = (dy / len) * offset;
    const ny = (-dx / len) * offset;

    offsetEdges.push({
      p1: [a[0] + nx, a[1] + ny],
      p2: [b[0] + nx, b[1] + ny],
    });
  }

  if (offsetEdges.length < 3) return ring;

  // Find intersection of consecutive offset edges to get new vertices
  const result: Ring = [];
  for (let i = 0; i < offsetEdges.length; i++) {
    const e1 = offsetEdges[i];
    const e2 = offsetEdges[(i + 1) % offsetEdges.length];
    const pt = lineLineIntersection(e1.p1, e1.p2, e2.p1, e2.p2);
    if (pt) {
      result.push(pt);
    } else {
      // Parallel edges - use endpoint of first edge
      result.push([...e1.p2]);
    }
  }

  // Close the ring
  if (result.length > 0) {
    result.push([...result[0]]);
  }

  return result;
}

function lineLineIntersection(
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
  p4: [number, number],
): [number, number] | null {
  const d1x = p2[0] - p1[0];
  const d1y = p2[1] - p1[1];
  const d2x = p4[0] - p3[0];
  const d2y = p4[1] - p3[1];

  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-10) return null; // Parallel

  const t = ((p3[0] - p1[0]) * d2y - (p3[1] - p1[1]) * d2x) / denom;
  return [p1[0] + t * d1x, p1[1] + t * d1y];
}

function ensureCCW(ring: Ring): Ring {
  let area = 0;
  const n = ring.length - 1;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % ring.length;
    area += ring[i][0] * ring[j][1] - ring[j][0] * ring[i][1];
  }
  if (area < 0) {
    return [...ring].reverse();
  }
  return ring;
}

export function generateWalls(
  rooms: Room[],
  wallDepth: number,
  elements: PlacedElement[] = [],
): { walls: MultiPolygon; inner: MultiPolygon } {
  if (rooms.length === 0) {
    return { walls: [], inner: [] };
  }

  const roomPolygons: MultiPolygon = rooms.map((room) => {
    const ring = ensureCCW(verticesToRing(room.vertices));
    return [ring];
  });

  let roomUnion: MultiPolygon;
  try {
    if (roomPolygons.length === 1) {
      roomUnion = roomPolygons;
    } else {
      roomUnion = polygonClipping.union(
        roomPolygons[0] as any,
        ...roomPolygons.slice(1) as any[],
      ) as unknown as MultiPolygon;
    }
  } catch {
    roomUnion = roomPolygons;
  }

  // Buffer each polygon outward
  const bufferedPolygons: MultiPolygon = roomUnion.map((polygon) => {
    return polygon.map((ring, idx) => {
      if (idx === 0) {
        return bufferPolygon(ring, wallDepth);
      }
      return bufferPolygon(ring, -wallDepth);
    });
  });

  // Walls = buffered - rooms
  let walls: MultiPolygon;
  try {
    walls = polygonClipping.difference(
      bufferedPolygons as any,
      roomUnion as any,
    ) as unknown as MultiPolygon;
  } catch {
    walls = [];
  }

  // Subtract door/window/front_door element rectangles from walls
  const doorTypes = ['door', 'window', 'front_door'];
  const doorElements = elements.filter((el) => doorTypes.includes(el.category));
  if (doorElements.length > 0) {
    for (const el of doorElements) {
      const elemRing = verticesToRing(el.vertices);
      const elemPoly: Polygon = [elemRing];
      try {
        walls = polygonClipping.difference(
          walls as any,
          [elemPoly] as any,
        ) as unknown as MultiPolygon;
      } catch {
        // If subtraction fails for one element, skip it
      }
    }
  }

  const inner = bufferedPolygons;

  return { walls, inner };
}

export function multiPolygonToPoints(mp: MultiPolygon): Point[][][] {
  return mp.map((polygon) =>
    polygon.map((ring) => ring.map(([x, y]) => ({ x, y }))),
  );
}
