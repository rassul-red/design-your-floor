import type { Category } from '../store/types';

export const CATEGORY_COLORS: Record<Category, string> = {
  living: '#d9d9d9',
  bedroom: '#66c2a5',
  bathroom: '#fc8d62',
  kitchen: '#8da0cb',
  door: '#e78ac3',
  window: '#a6d854',
  wall: '#ffd92f',
  front_door: '#a63603',
  balcony: '#b3b3b3',
  storage: '#e5c494',
  inner: '#ffffff',
};

export const CATEGORY_LABELS: Record<Category, string> = {
  living: 'Living',
  bedroom: 'Bedroom',
  bathroom: 'Bathroom',
  kitchen: 'Kitchen',
  door: 'Door',
  window: 'Window',
  wall: 'Wall',
  front_door: 'Front Door',
  balcony: 'Balcony',
  storage: 'Storage',
  inner: 'Inner',
};
