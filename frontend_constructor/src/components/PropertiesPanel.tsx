import { usePlanStore } from '../store/planStore';
import { CATEGORY_COLORS, CATEGORY_LABELS } from '../canvas/colors';
import { polygonArea } from '../geometry/polygonOps';
import type { RoomCategory } from '../store/types';

const ROOM_CATEGORIES: RoomCategory[] = [
  'living', 'bedroom', 'bathroom', 'kitchen', 'balcony', 'storage',
];

export function PropertiesPanel() {
  const selectedId = usePlanStore((s) => s.selectedId);
  const rooms = usePlanStore((s) => s.rooms);
  const elements = usePlanStore((s) => s.elements);
  const metadata = usePlanStore((s) => s.metadata);
  const updateRoom = usePlanStore((s) => s.updateRoom);
  const removeRoom = usePlanStore((s) => s.removeRoom);
  const removeElement = usePlanStore((s) => s.removeElement);
  const setMetadata = usePlanStore((s) => s.setMetadata);

  const selectedRoom = rooms.find((r) => r.id === selectedId);
  const selectedElement = elements.find((e) => e.id === selectedId);
  const selected = selectedRoom || selectedElement;

  return (
    <div style={styles.panel}>
      <div style={styles.sectionLabel}>Properties</div>

      {!selected ? (
        <div style={styles.hint}>Select an element to see properties</div>
      ) : (
        <div style={styles.section}>
          <div style={styles.row}>
            <span style={styles.label}>Type:</span>
            <span
              style={{
                display: 'inline-block',
                width: 12,
                height: 12,
                background: CATEGORY_COLORS[selected.category],
                border: '1px solid #999',
                marginRight: 4,
                verticalAlign: 'middle',
              }}
            />
            {CATEGORY_LABELS[selected.category]}
          </div>

          {selectedRoom && (
            <>
              <div style={styles.row}>
                <span style={styles.label}>Category:</span>
                <select
                  value={selectedRoom.category}
                  onChange={(e) =>
                    updateRoom(selectedRoom.id, { category: e.target.value as RoomCategory })
                  }
                  style={styles.select}
                >
                  {ROOM_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </select>
              </div>

              <div style={styles.row}>
                <span style={styles.label}>Label:</span>
                <input
                  type="text"
                  value={selectedRoom.label || ''}
                  placeholder={CATEGORY_LABELS[selectedRoom.category]}
                  onChange={(e) => updateRoom(selectedRoom.id, { label: e.target.value || undefined })}
                  style={styles.input}
                />
              </div>

              <div style={styles.row}>
                <span style={styles.label}>Area:</span>
                {(polygonArea(selectedRoom.vertices) / (metadata.pixelsPerMeter * metadata.pixelsPerMeter)).toFixed(2)} m²
              </div>

              <div style={styles.row}>
                <span style={styles.label}>Vertices:</span>
                {selectedRoom.vertices.length}
              </div>
            </>
          )}

          {selectedElement && (
            <div style={styles.row}>
              <span style={styles.label}>Element:</span>
              {CATEGORY_LABELS[selectedElement.category]}
            </div>
          )}

          <button
            onClick={() => {
              if (selectedRoom) removeRoom(selectedRoom.id);
              else if (selectedElement) removeElement(selectedElement.id);
            }}
            style={styles.deleteBtn}
          >
            Delete (Del)
          </button>
        </div>
      )}

      <div style={{ ...styles.section, marginTop: 16 }}>
        <div style={styles.sectionLabel}>Metadata</div>
        <div style={styles.row}>
          <span style={styles.label}>Plan ID:</span>
          <input
            type="number"
            value={metadata.id}
            onChange={(e) => setMetadata({ id: Number(e.target.value) })}
            style={{ ...styles.input, width: 70 }}
          />
        </div>
        <div style={styles.row}>
          <span style={styles.label}>Wall Depth:</span>
          <input
            type="number"
            step="0.5"
            value={metadata.wallDepth}
            onChange={(e) => setMetadata({ wallDepth: Number(e.target.value) })}
            style={{ ...styles.input, width: 70 }}
          />
        </div>
        <div style={styles.row}>
          <span style={styles.label}>px/m:</span>
          <input
            type="number"
            value={metadata.pixelsPerMeter}
            onChange={(e) => setMetadata({ pixelsPerMeter: Number(e.target.value) })}
            style={{ ...styles.input, width: 70 }}
          />
        </div>
      </div>

      <div style={{ ...styles.section, marginTop: 16 }}>
        <div style={styles.sectionLabel}>Summary</div>
        <div style={styles.row}>Rooms: {rooms.length}</div>
        <div style={styles.row}>Elements: {elements.length}</div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    width: 200,
    background: '#f5f5f5',
    borderLeft: '1px solid #ddd',
    padding: 8,
    fontSize: 13,
    overflowY: 'auto',
    flexShrink: 0,
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  sectionLabel: {
    fontWeight: 600,
    fontSize: 11,
    textTransform: 'uppercase',
    color: '#666',
    marginBottom: 4,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  label: {
    fontWeight: 500,
    color: '#555',
    minWidth: 60,
  },
  hint: {
    color: '#999',
    fontSize: 12,
    fontStyle: 'italic',
  },
  select: {
    padding: '2px 4px',
    border: '1px solid #ccc',
    borderRadius: 3,
    fontSize: 12,
    flex: 1,
  },
  input: {
    padding: '2px 4px',
    border: '1px solid #ccc',
    borderRadius: 3,
    fontSize: 12,
    flex: 1,
  },
  deleteBtn: {
    marginTop: 8,
    padding: '5px 8px',
    background: '#fff',
    border: '1px solid #c00',
    color: '#c00',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 12,
  },
};
