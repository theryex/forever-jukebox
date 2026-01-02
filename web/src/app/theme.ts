import type { AppContext } from "./context";

const themeStorageKey = "fj-theme";

export function applyTheme(context: AppContext, theme: "light" | "dark") {
  const { elements, visualizations } = context;
  document.body.classList.toggle("theme-light", theme === "light");
  elements.themeLinks.forEach((link) => {
    link.classList.toggle("active", link.dataset.theme === theme);
  });
  localStorage.setItem(themeStorageKey, theme);
  visualizations.forEach((viz) => viz.refresh());
}

export function applyStoredTheme(context: AppContext) {
  const storedTheme = localStorage.getItem(themeStorageKey);
  if (storedTheme === "light" || storedTheme === "dark") {
    applyTheme(context, storedTheme);
  } else {
    applyTheme(context, "dark");
  }
}
