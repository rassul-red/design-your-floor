import type { CameraSpec, FurnitureItem, MultiPolygon2, SceneDescription } from './types';
import type { ResPlan } from '../plan/parseResplan';
import { toMultiPolygon } from '../plan/parseResplan';

export interface BuildSceneInput {
  plan: ResPlan;
  mPerUnit: number;
  furniture: FurnitureItem[];
  camera: CameraSpec;
  wallHeight: number;
  floorThickness: number;
  renderWidth: number;
  renderHeight: number;
  enableDoorCutouts: boolean;
}

function scaleMultiPolygon(multi: MultiPolygon2, mPerUnit: number): MultiPolygon2 {
  return multi.map((polygon) =>
    polygon.map((ring) => ring.map(([x, y]) => [x * mPerUnit, y * mPerUnit])),
  );
}

function applyDoorCutouts(walls: MultiPolygon2, doors: MultiPolygon2): MultiPolygon2 {
  if (walls.length === 0 || doors.length === 0) {
    return walls;
  }

  try {
    const polygonClipping = require('polygon-clipping') as {
      difference: (...args: unknown[]) => unknown;
    };
    const cut = polygonClipping.difference(walls as unknown as object, doors as unknown as object);
    return (cut as MultiPolygon2) ?? walls;
  } catch {
    console.warn('[scene] polygon-clipping is unavailable, skipping door cutouts.');
    return walls;
  }
}

export function buildScene(input: BuildSceneInput): SceneDescription {
  const planWalls = toMultiPolygon(input.plan.wall);
  const planDoors = toMultiPolygon(input.plan.door);
  const planInner = toMultiPolygon(input.plan.inner);
  const planWindows = toMultiPolygon(input.plan.window);

  const wallsPlan = input.enableDoorCutouts ? applyDoorCutouts(planWalls, planDoors) : planWalls;

  return {
    version: '1.0.0',
    units: 'meters',
    m_per_unit: input.mPerUnit,
    wallHeight: input.wallHeight,
    floorThickness: input.floorThickness,
    walls: scaleMultiPolygon(wallsPlan, input.mPerUnit),
    floor: scaleMultiPolygon(planInner, input.mPerUnit),
    windows: scaleMultiPolygon(planWindows, input.mPerUnit),
    furniture: input.furniture,
    camera: input.camera,
    render: {
      width: input.renderWidth,
      height: input.renderHeight,
      background: '#f0efe9',
    },
  };
}
