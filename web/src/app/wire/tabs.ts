import type { AppState, TabId } from "../context";
import { TOP_SONGS_LIMIT } from "../constants";
import type { Elements } from "../elements";
import type { FavoritesHandlers } from "./favorites";

type TabsDeps = {
  elements: Elements;
  state: AppState;
  favoritesHandlers: FavoritesHandlers;
  navigateToTabWithState: (
    tabId: TabId,
    options?: { replace?: boolean; youtubeId?: string | null },
  ) => void;
  onFaqOpen?: () => void;
};

export type TabsHandlers = ReturnType<typeof createTabsHandlers>;

export function createTabsHandlers(deps: TabsDeps) {
  const {
    elements,
    state,
    favoritesHandlers,
    navigateToTabWithState,
    onFaqOpen,
  } = deps;

  function setTopSongsTab(tabId: "top" | "favorites") {
    state.topSongsTab = tabId;
    elements.topSongsTabs.forEach((button) => {
      button.classList.toggle("active", button.dataset.topSubtab === tabId);
    });
    elements.topSongsList.classList.toggle("hidden", tabId !== "top");
    elements.favoritesList.classList.toggle("hidden", tabId !== "favorites");
    elements.topListTitle.textContent =
      tabId === "top" ? `Top ${TOP_SONGS_LIMIT}` : "Favorites";
    favoritesHandlers.closeFavoritesSyncMenu();
    favoritesHandlers.updateFavoritesSyncControls();
  }

  function setSearchTab(tabId: "spotify" | "youtube" | "upload") {
    state.searchTab = tabId;
    elements.searchSubtabButtons.forEach((button) => {
      button.classList.toggle("active", button.dataset.searchSubtab === tabId);
    });

    const isSearch = tabId === "spotify" || tabId === "youtube";
    elements.searchPanel.classList.toggle("hidden", !isSearch);
    elements.uploadPanel.classList.toggle("hidden", tabId !== "upload");

    if (tabId === "spotify") {
      elements.searchPanelTitle.textContent = "Spotify Search";
      elements.searchHint.textContent = "Step 1: Find a Spotify track.";
      elements.searchInput.placeholder = "Search Spotify by artist or track";
    } else if (tabId === "youtube") {
      elements.searchPanelTitle.textContent = "YouTube Search";
      elements.searchHint.textContent = "Search YouTube by artist or track name.";
      elements.searchInput.placeholder = "Search YouTube by artist or track";
    } else {
      elements.searchPanelTitle.textContent = "Upload";
    }
  }

  function handleTopSongsTabClick(event: Event) {
    const button = event.currentTarget as HTMLButtonElement | null;
    const tabId = button?.dataset.topSubtab as "top" | "favorites" | undefined;
    if (!tabId) {
      return;
    }
    setTopSongsTab(tabId);
  }

  function handleSearchSubtabClick(event: Event) {
    const button = event.currentTarget as HTMLButtonElement | null;
    const tabId = button?.dataset.searchSubtab as
      | "spotify"
      | "youtube"
      | "upload"
      | undefined;
    if (!tabId) {
      return;
    }
    setSearchTab(tabId);
  }

  function handleTabClick(event: Event) {
    const button = event.currentTarget as HTMLButtonElement | null;
    const tabId = button?.dataset.tabButton as TabId | undefined;
    if (!tabId) {
      return;
    }
    if (tabId === "top") {
      setTopSongsTab("top");
    }
    if (tabId === "search") {
      setSearchTab("spotify");
    }
    if (tabId === "play" && !state.lastYouTubeId && !state.lastJobId) {
      return;
    }
    navigateToTabWithState(tabId);
    if (tabId === "faq") {
      onFaqOpen?.();
    }
  }

  return {
    setTopSongsTab,
    handleTopSongsTabClick,
    setSearchTab,
    handleSearchSubtabClick,
    handleTabClick,
  };
}
