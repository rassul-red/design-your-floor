import { useRef, useState } from 'react';
import { saveAs } from 'file-saver';
import { usePlanStore } from '../store/planStore';
import { exportPlanJSON } from '../io/jsonExport';
import { importPlanJSON } from '../io/jsonImport';
import { exportPNG } from '../io/imageExport';

const FURNITURE_API = 'http://localhost:8000';

export function ExportBar() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const furnitureInputRef = useRef<HTMLInputElement>(null);
  const rooms = usePlanStore((s) => s.rooms);
  const elements = usePlanStore((s) => s.elements);
  const metadata = usePlanStore((s) => s.metadata);
  const loadPlan = usePlanStore((s) => s.loadPlan);

  const renderInputRef = useRef<HTMLInputElement>(null);

  const [furnitureStatus, setFurnitureStatus] = useState<
    'idle' | 'submitting' | 'processing' | 'done' | 'error'
  >('idle');
  const [furnitureMsg, setFurnitureMsg] = useState('');

  const [renderStatus, setRenderStatus] = useState<'idle' | 'rendering' | 'done' | 'error'>('idle');
  const [renderMsg, setRenderMsg] = useState('');

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
    e.target.value = '';
  };

  const handleFurnitureCreate = () => {
    furnitureInputRef.current?.click();
  };

  const handleFurnitureFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    setFurnitureStatus('submitting');
    setFurnitureMsg('Uploading file...');

    try {
      const formData = new FormData();
      formData.append('file', file);

      const submitRes = await fetch(`${FURNITURE_API}/process`, {
        method: 'POST',
        body: formData,
      });

      if (!submitRes.ok) {
        throw new Error(`Server error: ${submitRes.status}`);
      }

      const { job_id } = await submitRes.json();
      setFurnitureStatus('processing');
      setFurnitureMsg(`Processing (job: ${job_id})...`);

      // Poll for completion
      const poll = async (): Promise<void> => {
        const statusRes = await fetch(`${FURNITURE_API}/status/${job_id}`);
        const statusData = await statusRes.json();

        if (statusData.status === 'done') {
          setFurnitureMsg('Downloading results...');

          // Download furnished JSON
          const resultRes = await fetch(`${FURNITURE_API}/result/${job_id}`);
          const resultJson = await resultRes.json();
          const resultBlob = new Blob([JSON.stringify(resultJson, null, 2)], { type: 'application/json' });
          saveAs(resultBlob, `${file.name.replace('.json', '')}_furnished.json`);

          // Download furnished PNG if available
          if (statusData.result_png_url) {
            try {
              const pngRes = await fetch(`${FURNITURE_API}${statusData.result_png_url}`);
              if (pngRes.ok) {
                const pngBlob = await pngRes.blob();
                saveAs(pngBlob, `${file.name.replace('.json', '')}_furnished.png`);
              }
            } catch { /* PNG is optional */ }
          }

          setFurnitureStatus('done');
          setFurnitureMsg('Done — furnished JSON + PNG downloaded!');
          setTimeout(() => setFurnitureStatus('idle'), 3000);
          return;
        }

        if (statusData.status === 'error') {
          throw new Error(statusData.error || 'Pipeline failed');
        }

        setFurnitureMsg(`Processing (${statusData.status})...`);
        await new Promise((r) => setTimeout(r, 5000));
        return poll();
      };

      await poll();
    } catch (err) {
      setFurnitureStatus('error');
      setFurnitureMsg(err instanceof Error ? err.message : 'Unknown error');
      setTimeout(() => setFurnitureStatus('idle'), 5000);
    }
  };

  const handleRenderClick = () => {
    renderInputRef.current?.click();
  };

  const handleRenderFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    setRenderStatus('rendering');
    setRenderMsg('Rendering PNG...');

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch(`${FURNITURE_API}/render`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || `Server error: ${res.status}`);
      }

      const blob = await res.blob();
      saveAs(blob, `${file.name.replace('.json', '')}.png`);
      setRenderStatus('done');
      setRenderMsg('Done — PNG downloaded!');
      setTimeout(() => setRenderStatus('idle'), 3000);
    } catch (err) {
      setRenderStatus('error');
      setRenderMsg(err instanceof Error ? err.message : 'Unknown error');
      setTimeout(() => setRenderStatus('idle'), 5000);
    }
  };

  const isBusy = furnitureStatus === 'submitting' || furnitureStatus === 'processing';

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
      <button
        onClick={handleFurnitureCreate}
        disabled={isBusy}
        style={{
          ...styles.btn,
          background: isBusy ? '#e0e0e0' : '#4CAF50',
          color: isBusy ? '#888' : '#fff',
          border: '1px solid #388E3C',
          fontWeight: 600,
        }}
      >
        {isBusy ? 'Working...' : 'Furniture Create'}
      </button>
      <button
        onClick={handleRenderClick}
        disabled={renderStatus === 'rendering'}
        style={{
          ...styles.btn,
          background: renderStatus === 'rendering' ? '#e0e0e0' : '#1976D2',
          color: renderStatus === 'rendering' ? '#888' : '#fff',
          border: '1px solid #1565C0',
          fontWeight: 600,
        }}
      >
        {renderStatus === 'rendering' ? 'Rendering...' : 'Furniture Generate'}
      </button>
      {renderStatus !== 'idle' && (
        <span
          style={{
            fontSize: 12,
            alignSelf: 'center',
            color:
              renderStatus === 'error'
                ? '#d32f2f'
                : renderStatus === 'done'
                  ? '#2e7d32'
                  : '#555',
          }}
        >
          {renderMsg}
        </span>
      )}
      {furnitureStatus !== 'idle' && (
        <span
          style={{
            fontSize: 12,
            alignSelf: 'center',
            color:
              furnitureStatus === 'error'
                ? '#d32f2f'
                : furnitureStatus === 'done'
                  ? '#2e7d32'
                  : '#555',
          }}
        >
          {furnitureMsg}
        </span>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
      <input
        ref={furnitureInputRef}
        type="file"
        accept=".json"
        style={{ display: 'none' }}
        onChange={handleFurnitureFileChange}
      />
      <input
        ref={renderInputRef}
        type="file"
        accept=".json"
        style={{ display: 'none' }}
        onChange={handleRenderFileChange}
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
