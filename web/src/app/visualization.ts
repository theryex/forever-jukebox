import { CanvasViz } from "../visualization/CanvasViz";

export function createVisualizations(vizLayer: HTMLElement) {
  const positioners = [
    (data: { beats: { length: number } }, width: number, height: number) => {
      const count = data.beats.length;
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
    (data: { beats: { length: number } }, width: number, height: number) => {
      const count = data.beats.length;
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
    (
      data: { beats: Array<{ parent?: { children?: unknown[] } }> },
      width: number,
      height: number
    ) => {
      const count = data.beats.length;
      let beatsPerBar = 4;
      if (count > 0) {
        const counts = new Map<number, number>();
        let totalParents = 0;
        const seenParents = new Set<object>();
        for (const beat of data.beats) {
          const parent = beat.parent;
          if (!parent || !parent.children) {
            continue;
          }
          if (!seenParents.has(parent)) {
            seenParents.add(parent);
            const length = Math.max(1, parent.children.length);
            counts.set(length, (counts.get(length) ?? 0) + 1);
            totalParents += 1;
          }
        }
        if (counts.size > 0) {
          let best = beatsPerBar;
          let bestCount = -1;
          for (const [size, count] of counts.entries()) {
            if (count > bestCount) {
              bestCount = count;
              best = size;
            }
          }
          beatsPerBar = best;
        }
        if (totalParents === 0) {
          beatsPerBar = 4;
        }
      }
      const totalBars = Math.max(1, Math.ceil(count / Math.max(1, beatsPerBar)));
      const barsPerRow = Math.max(1, Math.ceil(Math.sqrt(totalBars)));
      const cols = Math.max(1, beatsPerBar * barsPerRow);
      const rows = Math.max(1, Math.ceil(count / cols));
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
    (data: { beats: { length: number } }, width: number, height: number) => {
      const count = data.beats.length;
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
    (data: { beats: { length: number } }, width: number, height: number) => {
      const count = data.beats.length;
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
    (data: { beats: { length: number } }, width: number, height: number) => {
      const count = data.beats.length;
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
