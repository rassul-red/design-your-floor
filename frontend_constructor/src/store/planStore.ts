import { create } from 'zustand';
import type {
  PlanState,
  PlanActions,
  Room,
  PlacedElement,
  PlanMetadata,
} from './types';

const DEFAULT_METADATA: PlanMetadata = {
  id: 0,
  unitType: 'Apartment',
  pixelsPerMeter: 30,
  wallDepth: 4.5,
  gridSize: 4,
};

const MAX_UNDO = 50;

export const usePlanStore = create<PlanState & PlanActions>((set, get) => ({
  rooms: [],
  elements: [],
  metadata: { ...DEFAULT_METADATA },
  selectedId: null,
  activeTool: 'draw_room',
  activeRoomCategory: 'living',
  undoStack: [],
  redoStack: [],

  addRoom: (room: Room) => {
    const state = get();
    state.pushUndo();
    set({ rooms: [...state.rooms, room], redoStack: [] });
  },

  removeRoom: (id: string) => {
    const state = get();
    state.pushUndo();
    set({
      rooms: state.rooms.filter((r) => r.id !== id),
      selectedId: state.selectedId === id ? null : state.selectedId,
      redoStack: [],
    });
  },

  updateRoom: (id: string, updates: Partial<Room>) => {
    set((state) => ({
      rooms: state.rooms.map((r) => (r.id === id ? { ...r, ...updates } : r)),
    }));
  },

  moveRoom: (id: string, dx: number, dy: number) => {
    set((state) => ({
      rooms: state.rooms.map((r) =>
        r.id === id
          ? { ...r, vertices: r.vertices.map((v) => ({ x: v.x + dx, y: v.y + dy })) }
          : r,
      ),
    }));
  },

  addElement: (element: PlacedElement) => {
    const state = get();
    state.pushUndo();
    set({ elements: [...state.elements, element], redoStack: [] });
  },

  removeElement: (id: string) => {
    const state = get();
    state.pushUndo();
    set({
      elements: state.elements.filter((e) => e.id !== id),
      selectedId: state.selectedId === id ? null : state.selectedId,
      redoStack: [],
    });
  },

  moveElement: (id: string, dx: number, dy: number) => {
    set((state) => ({
      elements: state.elements.map((e) =>
        e.id === id
          ? { ...e, vertices: e.vertices.map((v) => ({ x: v.x + dx, y: v.y + dy })) }
          : e,
      ),
    }));
  },

  setSelectedId: (id: string | null) => set({ selectedId: id }),
  setActiveTool: (tool) => set({ activeTool: tool, selectedId: null }),
  setActiveRoomCategory: (cat) => set({ activeRoomCategory: cat }),

  setMetadata: (meta: Partial<PlanMetadata>) =>
    set((state) => ({ metadata: { ...state.metadata, ...meta } })),

  pushUndo: () => {
    const { rooms, elements, undoStack } = get();
    const snapshot = {
      rooms: rooms.map((r) => ({ ...r, vertices: [...r.vertices] })),
      elements: elements.map((e) => ({ ...e, vertices: [...e.vertices] })),
    };
    const stack = [...undoStack, snapshot];
    if (stack.length > MAX_UNDO) stack.shift();
    set({ undoStack: stack });
  },

  undo: () => {
    const { rooms, elements, undoStack, redoStack } = get();
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    set({
      rooms: prev.rooms,
      elements: prev.elements,
      undoStack: undoStack.slice(0, -1),
      redoStack: [...redoStack, { rooms, elements }],
      selectedId: null,
    });
  },

  redo: () => {
    const { rooms, elements, undoStack, redoStack } = get();
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    set({
      rooms: next.rooms,
      elements: next.elements,
      redoStack: redoStack.slice(0, -1),
      undoStack: [...undoStack, { rooms, elements }],
      selectedId: null,
    });
  },

  clearAll: () => {
    const state = get();
    state.pushUndo();
    set({ rooms: [], elements: [], selectedId: null, redoStack: [] });
  },

  loadPlan: (rooms, elements, metadata) => {
    set({
      rooms,
      elements,
      metadata: { ...get().metadata, ...metadata },
      selectedId: null,
      undoStack: [],
      redoStack: [],
    });
  },
}));
