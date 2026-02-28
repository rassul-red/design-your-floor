import { Toolbar } from './components/Toolbar';
import { CanvasContainer } from './components/CanvasContainer';
import { PropertiesPanel } from './components/PropertiesPanel';
import { ExportBar } from './components/ExportBar';

export default function App() {
  return (
    <div style={styles.container}>
      <div style={styles.main}>
        <Toolbar />
        <div style={styles.canvasWrapper}>
          <CanvasContainer />
        </div>
        <PropertiesPanel />
      </div>
      <ExportBar />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    width: '100vw',
    overflow: 'hidden',
  },
  main: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
  },
  canvasWrapper: {
    flex: 1,
    overflow: 'hidden',
    position: 'relative',
  },
};
