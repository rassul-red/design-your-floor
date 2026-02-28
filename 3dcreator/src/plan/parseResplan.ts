import type { MultiPolygon2, Polygon2 } from '../scene/types';

export interface GeoPolygon {
  type: 'Polygon';
  coordinates: number[][][];
}

export interface GeoMultiPolygon {
  type: 'MultiPolygon';
  coordinates: number[][][][];
}

export type GeoAny = GeoPolygon | GeoMultiPolygon | null | undefined;

export interface ResPlan {
  id?: number;
  unitType?: string;
  area?: number;
  net_area?: number;
  wall_depth?: number;
  wall?: GeoAny;
  inner?: GeoAny;
  living?: GeoAny;
  bedroom?: GeoAny;
  bathroom?: GeoAny;
  kitchen?: GeoAny;
  balcony?: GeoAny;
  balacony?: GeoAny;
  storage?: GeoAny;
  door?: GeoAny;
  window?: GeoAny;
  front_door?: GeoAny;
  furniture?: unknown;
  [key: string]: unknown;
}

function sanitizeRing(ring: number[][]): [number, number][] {
  const out: [number, number][] = [];
  for (const pt of ring) {
    if (!Array.isArray(pt) || pt.length < 2) {
      continue;
    }
    const x = Number(pt[0]);
    const y = Number(pt[1]);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      out.push([x, y]);
    }
  }
  if (out.length < 3) {
    return [];
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    out.push([first[0], first[1]]);
  }
  return out;
}

function sanitizePolygon(polygon: number[][][]): Polygon2 {
  const rings: Polygon2 = [];
  for (const ring of polygon) {
    const clean = sanitizeRing(ring);
    if (clean.length >= 4) {
      rings.push(clean);
    }
  }
  return rings.length > 0 ? rings : [];
}

export function toMultiPolygon(geo: GeoAny): MultiPolygon2 {
  if (!geo) {
    return [];
  }

  if (geo.type === 'Polygon') {
    const poly = sanitizePolygon(geo.coordinates);
    return poly.length > 0 ? [poly] : [];
  }

  if (geo.type === 'MultiPolygon') {
    const out: MultiPolygon2 = [];
    for (const polygon of geo.coordinates) {
      const clean = sanitizePolygon(polygon);
      if (clean.length > 0) {
        out.push(clean);
      }
    }
    return out;
  }

  return [];
}

export function normalizePlan(raw: unknown): ResPlan {
  const plan = (raw ?? {}) as ResPlan;
  if (plan.balacony && !plan.balcony) {
    plan.balcony = plan.balacony as GeoAny;
  }
  return plan;
}

export function parseResPlan(raw: unknown): ResPlan {
  return normalizePlan(raw);
}
