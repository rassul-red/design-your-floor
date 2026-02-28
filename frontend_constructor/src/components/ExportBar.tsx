import { useRef } from 'react';
import { saveAs } from 'file-saver';
import { usePlanStore } from '../store/planStore';
import { exportPlanJSON } from '../io/jsonExport';
import { importPlanJSON } from '../io/jsonImport';
import { exportPNG } from '../io/imageExport';

export function ExportBar() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const rooms = usePlanStore((s) => s.rooms);
  const elements = usePlanStore((s) => s.elements);
  const metadata = usePlanStore((s) => s.metadata);
  const loadPlan = usePlanStore((s) => s.loadPlan);

  const handleExportJSON = () => {
    const json = exportPlanJSON(rooms, elements, metadata);
    const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
    saveAs(blob, `plan_${metadata.id || 'export'}.json`);
  };

  const handleExportPNG = () => {
    exportPNG(rooms, elements, metadata, `plan_${metadata.id || 'export'}.png`);
  };

  const handleImport = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string);
        const { rooms: newRooms, elements: newElements, metadata: newMeta } = importPlanJSON(data);
        loadPlan(newRooms, newElements, newMeta);
      } catch (err) {
        alert('Failed to import JSON: ' + (err instanceof Error ? err.message : err));
      }
    };
    reader.readAsText(file);
    // Reset so same file can be imported again
    e.target.value = '';
  };

  return (
    <div style={styles.bar}>
      <button onClick={handleExportJSON} style={styles.btn}>
        Export JSON
      </button>
      <button onClick={handleExportPNG} style={styles.btn}>
        Export PNG
      </button>
      <button onClick={handleImport} style={styles.btn}>
        Import JSON
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  bar: {
    display: 'flex',
    gap: 8,
    padding: '6px 12px',
    background: '#f0f0f0',
    borderTop: '1px solid #ddd',
  },
  btn: {
    padding: '4px 12px',
    border: '1px solid #ccc',
    background: '#fff',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 13,
  },
};
