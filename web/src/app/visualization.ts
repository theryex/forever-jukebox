import { CanvasViz } from "../visualization/CanvasViz";

export function createVisualizations(vizLayer: HTMLElement) {
  const positioners = [
    (count: number, width: number, height: number) => {
      const radius = Math.min(width, height) * 0.4;
      const cx = width / 2;
      const cy = height / 2;
      return Array.from({ length: count }, (_, i) => {
        const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
        return {
          x: cx + Math.cos(angle) * radius,
          y: cy + Math.sin(angle) * radius,
        };
      });
    },
    (count: number, width: number, height: number) => {
      const cx = width / 2;
      const cy = height / 2;
      const maxRadius = Math.min(width, height) * 0.42;
      const minRadius = Math.min(width, height) * 0.08;
      const turns = 3;
      return Array.from({ length: count }, (_, i) => {
        const t = i / count;
        const angle = t * Math.PI * 2 * turns - Math.PI / 2;
        const radius = minRadius + (maxRadius - minRadius) * t;
        return {
          x: cx + Math.cos(angle) * radius,
          y: cy + Math.sin(angle) * radius,
        };
      });
    },
    (count: number, width: number, height: number) => {
      const cols = Math.ceil(Math.sqrt(count));
      const rows = Math.ceil(count / cols);
      const padding = 40;
      const gridW = width - padding * 2;
      const gridH = height - padding * 2;
      return Array.from({ length: count }, (_, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        return {
          x: padding + (col / Math.max(1, cols - 1)) * gridW,
          y: padding + (row / Math.max(1, rows - 1)) * gridH,
        };
      });
    },
    (count: number, width: number, height: number) => {
      const padding = 40;
      const amp = height * 0.25;
      const center = height / 2;
      const span = width - padding * 2;
      const waveTurns = 3;
      return Array.from({ length: count }, (_, i) => {
        const t = i / Math.max(1, count - 1);
        return {
          x: padding + span * t,
          y: center + Math.sin(t * Math.PI * 2 * waveTurns) * amp,
        };
      });
    },
    (count: number, width: number, height: number) => {
      const cx = width / 2;
      const cy = height / 2;
      const ampX = width * 0.35;
      const ampY = height * 0.25;
      return Array.from({ length: count }, (_, i) => {
        const t = (i / count) * Math.PI * 2;
        return {
          x: cx + Math.sin(t) * ampX,
          y: cy + Math.sin(t * 2) * ampY,
        };
      });
    },
    (count: number, width: number, height: number) => {
      const cx = width / 2;
      const cy = height / 2;
      const maxRadius = Math.min(width, height) * 0.42;
      const minRadius = Math.min(width, height) * 0.08;
      const goldenAngle = Math.PI * (3 - Math.sqrt(5));
      return Array.from({ length: count }, (_, i) => {
        const t = i / Math.max(1, count - 1);
        const angle = i * goldenAngle;
        const radius = minRadius + (maxRadius - minRadius) * Math.sqrt(t);
        const wobble =
          0.06 * Math.sin(i * 12.9898) + 0.04 * Math.cos(i * 4.1414);
        const r = radius * (1 + wobble);
        return {
          x: cx + Math.cos(angle) * r,
          y: cy + Math.sin(angle) * r,
        };
      });
    },
    // Visualization 7: Retro Tiles
    // Same layout as viz 7, but designed for the retro tile renderer
    // (tiles are rendered with special coloring based on timbre)
    (count: number, width: number, height: number) => {
      const radius = Math.min(width, height) * 0.36;
      const cx = width / 2;
      const cy = height / 2;
      return Array.from({ length: count }, (_, i) => {
        const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
        return {
          x: cx + Math.cos(angle) * radius,
          y: cy + Math.sin(angle) * radius,
        };
      });
    },
  ];
  return positioners.map((positioner) => new CanvasViz(vizLayer, positioner));
}

export function attachVisualizationResize(
  visualizations: CanvasViz[],
  panel: HTMLElement
) {
  const handleResize = () => {
    visualizations.forEach((viz) => viz.resizeNow());
  };
  const hasResizeObserver =
    typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver !==
    "undefined";
  if (hasResizeObserver) {
    const observer = new ResizeObserver(() => {
      handleResize();
    });
    observer.observe(panel);
  } else {
    window.addEventListener("resize", handleResize);
  }
}
