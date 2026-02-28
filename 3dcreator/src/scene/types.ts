export type Coord2 = [number, number];
export type Ring2 = Coord2[];
export type Polygon2 = Ring2[];
export type MultiPolygon2 = Polygon2[];

export const FURNITURE_TYPES = [
  'bed',
  'sofa',
  'wardrobe',
  'table',
  'dining_table',
  'chair',
  'cabinet',
  'kitchen_unit',
  'toilet',
  'sink',
  'bathtub',
] as const;

export type FurnitureType = (typeof FURNITURE_TYPES)[number];

export interface FurnitureItem {
  type: FurnitureType;
  center_m: { x: number; z: number };
  size_m: { w: number; d: number; h: number };
  rotY_deg: number;
  source: 'json' | 'image';
  score?: number;
}

export interface CameraSpec {
  position: { x: number; y: number; z: number };
  lookAt: { x: number; y: number; z: number };
  fovDeg: number;
}

export interface SceneDescription {
  version: string;
  units: 'meters';
  m_per_unit: number;
  wallHeight: number;
  floorThickness: number;
  walls: MultiPolygon2;
  floor: MultiPolygon2;
  windows: MultiPolygon2;
  furniture: FurnitureItem[];
  camera: CameraSpec;
  render: {
    width: number;
    height: number;
    background: string;
  };
}
