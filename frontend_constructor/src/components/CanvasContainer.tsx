import { useRef, useEffect, useCallback } from 'react';
import { usePlanStore } from '../store/planStore';
import { CanvasRenderer } from '../canvas/CanvasRenderer';
import { ToolManager } from '../tools/ToolManager';
import { DrawRoomTool } from '../tools/DrawRoomTool';
import { SelectTool } from '../tools/SelectTool';
import { PlaceDoorTool } from '../tools/PlaceDoorTool';
import { CATEGORY_COLORS } from '../canvas/colors';
import type { Point } from '../store/types';

const renderer = new CanvasRenderer();
const toolManager = new ToolManager();

// Register tools
toolManager.registerTool(
  'draw_room',
  new DrawRoomTool(
    () => usePlanStore.getState().metadata.gridSize,
    () => usePlanStore.getState().activeRoomCategory,
  ),
);
toolManager.registerTool(
  'select',
  new SelectTool(() => usePlanStore.getState().metadata.gridSize),
);
toolManager.registerTool('draw_wall', new PlaceDoorTool('wall', () => usePlanStore.getState().metadata.wallDepth));
toolManager.registerTool('place_door', new PlaceDoorTool('door', () => usePlanStore.getState().metadata.wallDepth));
toolManager.registerTool('place_window', new PlaceDoorTool('window', () => usePlanStore.getState().metadata.wallDepth));
toolManager.registerTool('place_front_door', new PlaceDoorTool('front_door', () => usePlanStore.getState().metadata.wallDepth));

export function CanvasContainer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cursorWorldRef = useRef<Point | null>(null);
  const isPanningRef = useRef(false);
  const lastPanRef = useRef<Point | null>(null);
  const spaceDownRef = useRef(false);
  const rafRef = useRef<number>(0);

  const getMouseWorld = useCallback((e: MouseEvent | React.MouseEvent): Point => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    return renderer.vt.screenToWorld(screen);
  }, []);

  const getMouseScreen = useCallback((e: MouseEvent | React.MouseEvent): Point => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const requestRender = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const state = usePlanStore.getState();
      const tool = toolManager.getActive();
      const drawingVerts = tool?.getDrawingVertices() ?? null;
      const previewRect = tool?.getPreviewRect?.() ?? null;

      // Determine preview color from active tool category
      let previewColor: string | null = null;
      if (previewRect) {
        const toolType = toolManager.getActiveType();
        if (toolType === 'place_door') previewColor = CATEGORY_COLORS.door;
        else if (toolType === 'place_window') previewColor = CATEGORY_COLORS.window;
        else if (toolType === 'place_front_door') previewColor = CATEGORY_COLORS.front_door;
        else if (toolType === 'draw_wall') previewColor = CATEGORY_COLORS.wall;
      }

      renderer.render(
        ctx,
        canvas.width,
        canvas.height,
        state.rooms,
        state.elements,
        state.metadata,
        state.selectedId,
        drawingVerts,
        cursorWorldRef.current,
        true,
        previewRect,
        previewColor,
      );
    });
  }, []);

  // Initial setup + subscribe to store
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const parent = canvas.parentElement!;
      canvas.width = parent.clientWidth;
      canvas.height = parent.clientHeight;
      renderer.vt.fitToScreen(canvas.width, canvas.height);
      requestRender();
    };

    resize();
    window.addEventListener('resize', resize);

    const unsub = usePlanStore.subscribe(() => requestRender());

    return () => {
      window.removeEventListener('resize', resize);
      unsub();
    };
  }, [requestRender]);

  // Sync active tool from store
  useEffect(() => {
    let prevTool = usePlanStore.getState().activeTool;
    return usePlanStore.subscribe((state) => {
      if (state.activeTool !== prevTool) {
        prevTool = state.activeTool;
        toolManager.setActiveTool(state.activeTool);
        requestRender();
      }
    });
  }, [requestRender]);

  // Keyboard
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === ' ') {
        e.preventDefault();
        spaceDownRef.current = true;
        return;
      }

      // Shortcuts
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'z') {
          e.preventDefault();
          if (e.shiftKey) {
            usePlanStore.getState().redo();
          } else {
            usePlanStore.getState().undo();
          }
          return;
        }
      }

      const tool = toolManager.getActive();
      tool?.onKeyDown?.(e);
      requestRender();

      // Tool shortcuts
      if (!e.ctrlKey && !e.metaKey) {
        switch (e.key.toLowerCase()) {
          case 's':
            usePlanStore.getState().setActiveTool('select');
            break;
          case 'r':
            usePlanStore.getState().setActiveTool('draw_room');
            break;
          case 'd':
            usePlanStore.getState().setActiveTool('place_door');
            break;
          case 'w':
            usePlanStore.getState().setActiveTool('place_window');
            break;
          case 'f':
            usePlanStore.getState().setActiveTool('place_front_door');
            break;
          case 'l':
            usePlanStore.getState().setActiveTool('draw_wall');
            break;
        }
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') {
        spaceDownRef.current = false;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [requestRender]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const canvas = canvasRef.current!;
      // Middle click or space+left = pan
      if (e.button === 1 || (e.button === 0 && spaceDownRef.current)) {
        isPanningRef.current = true;
        lastPanRef.current = { x: e.clientX, y: e.clientY };
        canvas.style.cursor = 'grabbing';
        return;
      }

      const world = getMouseWorld(e);
      const screen = getMouseScreen(e);
      toolManager.getActive()?.onMouseDown(world, screen, e.nativeEvent);
      requestRender();
    },
    [getMouseWorld, getMouseScreen, requestRender],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (isPanningRef.current && lastPanRef.current) {
        const dx = e.clientX - lastPanRef.current.x;
        const dy = e.clientY - lastPanRef.current.y;
        renderer.vt.pan(dx, dy);
        lastPanRef.current = { x: e.clientX, y: e.clientY };
        requestRender();
        return;
      }

      const world = getMouseWorld(e);
      cursorWorldRef.current = world;
      const screen = getMouseScreen(e);
      toolManager.getActive()?.onMouseMove(world, screen, e.nativeEvent);
      requestRender();
    },
    [getMouseWorld, getMouseScreen, requestRender],
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      if (isPanningRef.current) {
        isPanningRef.current = false;
        lastPanRef.current = null;
        const tool = toolManager.getActive();
        if (canvasRef.current) {
          canvasRef.current.style.cursor = tool?.getCursor() ?? 'default';
        }
        return;
      }

      const world = getMouseWorld(e);
      const screen = getMouseScreen(e);
      toolManager.getActive()?.onMouseUp(world, screen, e.nativeEvent);
      requestRender();
    },
    [getMouseWorld, getMouseScreen, requestRender],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      const world = getMouseWorld(e);
      const screen = getMouseScreen(e);
      toolManager.getActive()?.onDoubleClick?.(world, screen, e.nativeEvent);
      requestRender();
    },
    [getMouseWorld, getMouseScreen, requestRender],
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const screen = getMouseScreen(e);
      renderer.vt.zoomAt(screen, e.deltaY);
      requestRender();
    },
    [getMouseScreen, requestRender],
  );

  return (
    <canvas
      ref={canvasRef}
      style={{ display: 'block', width: '100%', height: '100%' }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onDoubleClick={handleDoubleClick}
      onWheel={handleWheel}
      onContextMenu={(e) => e.preventDefault()}
    />
  );
}
