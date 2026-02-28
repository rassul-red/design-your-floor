import type { Point, ToolType } from '../store/types';

export interface Tool {
  onMouseDown(worldPoint: Point, screenPoint: Point, event: MouseEvent): void;
  onMouseMove(worldPoint: Point, screenPoint: Point, event: MouseEvent): void;
  onMouseUp(worldPoint: Point, screenPoint: Point, event: MouseEvent): void;
  onDoubleClick?(worldPoint: Point, screenPoint: Point, event: MouseEvent): void;
  onKeyDown?(event: KeyboardEvent): void;
  getDrawingVertices(): Point[] | null;
  getPreviewRect?(): Point[] | null;
  getCursor(): string;
  reset(): void;
}

export class ToolManager {
  private tools = new Map<ToolType, Tool>();
  private activeTool: ToolType = 'draw_room';

  registerTool(type: ToolType, tool: Tool) {
    this.tools.set(type, tool);
  }

  setActiveTool(type: ToolType) {
    if (this.activeTool !== type) {
      this.getActive()?.reset();
    }
    this.activeTool = type;
  }

  getActive(): Tool | undefined {
    return this.tools.get(this.activeTool);
  }

  getActiveType(): ToolType {
    return this.activeTool;
  }
}
