import polygonClipping from 'polygon-clipping';
import type { Room, PlacedElement, Point } from '../store/types';

type Ring = [number, number][];
type Polygon = Ring[];
type MultiPolygon = Polygon[];

export function verticesToRing(vertices: Point[]): Ring {
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
export function bufferPolygon(ring: Ring, offset: number): Ring {
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

export function ensureCCW(ring: Ring): Ring {
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
): { walls: MultiPolygon; inner: MultiPolygon; wallStrips: MultiPolygon } {
  if (rooms.length === 0) {
    return { walls: [], inner: [], wallStrips: [] };
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

  // Walls = buffered - rooms (used for canvas rendering)
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

  // Generate individual wall strips (simple polygons, no holes) for JSON export.
  // Use `walls` (buffered - rooms - doors) as source of truth to avoid double
  // walls between adjacent rooms. Decompose any polygon-with-holes into simple
  // pieces by intersecting with per-edge cutting strips from the outer ring.
  let wallStrips: MultiPolygon = [];
  for (const polygon of walls) {
    if (polygon.length === 1) {
      // Simple polygon (no holes) — keep as-is
      wallStrips.push(polygon);
    } else {
      // Has holes — split into simple pieces using per-edge strips
      const outerRing = polygon[0];
      const n = outerRing.length - 1; // exclude closing point
      for (let i = 0; i < n; i++) {
        const i1 = (i + 1) % n;
        const a = outerRing[i];
        const b = outerRing[i1];

        // Edge midpoint and inward normal
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const edgeLen = Math.sqrt(dx * dx + dy * dy);
        if (edgeLen < 1e-10) continue;

        // Inward normal (perpendicular to edge, pointing into the polygon)
        // For CCW outer ring in screen coords (Y-down): inward = (dy, -dx) normalized
        const nx = dy / edgeLen;
        const ny = -dx / edgeLen;

        // Create a strip: extend edge inward by a large amount (3*wallDepth)
        const ext = wallDepth * 3;
        const strip: Ring = [
          [a[0], a[1]],
          [b[0], b[1]],
          [b[0] + nx * ext, b[1] + ny * ext],
          [a[0] + nx * ext, a[1] + ny * ext],
          [a[0], a[1]], // close
        ];

        try {
          const pieces = polygonClipping.intersection(
            [polygon] as any,
            [[strip]] as any,
          ) as unknown as MultiPolygon;
          wallStrips.push(...pieces);
        } catch {
          // skip
        }
      }
    }
  }

  const inner = bufferedPolygons;

  return { walls, inner, wallStrips };
}

export function multiPolygonToPoints(mp: MultiPolygon): Point[][][] {
  return mp.map((polygon) =>
    polygon.map((ring) => ring.map(([x, y]) => ({ x, y }))),
  );
}

/**
 * Compute the net interior area of a room in pixels²,
 * accounting for wall depth inset.
 *
 * The wallDepth inset shrinks the room polygon inward to represent
 * the usable floor area inside the walls.
 */
export function computeNetRoomArea(
  roomVertices: Point[],
  wallDepth: number,
): number {
  if (roomVertices.length < 3) return 0;

  if (wallDepth > 0) {
    const rawRing = ensureCCW(verticesToRing(roomVertices));
    const insetRing = bufferPolygon(rawRing, -wallDepth);
    if (insetRing.length - 1 < 3) return 0;
    const verts = insetRing.slice(0, -1);
    let a = 0;
    for (let i = 0; i < verts.length; i++) {
      const j = (i + 1) % verts.length;
      a += verts[i][0] * verts[j][1] - verts[j][0] * verts[i][1];
    }
    return Math.abs(a) / 2;
  }

  // No wallDepth — raw area
  let a = 0;
  for (let i = 0; i < roomVertices.length; i++) {
    const j = (i + 1) % roomVertices.length;
    a += roomVertices[i].x * roomVertices[j].y - roomVertices[j].x * roomVertices[i].y;
  }
  return Math.abs(a) / 2;
}
