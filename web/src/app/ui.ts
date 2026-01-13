import type { AppContext } from "./context";

export function setAnalysisStatus(
  context: AppContext,
  message: string,
  spinning: boolean
) {
  const { elements } = context;
  elements.analysisStatus.textContent = message;
  if (spinning) {
    elements.analysisSpinner.classList.remove("hidden");
  } else {
    elements.analysisSpinner.classList.add("hidden");
    elements.analysisProgress.textContent = "";
  }
}

export function setLoadingProgress(
  context: AppContext,
  progress: number | null,
  message?: string | null
) {
  const { elements } = context;
  elements.analysisStatus.textContent = message?.trim() || "Loading";
  elements.analysisSpinner.classList.remove("hidden");
  if (typeof progress === "number") {
    elements.analysisProgress.textContent = `${Math.round(progress)}%`;
  } else {
    elements.analysisProgress.textContent = "";
  }
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName.toLowerCase();
  return (
    tag === "input" ||
    tag === "textarea" ||
    tag === "button" ||
    tag === "select" ||
    tag === "a" ||
    target.isContentEditable
  );
}

export function showToast(context: AppContext, message: string) {
  const { elements, state } = context;
  elements.toast.textContent = message;
  elements.toast.classList.remove("hidden");
  if (state.toastTimer !== null) {
    window.clearTimeout(state.toastTimer);
  }
  state.toastTimer = window.setTimeout(() => {
    elements.toast.classList.add("hidden");
    state.toastTimer = null;
  }, 2000);
}
