import { beforeEach, describe, expect, it, vi } from "vitest";
import { attachVisualizationResize } from "./visualization";
import { setWindowUrl } from "./__tests__/test-utils";

describe("visualization helpers", () => {
  beforeEach(() => {
    setWindowUrl("http://localhost/");
  });

  it("attaches resize observer when available", () => {
    const observe = vi.fn();
    (globalThis as any).ResizeObserver = class {
      constructor(cb: () => void) {
        cb();
      }
      observe = observe;
    };
    const viz = [{ resizeNow: vi.fn() }] as any;
    attachVisualizationResize(viz, {} as HTMLElement);
    expect(observe).toHaveBeenCalled();
  });

  it("falls back to window resize listener", () => {
    (globalThis as any).ResizeObserver = undefined;
    (globalThis.window as any).addEventListener = vi.fn();
    const viz = [{ resizeNow: vi.fn() }] as any;
    attachVisualizationResize(viz, {} as HTMLElement);
    expect(window.addEventListener).toHaveBeenCalledWith(
      "resize",
      expect.any(Function),
    );
  });
});
