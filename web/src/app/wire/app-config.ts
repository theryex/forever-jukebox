import type { AppConfig } from "../api";
import type { AppState } from "../context";
import type { Elements } from "../elements";
import type { FavoritesHandlers } from "./favorites";
import type { TabsHandlers } from "./tabs";

type AppConfigDeps = {
  elements: Elements;
  state: AppState;
  favoritesHandlers: FavoritesHandlers;
  tabsHandlers: Pick<TabsHandlers, "setSearchTab">;
};

export type AppConfigHandlers = ReturnType<typeof createAppConfigHandlers>;

export function createAppConfigHandlers(deps: AppConfigDeps) {
  const { elements, state, favoritesHandlers, tabsHandlers } = deps;

  function applyAppConfig(config: AppConfig) {
    state.appConfig = config;
    // Always show subtabs and upload sections — validation is server-side
    elements.searchSubtabs.classList.remove("hidden");
    elements.uploadFileSection.classList.remove("hidden");
    elements.uploadYoutubeSection.classList.remove("hidden");
    const allowUpload = Boolean(config.allow_user_upload);
    if (allowUpload) {
      const extList = (config.allowed_upload_exts || []).join(", ");
      const maxSize = config.max_upload_size
        ? `${Math.round(config.max_upload_size / (1024 * 1024))} MB`
        : "unknown";
      elements.uploadFileHint.textContent = `Max file size: ${maxSize}. Allowed: ${extList}`;
      elements.uploadFileInput.accept = (config.allowed_upload_exts || []).join(
        ",",
      );
    }
    tabsHandlers.setSearchTab(state.searchTab);
    favoritesHandlers.updateFavoritesSyncControls();
    if (config.allow_favorites_sync) {
      favoritesHandlers.hydrateFavoritesFromSync();
    }
  }

  return { applyAppConfig };
}
