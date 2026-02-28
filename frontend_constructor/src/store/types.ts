export type RoomCategory =
  | 'living'
  | 'bedroom'
  | 'bathroom'
  | 'kitchen'
  | 'balcony'
  | 'storage';

export type ElementCategory = 'door' | 'window' | 'front_door' | 'wall';

export type Category = RoomCategory | ElementCategory | 'wall' | 'inner';

export interface Point {
  x: number;
  y: number;
}

export interface Room {
  id: string;
  category: RoomCategory;
  vertices: Point[];
  label?: string;
}

export interface PlacedElement {
  id: string;
  category: ElementCategory;
  vertices: Point[]; // 4-point rectangle
}

export interface PlanMetadata {
  id: number;
  unitType: string;
  pixelsPerMeter: number;
  wallDepth: number;
  gridSize: number;
}

export type ToolType = 'select' | 'draw_room' | 'draw_wall' | 'place_door' | 'place_window' | 'place_front_door';

export interface PlanState {
  rooms: Room[];
  elements: PlacedElement[];
  metadata: PlanMetadata;
  selectedId: string | null;
  activeTool: ToolType;
  activeRoomCategory: RoomCategory;
  undoStack: { rooms: Room[]; elements: PlacedElement[] }[];
  redoStack: { rooms: Room[]; elements: PlacedElement[] }[];
}

export interface PlanActions {
  addRoom: (room: Room) => void;
  removeRoom: (id: string) => void;
  updateRoom: (id: string, updates: Partial<Room>) => void;
  moveRoom: (id: string, dx: number, dy: number) => void;
  addElement: (element: PlacedElement) => void;
  removeElement: (id: string) => void;
  moveElement: (id: string, dx: number, dy: number) => void;
  setSelectedId: (id: string | null) => void;
  setActiveTool: (tool: ToolType) => void;
  setActiveRoomCategory: (cat: RoomCategory) => void;
  setMetadata: (meta: Partial<PlanMetadata>) => void;
  pushUndo: () => void;
  undo: () => void;
  redo: () => void;
  clearAll: () => void;
  loadPlan: (rooms: Room[], elements: PlacedElement[], metadata: Partial<PlanMetadata>) => void;
}
