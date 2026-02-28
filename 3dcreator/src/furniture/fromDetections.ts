import { defaultFurnitureHeight, furnitureFootprintScale, normalizeFurnitureType } from './defaults';
import type { FurnitureItem, MultiPolygon2 } from '../scene/types';

export interface Detection {
  type: string;
  bbox: {
    x: number;
    y: number;
    w: number;
    h: number;
  };
  score: number;
  rotDeg: number;
}

function pointInRing(x: number, y: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInPolygon(x: number, y: number, polygon: [number, number][][]): boolean {
  if (polygon.length === 0) {
    return false;
  }
  if (!pointInRing(x, y, polygon[0])) {
    return false;
  }
  for (let i = 1; i < polygon.length; i += 1) {
    if (pointInRing(x, y, polygon[i])) {
      return false;
    }
  }
  return true;
}

function pointInMultiPolygon(x: number, y: number, multiPolygon: MultiPolygon2): boolean {
  for (const polygon of multiPolygon) {
    if (pointInPolygon(x, y, polygon)) {
      return true;
    }
  }
  return false;
}

export function detectionsToFurniture(
  detections: Detection[],
  mPerUnit: number,
  innerBoundary: MultiPolygon2,
): FurnitureItem[] {
  const items: FurnitureItem[] = [];

  for (const detection of detections) {
    const type = normalizeFurnitureType(detection.type);
    if (!type) {
      continue;
    }

    const cx = detection.bbox.x + detection.bbox.w / 2;
    const cy = detection.bbox.y + detection.bbox.h / 2;

    if (innerBoundary.length > 0 && !pointInMultiPolygon(cx, cy, innerBoundary)) {
      continue;
    }

    const scale = furnitureFootprintScale(type);
    const w = Math.max(0.2, detection.bbox.w * mPerUnit * scale);
    const d = Math.max(0.2, detection.bbox.h * mPerUnit * scale);

    items.push({
      type,
      center_m: {
        x: cx * mPerUnit,
        z: cy * mPerUnit,
      },
      size_m: {
        w,
        d,
        h: defaultFurnitureHeight(type),
      },
      rotY_deg: Number.isFinite(detection.rotDeg) ? detection.rotDeg : 0,
      source: 'image',
      score: detection.score,
    });
  }

  return items;
}

function numberFrom(input: unknown): number | null {
  const n = Number(input);
  return Number.isFinite(n) ? n : null;
}

export function furnitureFromJson(raw: unknown, mPerUnit: number): FurnitureItem[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const items: FurnitureItem[] = [];

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    const obj = entry as Record<string, unknown>;
    const type = normalizeFurnitureType(String(obj.type ?? ''));
    if (!type) {
      continue;
    }

    let x: number | null = null;
    let z: number | null = null;
    let w: number | null = null;
    let d: number | null = null;
    let h: number | null = null;

    const centerMeters = obj.center_m as Record<string, unknown> | undefined;
    const sizeMeters = obj.size_m as Record<string, unknown> | undefined;
    if (centerMeters && sizeMeters) {
      x = numberFrom(centerMeters.x);
      z = numberFrom(centerMeters.z);
      w = numberFrom(sizeMeters.w);
      d = numberFrom(sizeMeters.d);
      h = numberFrom(sizeMeters.h);
    }

    if (x === null || z === null || w === null || d === null) {
      const center = obj.center as Record<string, unknown> | undefined;
      const size = obj.size as Record<string, unknown> | undefined;
      if (center && size) {
        const cx = numberFrom(center.x);
        const cy = numberFrom(center.y ?? center.z);
        const sw = numberFrom(size.w);
        const sd = numberFrom(size.d);
        const sh = numberFrom(size.h);
        const units = String(obj.units ?? 'plan').toLowerCase();

        if (cx !== null && cy !== null && sw !== null && sd !== null) {
          if (units === 'm' || units === 'meter' || units === 'meters') {
            x = cx;
            z = cy;
            w = sw;
            d = sd;
            h = sh;
          } else {
            x = cx * mPerUnit;
            z = cy * mPerUnit;
            w = sw * mPerUnit;
            d = sd * mPerUnit;
            h = sh;
          }
        }
      }
    }

    if (x === null || z === null || w === null || d === null) {
      continue;
    }

    items.push({
      type,
      center_m: { x, z },
      size_m: {
        w: Math.max(0.2, w),
        d: Math.max(0.2, d),
        h: Math.max(0.2, h ?? defaultFurnitureHeight(type)),
      },
      rotY_deg: numberFrom(obj.rotY_deg ?? obj.rotation_deg ?? 0) ?? 0,
      source: 'json',
    });
  }

  return items;
}
