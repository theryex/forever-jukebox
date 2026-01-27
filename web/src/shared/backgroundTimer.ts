/**
 * Background timer module that maintains timing accuracy when the tab is hidden.
 *
 * Browsers throttle setTimeout/setInterval when a tab loses focus to save resources.
 * This module uses a Web Worker to maintain accurate timing for audio scheduling.
 */

type TimerCallback = (...args: unknown[]) => void;

interface PendingTimer {
  callback: TimerCallback;
  args: unknown[];
}

let worker: Worker | null = null;
const callbacks = new Map<number, PendingTimer>();
let nextId = 1;
let isDocumentHidden = typeof document !== "undefined" && document.hidden;

// Store original functions
const originalSetTimeout = window.setTimeout.bind(window);
const originalClearTimeout = window.clearTimeout.bind(window);
const originalSetInterval = window.setInterval.bind(window);
const originalClearInterval = window.clearInterval.bind(window);

/**
 * Initialize the background timer worker.
 * Call this early in app bootstrap.
 */
export function initBackgroundTimer(): void {
  if (worker) {
    return; // Already initialized
  }

  try {
    worker = new Worker("/worker.js");
    worker.onmessage = handleWorkerMessage;
    worker.onerror = handleWorkerError;
  } catch (err) {
    console.warn("Background timer worker failed to initialize:", err);
    worker = null;
  }

  // Track visibility changes
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", handleVisibilityChange);
  }
}

function handleWorkerMessage(event: MessageEvent): void {
  const { type, id } = event.data;
  if (type === "timeout" || type === "interval") {
    const pending = callbacks.get(id);
    if (pending) {
      pending.callback(...pending.args);
      if (type === "timeout") {
        callbacks.delete(id);
      }
    }
  }
}

function handleWorkerError(err: ErrorEvent): void {
  console.warn("Background timer worker error:", err);
}

function handleVisibilityChange(): void {
  isDocumentHidden = document.hidden;
}

/**
 * Get a unique negative ID for worker-based timers.
 * Negative IDs distinguish worker timers from native timers.
 */
function getWorkerId(): number {
  return -(nextId++);
}

/**
 * setTimeout replacement that uses the worker when the document is hidden.
 */
export function backgroundSetTimeout(
  callback: TimerCallback,
  delay?: number,
  ...args: unknown[]
): number {
  if (!worker || !isDocumentHidden) {
    return originalSetTimeout(callback, delay, ...args);
  }

  const id = getWorkerId();
  callbacks.set(id, { callback, args });
  worker.postMessage({ command: "setTimeout", id, delay: delay ?? 0 });
  return id;
}

/**
 * clearTimeout replacement that handles both native and worker timers.
 */
export function backgroundClearTimeout(id: number): void {
  if (id < 0) {
    // Worker timer
    callbacks.delete(id);
    if (worker) {
      worker.postMessage({ command: "clearTimeout", id });
    }
  } else {
    originalClearTimeout(id);
  }
}

/**
 * setInterval replacement that uses the worker when the document is hidden.
 */
export function backgroundSetInterval(
  callback: TimerCallback,
  delay?: number,
  ...args: unknown[]
): number {
  if (!worker || !isDocumentHidden) {
    return originalSetInterval(callback, delay, ...args);
  }

  const id = getWorkerId();
  callbacks.set(id, { callback, args });
  worker.postMessage({ command: "setInterval", id, delay: delay ?? 0 });
  return id;
}

/**
 * clearInterval replacement that handles both native and worker timers.
 */
export function backgroundClearInterval(id: number): void {
  if (id < 0) {
    // Worker timer
    callbacks.delete(id);
    if (worker) {
      worker.postMessage({ command: "clearInterval", id });
    }
  } else {
    originalClearInterval(id);
  }
}

/**
 * Install background timer globally by overriding window.setTimeout/etc.
 * This makes all existing code automatically use background timing.
 */
export function installGlobalBackgroundTimer(): void {
  initBackgroundTimer();

  // Override global functions
  (window as unknown as Record<string, unknown>).setTimeout = backgroundSetTimeout;
  (window as unknown as Record<string, unknown>).clearTimeout = backgroundClearTimeout;
  (window as unknown as Record<string, unknown>).setInterval = backgroundSetInterval;
  (window as unknown as Record<string, unknown>).clearInterval = backgroundClearInterval;
}

/**
 * Restore original timer functions.
 */
export function uninstallGlobalBackgroundTimer(): void {
  (window as unknown as Record<string, unknown>).setTimeout = originalSetTimeout;
  (window as unknown as Record<string, unknown>).clearTimeout = originalClearTimeout;
  (window as unknown as Record<string, unknown>).setInterval = originalSetInterval;
  (window as unknown as Record<string, unknown>).clearInterval = originalClearInterval;
}
