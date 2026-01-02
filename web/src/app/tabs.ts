import type { AppContext, TabId } from "./context";
import { TOP_SONGS_REFRESH_MS } from "./constants";

export function pathForTab(tabId: TabId, youtubeId?: string | null) {
  if (tabId === "search") {
    return "/search";
  }
  if (tabId === "play") {
    if (youtubeId) {
      return `/listen/${encodeURIComponent(youtubeId)}`;
    }
    return "/listen";
  }
  return "/";
}

export function setActiveTab(
  context: AppContext,
  tabId: TabId,
  onTopRefresh: () => void
) {
  const { elements, visualizations, engine, state } = context;
  state.activeTabId = tabId;
  elements.tabPanels.forEach((panel) => {
    panel.classList.toggle("hidden", panel.dataset.tabPanel !== tabId);
  });
  elements.tabButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.tabButton === tabId);
  });
  if (tabId === "play") {
    visualizations[state.activeVizIndex]?.resizeNow();
  } else if (tabId === "top") {
    if (state.topSongsRefreshTimer !== null) {
      window.clearTimeout(state.topSongsRefreshTimer);
    }
    state.topSongsRefreshTimer = window.setTimeout(() => {
      state.topSongsRefreshTimer = null;
      onTopRefresh();
    }, TOP_SONGS_REFRESH_MS);
  } else if (state.shiftBranching) {
    state.shiftBranching = false;
    engine.setForceBranch(false);
  }
  if (tabId !== "play" && state.selectedEdge) {
    state.selectedEdge = null;
    visualizations.forEach((viz) => viz.setSelectedEdge(null));
  }
}

export function navigateToTab(
  tabId: TabId,
  options?: { replace?: boolean; youtubeId?: string | null },
  lastYouTubeId?: string | null
) {
  const path = pathForTab(tabId, options?.youtubeId ?? lastYouTubeId);
  const url = new URL(window.location.href);
  url.pathname = path;
  url.search = "";
  if (options?.replace) {
    window.history.replaceState({}, "", url.toString());
  } else {
    window.history.pushState({}, "", url.toString());
  }
}

export function updateTrackUrl(youtubeId: string, replace = false) {
  const url = new URL(window.location.href);
  url.pathname = pathForTab("play", youtubeId);
  url.search = "";
  if (replace) {
    window.history.replaceState({}, "", url.toString());
  } else {
    window.history.pushState({}, "", url.toString());
  }
}
