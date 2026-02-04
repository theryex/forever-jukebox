import type { AppContext } from "../context";
import type { Elements } from "../elements";

type ThemeDeps = {
  context: AppContext;
  elements: Elements;
  applyTheme: (context: AppContext, value: "light" | "dark") => void;
};

export type ThemeHandlers = ReturnType<typeof createThemeHandlers>;

export function createThemeHandlers(deps: ThemeDeps) {
  const { context, elements, applyTheme } = deps;

  function handleThemeClick(event: Event) {
    const link = event.currentTarget as HTMLButtonElement | null;
    const value = link?.dataset.theme === "light" ? "light" : "dark";
    applyTheme(context, value);
  }

  function bindThemeLinks() {
    elements.themeLinks.forEach((link) => {
      link.addEventListener("click", handleThemeClick);
    });
  }

  return { handleThemeClick, bindThemeLinks };
}
