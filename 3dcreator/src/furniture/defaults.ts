import type { FurnitureType } from '../scene/types';

const TYPE_ALIASES: Record<string, FurnitureType> = {
  bed: 'bed',
  sofa: 'sofa',
  couch: 'sofa',
  wardrobe: 'wardrobe',
  closet: 'wardrobe',
  table: 'table',
  dining_table: 'dining_table',
  diningtable: 'dining_table',
  chair: 'chair',
  cabinet: 'cabinet',
  kitchen_unit: 'kitchen_unit',
  kitchenunit: 'kitchen_unit',
  toilet: 'toilet',
  sink: 'sink',
  bathtub: 'bathtub',
};

const DEFAULT_HEIGHTS: Record<FurnitureType, number> = {
  bed: 0.45,
  sofa: 0.85,
  wardrobe: 2.1,
  table: 0.75,
  dining_table: 0.75,
  chair: 0.9,
  cabinet: 0.9,
  kitchen_unit: 0.9,
  toilet: 0.8,
  sink: 0.85,
  bathtub: 0.6,
};

const FOOTPRINT_SCALE: Record<FurnitureType, number> = {
  bed: 1.2,
  sofa: 1.1,
  wardrobe: 1.1,
  table: 1.1,
  dining_table: 1.1,
  chair: 1.0,
  cabinet: 1.1,
  kitchen_unit: 1.1,
  toilet: 1.0,
  sink: 1.0,
  bathtub: 1.0,
};

export function normalizeFurnitureType(value: string): FurnitureType | null {
  const key = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return TYPE_ALIASES[key] ?? null;
}

export function defaultFurnitureHeight(type: FurnitureType): number {
  return DEFAULT_HEIGHTS[type];
}

export function furnitureFootprintScale(type: FurnitureType): number {
  return FOOTPRINT_SCALE[type];
}
