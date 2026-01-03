import type { AppContext } from "./context";
import { themeConfig, type ThemeName } from "./themeConfig";

const themeStorageKey = "fj-theme";

function applyThemeVariables(theme: ThemeName) {
  const themeVars = themeConfig[theme];
  const rootStyle = document.documentElement.style;
  Object.entries(themeVars).forEach(([key, value]) => {
    rootStyle.setProperty(key, value);
  });
}

export function applyTheme(context: AppContext, theme: ThemeName) {
  const { elements, visualizations } = context;
  applyThemeVariables(theme);
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
