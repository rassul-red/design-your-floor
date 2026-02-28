import { usePlanStore } from '../store/planStore';
import { CATEGORY_COLORS, CATEGORY_LABELS } from '../canvas/colors';
import type { ToolType, RoomCategory } from '../store/types';

const TOOLS: { type: ToolType; label: string; shortcut: string }[] = [
  { type: 'select', label: 'Select', shortcut: 'S' },
  { type: 'draw_room', label: 'Draw Room', shortcut: 'R' },
  { type: 'draw_wall', label: 'Draw Wall', shortcut: 'L' },
  { type: 'place_door', label: 'Door', shortcut: 'D' },
  { type: 'place_window', label: 'Window', shortcut: 'W' },
  { type: 'place_front_door', label: 'Front Door', shortcut: 'F' },
];

const ROOM_TYPES: RoomCategory[] = [
  'living', 'bedroom', 'bathroom', 'kitchen', 'balcony', 'storage',
];

export function Toolbar() {
  const activeTool = usePlanStore((s) => s.activeTool);
  const activeRoomCategory = usePlanStore((s) => s.activeRoomCategory);
  const gridSize = usePlanStore((s) => s.metadata.gridSize);
  const setActiveTool = usePlanStore((s) => s.setActiveTool);
  const setActiveRoomCategory = usePlanStore((s) => s.setActiveRoomCategory);
  const setMetadata = usePlanStore((s) => s.setMetadata);
  const undo = usePlanStore((s) => s.undo);
  const redo = usePlanStore((s) => s.redo);
  const clearAll = usePlanStore((s) => s.clearAll);

  return (
    <div style={styles.toolbar}>
      <div style={styles.section}>
        <div style={styles.sectionLabel}>Tools</div>
        {TOOLS.map((t) => (
          <button
            key={t.type}
            onClick={() => setActiveTool(t.type)}
            style={{
              ...styles.btn,
              ...(activeTool === t.type ? styles.btnActive : {}),
            }}
            title={`${t.label} (${t.shortcut})`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTool === 'draw_room' && (
        <div style={styles.section}>
          <div style={styles.sectionLabel}>Room Type</div>
          {ROOM_TYPES.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveRoomCategory(cat)}
              style={{
                ...styles.btn,
                ...(activeRoomCategory === cat ? styles.btnActive : {}),
                borderLeft: `4px solid ${CATEGORY_COLORS[cat]}`,
              }}
            >
              {CATEGORY_LABELS[cat]}
            </button>
          ))}
        </div>
      )}

      <div style={styles.section}>
        <div style={styles.sectionLabel}>Grid Size</div>
        <select
          value={gridSize}
          onChange={(e) => setMetadata({ gridSize: Number(e.target.value) })}
          style={styles.select}
        >
          <option value={2}>2px</option>
          <option value={4}>4px</option>
          <option value={8}>8px</option>
          <option value={16}>16px</option>
        </select>
      </div>

      <div style={styles.section}>
        <div style={styles.sectionLabel}>Edit</div>
        <button onClick={undo} style={styles.btn} title="Undo (Ctrl+Z)">
          Undo
        </button>
        <button onClick={redo} style={styles.btn} title="Redo (Ctrl+Shift+Z)">
          Redo
        </button>
        <button onClick={clearAll} style={{ ...styles.btn, color: '#c00' }}>
          Clear All
        </button>
      </div>

      <div style={styles.helpText}>
        <div>Space+Drag = Pan</div>
        <div>Scroll = Zoom</div>
        <div>Dbl-click/Click 1st = Close room</div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  toolbar: {
    width: 180,
    background: '#f5f5f5',
    borderRight: '1px solid #ddd',
    padding: 8,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    overflowY: 'auto',
    fontSize: 13,
    flexShrink: 0,
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  sectionLabel: {
    fontWeight: 600,
    fontSize: 11,
    textTransform: 'uppercase',
    color: '#666',
    marginBottom: 4,
  },
  btn: {
    padding: '5px 8px',
    border: '1px solid #ccc',
    background: '#fff',
    borderRadius: 4,
    cursor: 'pointer',
    textAlign: 'left' as const,
    fontSize: 13,
  },
  btnActive: {
    background: '#0066ff',
    color: '#fff',
    borderColor: '#0066ff',
  },
  select: {
    padding: '4px 6px',
    border: '1px solid #ccc',
    borderRadius: 4,
    fontSize: 13,
  },
  helpText: {
    marginTop: 'auto',
    fontSize: 11,
    color: '#888',
    lineHeight: '1.6',
  },
};
