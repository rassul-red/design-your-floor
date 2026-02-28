import type { MultiPolygon2 } from '../scene/types';
import type { ResPlan } from './parseResplan';
import { toMultiPolygon } from './parseResplan';
import { multiPolygonArea } from './geojsonArea';

const ROOM_KEYS = ['living', 'bedroom', 'bathroom', 'kitchen', 'balcony', 'storage'] as const;

export interface ScaleResult {
  mPerUnit: number;
  roomAreaPlanUnits2: number;
  innerAreaPlanUnits2: number;
  warnings: string[];
  method: 'net_area' | 'area' | 'default';
}

export interface PlanExtent {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

function collectAllCoordinates(multi: MultiPolygon2, collector: number[]): void {
  for (const polygon of multi) {
    for (const ring of polygon) {
      for (const [x, y] of ring) {
        collector.push(x, y);
      }
    }
  }
}

function computeAreaForKeys(plan: ResPlan, keys: readonly string[]): number {
  let total = 0;
  for (const key of keys) {
    total += multiPolygonArea(toMultiPolygon((plan as Record<string, unknown>)[key] as any));
  }
  return total;
}

export function inferMetersPerUnit(plan: ResPlan): ScaleResult {
  const warnings: string[] = [];
  const roomAreaPlanUnits2 = computeAreaForKeys(plan, ROOM_KEYS);
  const innerAreaPlanUnits2 = multiPolygonArea(toMultiPolygon(plan.inner));

  const netArea = Number(plan.net_area ?? 0);
  if (Number.isFinite(netArea) && netArea > 0 && roomAreaPlanUnits2 > 0) {
    return {
      mPerUnit: Math.sqrt(netArea / roomAreaPlanUnits2),
      roomAreaPlanUnits2,
      innerAreaPlanUnits2,
      warnings,
      method: 'net_area',
    };
  }

  const area = Number(plan.area ?? 0);
  if (Number.isFinite(area) && area > 0 && innerAreaPlanUnits2 > 0) {
    warnings.push('Using plan.area fallback for scale inference.');
    return {
      mPerUnit: Math.sqrt(area / innerAreaPlanUnits2),
      roomAreaPlanUnits2,
      innerAreaPlanUnits2,
      warnings,
      method: 'area',
    };
  }

  warnings.push('Could not infer scale from net_area/area; defaulting to 0.05 m per plan unit.');
  return {
    mPerUnit: 0.05,
    roomAreaPlanUnits2,
    innerAreaPlanUnits2,
    warnings,
    method: 'default',
  };
}

export function inferPlanExtent(plan: ResPlan): PlanExtent {
  const coords: number[] = [];
  const candidates: MultiPolygon2[] = [
    toMultiPolygon(plan.inner),
    toMultiPolygon(plan.wall),
    toMultiPolygon(plan.living),
    toMultiPolygon(plan.bedroom),
    toMultiPolygon(plan.bathroom),
    toMultiPolygon(plan.kitchen),
    toMultiPolygon(plan.balcony),
    toMultiPolygon(plan.storage),
  ];

  for (const multi of candidates) {
    collectAllCoordinates(multi, coords);
  }

  if (coords.length < 2) {
    return {
      minX: 0,
      minY: 0,
      maxX: 256,
      maxY: 256,
      width: 256,
      height: 256,
    };
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < coords.length; i += 2) {
    const x = coords[i];
    const y = coords[i + 1];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }

  const width = Math.max(1, Math.ceil(maxX));
  const height = Math.max(1, Math.ceil(maxY));

  return {
    minX,
    minY,
    maxX,
    maxY,
    width,
    height,
  };
}
