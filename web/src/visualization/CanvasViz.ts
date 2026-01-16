import { Edge, QuantumBase } from "../engine/types";
import {
  BEAT_AVOID_RADIUS_PX,
  BEAT_SELECT_RADIUS_PX,
  EDGE_SELECT_RADIUS_PX,
  MAX_EDGE_SAMPLES,
  MAX_EDGES_BASE,
} from "../app/constants";
import { distanceToQuadratic, distanceToSegment } from "./geometry";

interface VisualizationData {
  beats: QuantumBase[];
  edges: Edge[];
}

interface JumpLine {
  from: number;
  to: number;
  at: number;
}

export type Positioner = (
  count: number,
  width: number,
  height: number
) => Array<{ x: number; y: number }>;

export class CanvasViz {
  private container: HTMLElement;
  private baseCanvas: HTMLCanvasElement;
  private overlayCanvas: HTMLCanvasElement;
  private baseCtx: CanvasRenderingContext2D;
  private overlayCtx: CanvasRenderingContext2D;

  private data: VisualizationData | null = null;
  private positions: Array<{ x: number; y: number }> = [];
  private center = { x: 0, y: 0 };

  private currentIndex = -1;
  private jumpLine: JumpLine | null = null;
  private selectedEdge: Edge | null = null;

  private onSelect: ((index: number) => void) | null = null;
  private onEdgeSelect: ((edge: Edge | null) => void) | null = null;

  private positioner: Positioner;
  private visible = true;

  private edgeGeometry = new WeakMap<
    Edge,
    { bend: boolean; control: [number, number] | null }
  >();
  private theme = {
    edgeStroke: "rgba(74, 199, 255, 0.12)",
    beatFill: "rgba(255, 215, 130, 0.55)",
    edgeSelected: "#ff5b5b",
    beatHighlight: "#ffd46a",
  };

  constructor(container: HTMLElement, positioner: Positioner) {
    this.container = container;
    this.positioner = positioner;
    this.baseCanvas = document.createElement("canvas");
    this.overlayCanvas = document.createElement("canvas");
    const baseCtx = this.baseCanvas.getContext("2d");
    const overlayCtx = this.overlayCanvas.getContext("2d");
    if (!baseCtx || !overlayCtx) {
      throw new Error("Canvas not supported");
    }
    this.baseCtx = baseCtx;
    this.overlayCtx = overlayCtx;
    this.container.append(this.baseCanvas, this.overlayCanvas);
    this.applyCanvasStyles();
    this.updateTheme();
    this.resize();
    this.overlayCanvas.addEventListener("click", this.handleCanvasClick);
  }

  setVisible(visible: boolean) {
    this.visible = visible;
    const display = visible ? "block" : "none";
    this.baseCanvas.style.display = display;
    this.overlayCanvas.style.display = display;
    if (visible && this.data) {
      this.drawBase();
      this.drawOverlay();
    }
  }

  setData(data: VisualizationData) {
    this.data = data;
    this.computePositions();
    this.computeEdgeGeometry();
    this.drawBase();
    this.drawOverlay();
  }

  refresh() {
    if (!this.data) {
      return;
    }
    this.updateTheme();
    this.drawBase();
    this.drawOverlay();
  }

  update(currentIndex: number, lastJumped: boolean, previousIndex: number | null) {
    this.currentIndex = currentIndex;
    if (lastJumped && previousIndex !== null) {
      this.jumpLine = {
        from: previousIndex,
        to: currentIndex,
        at: performance.now(),
      };
    }
    this.drawOverlay();
  }

  reset() {
    this.currentIndex = -1;
    this.jumpLine = null;
    this.selectedEdge = null;
    this.drawOverlay();
  }

  setOnSelect(handler: (index: number) => void) {
    this.onSelect = handler;
  }

  setOnEdgeSelect(handler: (edge: Edge | null) => void) {
    this.onEdgeSelect = handler;
  }

  setSelectedEdge(edge: Edge | null) {
    this.selectedEdge = edge;
    this.drawOverlay();
  }

  resizeNow() {
    this.resize();
  }

  private applyCanvasStyles() {
    this.baseCanvas.style.position = "absolute";
    this.baseCanvas.style.inset = "0";
    this.baseCanvas.style.width = "100%";
    this.baseCanvas.style.height = "100%";
    this.overlayCanvas.style.position = "absolute";
    this.overlayCanvas.style.inset = "0";
    this.overlayCanvas.style.width = "100%";
    this.overlayCanvas.style.height = "100%";
  }

  private resize() {
    const rect = this.container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    this.baseCanvas.width = rect.width * dpr;
    this.baseCanvas.height = rect.height * dpr;
    this.overlayCanvas.width = rect.width * dpr;
    this.overlayCanvas.height = rect.height * dpr;
    this.baseCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.data) {
      this.computePositions();
      this.computeEdgeGeometry();
      this.drawBase();
      this.drawOverlay();
    }
  }

  private computePositions() {
    if (!this.data) {
      return;
    }
    const { width, height } = this.container.getBoundingClientRect();
    this.positions = this.positioner(this.data.beats.length, width, height);
    this.center = { x: width / 2, y: height / 2 };
  }

  private computeEdgeGeometry() {
    if (!this.data) {
      return;
    }
    this.edgeGeometry = new WeakMap();
    for (const edge of this.data.edges) {
      if (edge.deleted) {
        continue;
      }
      const from = this.positions[edge.src.which];
      const to = this.positions[edge.dest.which];
      if (!from || !to) {
        continue;
      }
      const bend = this.shouldBendEdge(from, to);
      const control = bend ? this.getBendControlPoint(from, to) : null;
      this.edgeGeometry.set(edge, { bend, control });
    }
  }

  private updateTheme() {
    const styles = getComputedStyle(document.documentElement);
    this.theme.edgeStroke =
      styles.getPropertyValue("--edge-stroke").trim() || this.theme.edgeStroke;
    this.theme.beatFill =
      styles.getPropertyValue("--beat-fill").trim() || this.theme.beatFill;
    this.theme.edgeSelected =
      styles.getPropertyValue("--edge-selected").trim() ||
      this.theme.edgeSelected;
    this.theme.beatHighlight =
      styles.getPropertyValue("--beat-highlight").trim() ||
      this.theme.beatHighlight;
  }

  private drawBase() {
    if (!this.data || !this.visible) {
      return;
    }
    const { width, height } = this.container.getBoundingClientRect();
    this.baseCtx.clearRect(0, 0, width, height);
    this.baseCtx.save();
    this.baseCtx.lineWidth = 1;

    const edges = this.data.edges;
    const step =
      edges.length > MAX_EDGES_BASE
        ? Math.ceil(edges.length / MAX_EDGES_BASE)
        : 1;

    for (let i = 0; i < edges.length; i += step) {
      const edge = edges[i];
      if (edge.deleted) {
        continue;
      }
      this.drawEdge(this.baseCtx, edge, this.theme.edgeStroke, 1);
    }

    this.baseCtx.fillStyle = this.theme.beatFill;
    for (let i = 0; i < this.positions.length; i += 1) {
      const p = this.positions[i];
      this.baseCtx.beginPath();
      this.baseCtx.arc(p.x, p.y, 2, 0, Math.PI * 2);
      this.baseCtx.fill();
    }
    this.baseCtx.restore();
  }

  private drawOverlay() {
    const { width, height } = this.container.getBoundingClientRect();
    this.overlayCtx.clearRect(0, 0, width, height);
    if (!this.data || !this.visible) {
      return;
    }
    if (this.selectedEdge && !this.selectedEdge.deleted) {
      this.drawEdge(this.overlayCtx, this.selectedEdge, this.theme.edgeSelected, 2.5);
    }
    if (this.currentIndex < 0) {
      return;
    }
    const current = this.positions[this.currentIndex];
    if (current) {
      this.overlayCtx.fillStyle = this.theme.beatHighlight;
      this.overlayCtx.beginPath();
      this.overlayCtx.arc(current.x, current.y, 10, 0, Math.PI * 2);
      this.overlayCtx.fill();
    }
    if (this.jumpLine) {
      const age = performance.now() - this.jumpLine.at;
      if (age < 1000) {
        const from = this.positions[this.jumpLine.from];
        const to = this.positions[this.jumpLine.to];
        if (from && to) {
          const alpha = 1 - age / 1000;
          const jumpColor = this.resolveBeatJumpColor(alpha);
          if (this.shouldBendEdge(from, to)) {
            this.drawBentLine(this.overlayCtx, from, to, jumpColor, 2);
          } else {
            this.overlayCtx.strokeStyle = jumpColor;
            this.overlayCtx.lineWidth = 2;
            this.overlayCtx.beginPath();
            this.overlayCtx.moveTo(from.x, from.y);
            this.overlayCtx.lineTo(to.x, to.y);
            this.overlayCtx.stroke();
          }
        }
      } else {
        this.jumpLine = null;
      }
    }
  }

  private resolveBeatJumpColor(alpha: number) {
    const color = this.theme.beatHighlight.trim();
    if (color.startsWith("#")) {
      const hex = color.slice(1);
      const normalized =
        hex.length === 3
          ? hex
              .split("")
              .map((ch) => ch + ch)
              .join("")
          : hex.slice(0, 6);
      const r = Number.parseInt(normalized.slice(0, 2), 16);
      const g = Number.parseInt(normalized.slice(2, 4), 16);
      const b = Number.parseInt(normalized.slice(4, 6), 16);
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    const match = color.match(/rgba?\(([^)]+)\)/i);
    if (match) {
      const parts = match[1].split(",").map((value) => Number.parseFloat(value));
      if (parts.length >= 3 && parts.every((value) => Number.isFinite(value))) {
        return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${alpha})`;
      }
    }
    return color;
  }

  private handleCanvasClick = (event: MouseEvent) => {
    if (!this.data || !this.visible) {
      return;
    }
    const rect = this.overlayCanvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    if (this.onSelect) {
      const maxDistance = BEAT_SELECT_RADIUS_PX;
      let bestIndex = -1;
      let bestDist = Infinity;
      for (let i = 0; i < this.positions.length; i += 1) {
        const p = this.positions[i];
        const dx = p.x - x;
        const dy = p.y - y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < bestDist) {
          bestDist = d;
          bestIndex = i;
        }
      }
      if (bestIndex >= 0 && bestDist <= maxDistance) {
        this.onSelect(bestIndex);
        return;
      }
    }
    if (this.onEdgeSelect) {
      const edgeThreshold = EDGE_SELECT_RADIUS_PX;
      let bestEdge: Edge | null = null;
      let bestEdgeDist = Infinity;
      for (const edge of this.data.edges) {
        if (edge.deleted) {
          continue;
        }
        const from = this.positions[edge.src.which];
        const to = this.positions[edge.dest.which];
        if (!from || !to) {
          continue;
        }
        const geometry = this.getEdgeGeometry(edge);
        if (!geometry) {
          continue;
        }
        const dist =
          geometry.bend && geometry.control
            ? distanceToQuadratic(
                x,
                y,
                from.x,
                from.y,
                ...geometry.control,
                to.x,
                to.y
              )
            : distanceToSegment(x, y, from.x, from.y, to.x, to.y);
        if (dist < bestEdgeDist) {
          bestEdgeDist = dist;
          bestEdge = edge;
        }
      }
      if (bestEdge && bestEdgeDist <= edgeThreshold) {
        const nextEdge = this.selectedEdge === bestEdge ? null : bestEdge;
        this.onEdgeSelect(nextEdge);
      }
    }
  };

  private drawEdge(
    ctx: CanvasRenderingContext2D,
    edge: Edge,
    color: string,
    lineWidth: number
  ) {
    const from = this.positions[edge.src.which];
    const to = this.positions[edge.dest.which];
    if (!from || !to) {
      return;
    }
    const geometry = this.getEdgeGeometry(edge);
    if (geometry?.bend && geometry.control) {
      this.drawBentLineWithControl(ctx, from, to, geometry.control, color, lineWidth);
      return;
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }

  private getEdgeGeometry(
    edge: Edge
  ): { bend: boolean; control: [number, number] | null } | null {
    const cached = this.edgeGeometry.get(edge);
    if (cached) {
      return cached;
    }
    const from = this.positions[edge.src.which];
    const to = this.positions[edge.dest.which];
    if (!from || !to) {
      return null;
    }
    const bend = this.shouldBendEdge(from, to);
    const control = bend ? this.getBendControlPoint(from, to) : null;
    const next = { bend, control };
    this.edgeGeometry.set(edge, next);
    return next;
  }

  private shouldBendEdge(from: { x: number; y: number }, to: { x: number; y: number }) {
    const step = Math.max(1, Math.ceil(this.positions.length / MAX_EDGE_SAMPLES));
    for (let i = 0; i < this.positions.length; i += step) {
      const p = this.positions[i];
      if (!p) {
        continue;
      }
      if ((p.x === from.x && p.y === from.y) || (p.x === to.x && p.y === to.y)) {
        continue;
      }
      const dist = distanceToSegment(p.x, p.y, from.x, from.y, to.x, to.y);
      if (dist <= BEAT_AVOID_RADIUS_PX) {
        return true;
      }
    }
    return false;
  }

  private drawBentLine(
    ctx: CanvasRenderingContext2D,
    from: { x: number; y: number },
    to: { x: number; y: number },
    color: string,
    lineWidth: number
  ) {
    const [cx, cy] = this.getBendControlPoint(from, to);
    this.drawBentLineWithControl(ctx, from, to, [cx, cy], color, lineWidth);
  }

  private drawBentLineWithControl(
    ctx: CanvasRenderingContext2D,
    from: { x: number; y: number },
    to: { x: number; y: number },
    control: [number, number],
    color: string,
    lineWidth: number
  ) {
    const [cx, cy] = control;
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.quadraticCurveTo(cx, cy, to.x, to.y);
    ctx.stroke();
  }

  private getBendControlPoint(
    from: { x: number; y: number },
    to: { x: number; y: number }
  ): [number, number] {
    const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
    const dirX = this.center.x - mid.x;
    const dirY = this.center.y - mid.y;
    const dirLen = Math.hypot(dirX, dirY);
    if (dirLen === 0) {
      return [mid.x, mid.y];
    }
    const normX = dirX / dirLen;
    const normY = dirY / dirLen;
    const centerDist = Math.hypot(this.center.x - mid.x, this.center.y - mid.y);
    return [
      mid.x + normX * (centerDist * 0.5),
      mid.y + normY * (centerDist * 0.5),
    ];
  }
}
