import { JukeboxEngine } from "../engine";
import { BufferedAudioPlayer } from "../audio/BufferedAudioPlayer";
import type { Edge } from "../engine/types";
import { getElements } from "./elements";
import { attachVisualizationResize, createVisualizations } from "./visualization";
import { applyTheme, applyThemeVariables, resolveStoredTheme } from "./theme";
import { setAnalysisStatus, setLoadingProgress, isEditableTarget, showToast } from "./ui";
import { navigateToTab, setActiveTab, updateTrackUrl } from "./tabs";
import { handleRouteChange } from "./routing";
import { fetchTopSongs } from "./api";
import {
  applyAnalysisResult,
  applyTuningChanges,
  closeInfo,
  closeTuning,
  loadAudioFromJob,
  loadTrackByYouTubeId,
  openInfo,
  openTuning,
  pollAnalysis,
  releaseWakeLock,
  requestWakeLock,
  resetForNewTrack,
  stopPlayback,
  togglePlayback,
  updateTrackInfo,
  updateVizVisibility,
} from "./playback";
import { runSearch } from "./search";
import { TOP_SONGS_LIMIT } from "./constants";
import type { AppContext, AppState, TabId } from "./context";
import {
  addFavorite,
  isFavorite,
  loadFavorites,
  maxFavorites,
  removeFavorite,
  saveFavorites,
  type FavoriteTrack,
} from "./favorites";

const vizStorageKey = "fj-viz";

type PlaybackDeps = Parameters<typeof pollAnalysis>[1];

type SearchDeps = Parameters<typeof runSearch>[1];

export function bootstrap() {
  const elements = getElements();
  const initialTheme = resolveStoredTheme();
  applyThemeVariables(initialTheme);
  document.body.classList.toggle("theme-light", initialTheme === "light");
  elements.themeLinks.forEach((link) => {
    link.classList.toggle("active", link.dataset.theme === initialTheme);
  });
  const player = new BufferedAudioPlayer();
  const engine = new JukeboxEngine(player, { randomMode: "random" });
  const visualizations = createVisualizations(elements.vizLayer);
  const defaultConfig = engine.getConfig();
  const state: AppState = {
    activeTabId: "top",
    activeVizIndex: 0,
    topSongsTab: "top",
    favorites: loadFavorites(),
    playTimerMs: 0,
    lastPlayStamp: null,
    lastBeatIndex: null,
    vizData: null,
    isRunning: false,
    audioLoaded: false,
    analysisLoaded: false,
    audioLoadInFlight: false,
    autoComputedThreshold: null,
    lastJobId: null,
    lastYouTubeId: null,
    lastPlayCountedJobId: null,
    shiftBranching: false,
    selectedEdge: null,
    topSongsRefreshTimer: null,
    trackDurationSec: null,
    trackTitle: null,
    trackArtist: null,
    toastTimer: null,
    pollController: null,
    listenTimerId: null,
    wakeLock: null,
  };
  const context: AppContext = {
    elements,
    engine,
    player,
    visualizations,
    defaultConfig,
    state,
  };

  const playbackDeps = createPlaybackDeps();
  const searchDeps = createSearchDeps();

  visualizations.forEach((viz, index) => viz.setVisible(index === 0));
  elements.vizButtons.forEach((button) => {
    button.disabled = true;
  });
  attachVisualizationResize(visualizations, elements.vizPanel);

  const storedViz = localStorage.getItem(vizStorageKey);
  if (storedViz) {
    const parsed = Number.parseInt(storedViz, 10);
    if (Number.isFinite(parsed)) {
      setActiveVisualization(parsed);
    }
  }

  player.setOnEnded(() => {
    if (state.isRunning) {
      stopPlayback(context);
    }
  });

  engine.onUpdate((engineState) => {
    elements.beatsPlayedEl.textContent = `${engineState.beatsPlayed}`;
    if (engineState.currentBeatIndex >= 0) {
      const jumpFrom =
        engineState.lastJumped && engineState.lastJumpFromIndex !== null
          ? engineState.lastJumpFromIndex
          : state.lastBeatIndex;
      visualizations[state.activeVizIndex]?.update(
        engineState.currentBeatIndex,
        engineState.lastJumped,
        jumpFrom
      );
      state.lastBeatIndex = engineState.currentBeatIndex;
    }
  });

  setActiveTabWithRefresh("top");
  elements.playTabButton.disabled = true;
  setAnalysisStatus(context, "Select a track to begin.", false);
  applyTheme(context, initialTheme);
  renderFavoritesList();
  setTopSongsTab("top");

  resetForNewTrack(context);
  syncFavoriteButton();

  handleRouteChange(context, playbackDeps, window.location.pathname).catch((err) => {
    console.warn(`Route load failed: ${String(err)}`);
  });

  window.addEventListener("popstate", handlePopState);
  wireUiHandlers();

  function createPlaybackDeps(): PlaybackDeps {
    return {
      setActiveTab: (tabId: TabId) => setActiveTabWithRefresh(tabId),
      navigateToTab: (
        tabId: TabId,
        options?: { replace?: boolean; youtubeId?: string | null }
      ) => navigateToTabWithState(tabId, options),
      updateTrackUrl: (youtubeId: string, replace?: boolean) =>
        updateTrackUrl(youtubeId, replace),
      setAnalysisStatus: (message: string, spinning: boolean) =>
        setAnalysisStatus(context, message, spinning),
      setLoadingProgress: (progress: number | null, message?: string | null) =>
        setLoadingProgress(context, progress, message),
      onTrackChange: () => syncFavoriteButton(),
    };
  }

  function createSearchDeps(): SearchDeps {
    return {
      setActiveTab: (tabId: TabId) => setActiveTabWithRefresh(tabId),
      navigateToTab: (
        tabId: TabId,
        options?: { replace?: boolean; youtubeId?: string | null }
      ) => navigateToTabWithState(tabId, options),
      updateTrackUrl: (youtubeId: string, replace?: boolean) =>
        updateTrackUrl(youtubeId, replace),
      setAnalysisStatus: (message: string, spinning: boolean) =>
        setAnalysisStatus(context, message, spinning),
      setLoadingProgress: (progress: number | null, message?: string | null) =>
        setLoadingProgress(context, progress, message),
      pollAnalysis: (jobId: string) => pollAnalysis(context, playbackDeps, jobId),
      applyAnalysisResult: (response) => applyAnalysisResult(context, response),
      loadAudioFromJob: (jobId: string) => loadAudioFromJob(context, jobId),
      resetForNewTrack: () => resetForNewTrack(context),
      updateVizVisibility: () => updateVizVisibility(context),
      onTrackChange: () => syncFavoriteButton(),
    };
  }

  function handlePopState() {
    handleRouteChange(context, playbackDeps, window.location.pathname).catch(
      (err) => {
        console.warn(`Route load failed: ${String(err)}`);
      }
    );
  }

  function wireUiHandlers() {
    elements.tabButtons.forEach((button) => {
      button.addEventListener("click", handleTabClick);
    });
    elements.topSongsTabs.forEach((button) => {
      button.addEventListener("click", handleTopSongsTabClick);
    });
    elements.searchButton.addEventListener("click", handleSearchClick);
    elements.searchInput.addEventListener("keydown", handleSearchKeydown);
    elements.thresholdInput.addEventListener("input", handleThresholdInput);
    elements.minProbInput.addEventListener("input", handleMinProbInput);
    elements.maxProbInput.addEventListener("input", handleMaxProbInput);
    elements.rampInput.addEventListener("input", handleRampInput);
    elements.tuningButton.addEventListener("click", handleOpenTuning);
    elements.infoButton.addEventListener("click", handleOpenInfo);
    elements.favoriteButton.addEventListener("click", handleFavoriteToggle);
    elements.fullscreenButton.addEventListener("click", handleFullscreenToggle);
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    elements.tuningClose.addEventListener("click", handleCloseTuning);
    elements.infoClose.addEventListener("click", handleCloseInfo);
    elements.tuningModal.addEventListener("click", handleTuningModalClick);
    elements.infoModal.addEventListener("click", handleInfoModalClick);
    elements.tuningApply.addEventListener("click", handleTuningApply);
    elements.playButton.addEventListener("click", handlePlayClick);
    elements.shortUrlButton.addEventListener("click", handleShortUrlClick);
    syncInfoButton();
    syncTuneButton();
    syncCopyButton();
    updateFullscreenButton(Boolean(document.fullscreenElement));
    elements.vizButtons.forEach((button) => {
      button.addEventListener("click", handleVizButtonClick);
    });
    elements.themeLinks.forEach((link) => {
      link.addEventListener("click", handleThemeClick);
    });
    window.addEventListener("keydown", handleKeydown);
    window.addEventListener("keyup", handleKeyup);

    visualizations.forEach((viz) => {
      viz.setOnSelect(handleBeatSelect);
      viz.setOnEdgeSelect(handleEdgeSelect);
    });
  }

  function setTopSongsTab(tabId: "top" | "favorites") {
    state.topSongsTab = tabId;
    elements.topSongsTabs.forEach((button) => {
      button.classList.toggle("active", button.dataset.topSubtab === tabId);
    });
    elements.topSongsList.classList.toggle("hidden", tabId !== "top");
    elements.favoritesList.classList.toggle("hidden", tabId !== "favorites");
    elements.topListTitle.textContent = tabId === "top" ? "Top 20" : "Favorites";
    if (tabId === "top") {
      fetchTopSongsList().catch((err) => {
        console.warn(`Top songs load failed: ${String(err)}`);
      });
    }
  }

  function updateFavorites(nextFavorites: FavoriteTrack[]) {
    state.favorites = nextFavorites;
    saveFavorites(nextFavorites);
    renderFavoritesList();
    syncFavoriteButton();
  }

  function renderFavoritesList() {
    elements.favoritesList.innerHTML = "";
    if (state.favorites.length === 0) {
      elements.favoritesList.textContent = "No favorites yet.";
      return;
    }
    for (const item of state.favorites) {
      const li = document.createElement("li");
      const row = document.createElement("div");
      row.className = "favorite-row";
      const link = document.createElement("a");
      link.href = `/listen/${encodeURIComponent(item.uniqueSongId)}`;
      link.textContent = `${item.title || "Untitled"} — ${item.artist || "Unknown"}`;
      link.dataset.youtubeId = item.uniqueSongId;
      link.addEventListener("click", handleFavoriteClick);
      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "favorite-remove";
      removeButton.innerHTML =
        '<span class="material-symbols-outlined favorite-remove-icon" aria-hidden="true">close</span>';
      removeButton.dataset.favoriteId = item.uniqueSongId;
      removeButton.addEventListener("click", handleFavoriteRemove);
      row.append(link, removeButton);
      li.append(row);
      elements.favoritesList.appendChild(li);
    }
  }

  function syncFavoriteButton() {
    const currentId = state.lastYouTubeId;
    const active = currentId ? isFavorite(state.favorites, currentId) : false;
    elements.favoriteButton.classList.toggle("active", active);
    const label = active ? "Remove from Favorites" : "Add to Favorites";
    elements.favoriteButton.setAttribute("aria-label", label);
    elements.favoriteButton.title = label;
  }

  function handleTopSongsTabClick(event: Event) {
    const button = event.currentTarget as HTMLButtonElement | null;
    const tabId = button?.dataset.topSubtab as "top" | "favorites" | undefined;
    if (!tabId) {
      return;
    }
    setTopSongsTab(tabId);
  }

  function handleFavoriteClick(event: Event) {
    event.preventDefault();
    const target = event.currentTarget as HTMLAnchorElement | null;
    const youtubeId = target?.dataset.youtubeId;
    if (!youtubeId) {
      return;
    }
    navigateToTabWithState("play", { youtubeId });
    loadTrackByYouTubeId(context, playbackDeps, youtubeId);
  }

  function handleFavoriteRemove(event: Event) {
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget as HTMLButtonElement | null;
    const favoriteId = target?.dataset.favoriteId;
    if (!favoriteId) {
      return;
    }
    updateFavorites(removeFavorite(state.favorites, favoriteId));
  }

  function handleFavoriteToggle() {
    const currentId = state.lastYouTubeId;
    if (!currentId) {
      return;
    }
    if (isFavorite(state.favorites, currentId)) {
      updateFavorites(removeFavorite(state.favorites, currentId));
      showToast(context, "Removed from Favorites");
      return;
    }
    const title = state.trackTitle || "Untitled";
    const artist = state.trackArtist || "Unknown";
    const track: FavoriteTrack = {
      uniqueSongId: currentId,
      title,
      artist,
      duration: state.trackDurationSec,
      artworkUrl: null,
      sourceType: "youtube",
    };
    const result = addFavorite(state.favorites, track);
    if (result.status === "limit") {
      showToast(context, `Maximum favorites reached (${maxFavorites()}).`);
      return;
    }
    updateFavorites(result.favorites);
    if (result.status === "added") {
      showToast(context, "Added to Favorites");
    } else {
      showToast(context, "Favorited");
    }
  }

  function handleTabClick(event: Event) {
    const button = event.currentTarget as HTMLButtonElement | null;
    const tabId = button?.dataset.tabButton as TabId | undefined;
    if (!tabId) {
      return;
    }
    if (tabId === "play" && !state.lastYouTubeId) {
      return;
    }
    navigateToTabWithState(tabId);
  }

  function handleSearchClick() {
    void runSearch(context, searchDeps);
  }

  function handleSearchKeydown(event: KeyboardEvent) {
    if (event.key === "Enter") {
      event.preventDefault();
      void runSearch(context, searchDeps);
    }
  }

  function handleThresholdInput() {
    elements.thresholdVal.textContent = elements.thresholdInput.value;
  }

  function handleMinProbInput() {
    elements.minProbVal.textContent = `${elements.minProbInput.value}%`;
  }

  function handleMaxProbInput() {
    elements.maxProbVal.textContent = `${elements.maxProbInput.value}%`;
  }

  function handleRampInput() {
    elements.rampVal.textContent = `${elements.rampInput.value}%`;
  }

  function handleOpenTuning() {
    openTuning(context);
  }

  function handleOpenInfo() {
    openInfo(context);
  }

  function handleFullscreenToggle() {
    if (!document.fullscreenElement) {
      elements.vizPanel
        .requestFullscreen()
        .then(() => {
          requestWakeLock(context);
        })
        .catch(() => {
          console.warn("Failed to enter fullscreen");
        });
    } else {
      document
        .exitFullscreen()
        .then(() => {
          releaseWakeLock(context);
        })
        .catch(() => {
          console.warn("Failed to exit fullscreen");
        });
    }
  }

  function handleFullscreenChange() {
    if (document.fullscreenElement) {
      updateFullscreenButton(true);
      requestWakeLock(context);
    } else {
      updateFullscreenButton(false);
      releaseWakeLock(context);
    }
    visualizations[state.activeVizIndex]?.resizeNow();
  }

  function updateFullscreenButton(isFullscreen: boolean) {
    const label = isFullscreen ? "Exit Fullscreen" : "Fullscreen";
    const icon = elements.fullscreenButton.querySelector<HTMLSpanElement>(".fullscreen-icon");
    if (icon) {
      icon.textContent = isFullscreen ? "fullscreen_exit" : "fullscreen";
    }
    elements.fullscreenButton.title = label;
    elements.fullscreenButton.setAttribute("aria-label", label);
  }

  function handleVisibilityChange() {
    if (!document.hidden && document.fullscreenElement) {
      requestWakeLock(context);
    } else if (document.hidden) {
      releaseWakeLock(context);
    }
  }

  function handleCloseTuning() {
    closeTuning(context);
  }

  function handleCloseInfo() {
    closeInfo(context);
  }

  function syncInfoButton() {
    elements.infoButton.title = "Info";
    elements.infoButton.setAttribute("aria-label", "Info");
  }

  function syncTuneButton() {
    elements.tuningButton.title = "Tune";
    elements.tuningButton.setAttribute("aria-label", "Tune");
  }

  function syncCopyButton() {
    elements.shortUrlButton.title = "Copy URL";
    elements.shortUrlButton.setAttribute("aria-label", "Copy URL");
  }

  function handleTuningModalClick(event: MouseEvent) {
    if (event.target === elements.tuningModal) {
      closeTuning(context);
    }
  }

  function handleInfoModalClick(event: MouseEvent) {
    if (event.target === elements.infoModal) {
      closeInfo(context);
    }
  }

  function handleTuningApply() {
    applyTuningChanges(context);
  }

  function handlePlayClick() {
    togglePlayback(context);
  }

  function handleShortUrlClick() {
    void copyShortUrl();
  }

  function handleVizButtonClick(event: Event) {
    const button = event.currentTarget as HTMLButtonElement | null;
    const idx = Number(button?.dataset.viz);
    if (!Number.isFinite(idx)) {
      return;
    }
    setActiveVisualization(idx);
  }

  function handleThemeClick(event: Event) {
    const link = event.currentTarget as HTMLButtonElement | null;
    const value = link?.dataset.theme === "light" ? "light" : "dark";
    applyTheme(context, value);
  }

  function handleKeydown(event: KeyboardEvent) {
    if (state.activeTabId !== "play") {
      return;
    }
    if (isEditableTarget(event.target)) {
      return;
    }
    if (event.code === "Space") {
      event.preventDefault();
      togglePlayback(context);
      return;
    }
    if (
      (event.key === "Delete" || event.key === "Backspace") &&
      state.selectedEdge &&
      !state.selectedEdge.deleted
    ) {
      event.preventDefault();
      engine.deleteEdge(state.selectedEdge);
      engine.rebuildGraph();
      state.vizData = engine.getVisualizationData();
      const data = state.vizData;
      if (data) {
        visualizations.forEach((viz) => viz.setData(data));
      }
      visualizations.forEach((viz) => viz.refresh());
      visualizations[state.activeVizIndex]?.resizeNow();
      updateTrackInfo(context);
      state.selectedEdge = null;
      visualizations.forEach((viz) => viz.setSelectedEdge(null));
      return;
    }
    if (event.key === "Shift" && state.isRunning && !state.shiftBranching) {
      state.shiftBranching = true;
      engine.setForceBranch(true);
    }
  }

  function handleKeyup(event: KeyboardEvent) {
    if (event.key === "Shift" && state.shiftBranching) {
      state.shiftBranching = false;
      engine.setForceBranch(false);
    }
  }

  function handleBeatSelect(index: number) {
    if (!state.vizData) {
      return;
    }
    const beat = state.vizData.beats[index];
    if (!beat) {
      return;
    }
    player.seek(beat.start);
    state.lastBeatIndex = index;
    visualizations[state.activeVizIndex]?.update(index, true, null);
  }

  function handleEdgeSelect(edge: Edge | null) {
    state.selectedEdge = edge;
    visualizations[state.activeVizIndex]?.setSelectedEdge(edge);
  }

  function navigateToTabWithState(
    tabId: TabId,
    options?: { replace?: boolean; youtubeId?: string | null }
  ) {
    setActiveTabWithRefresh(tabId);
    navigateToTab(tabId, options, state.lastYouTubeId);
  }

  function setActiveTabWithRefresh(tabId: TabId) {
    setActiveTab(context, tabId, () => {
      fetchTopSongsList().catch((err) => {
        console.warn(`Top songs load failed: ${String(err)}`);
      });
    });
  }

  async function fetchTopSongsList() {
    elements.topSongsList.textContent = "Loading top songs…";
    try {
      const items = await fetchTopSongs(TOP_SONGS_LIMIT);
      if (items.length === 0) {
        elements.topSongsList.textContent = "No plays recorded yet.";
        return;
      }
      elements.topSongsList.innerHTML = "";
      for (const item of items.slice(0, TOP_SONGS_LIMIT)) {
        const title = typeof item.title === "string" ? item.title : "Untitled";
        const artist = typeof item.artist === "string" ? item.artist : "Unknown";
        const youtubeId =
          typeof item.youtube_id === "string" ? item.youtube_id : "";
        const li = document.createElement("li");
        if (youtubeId) {
          const link = document.createElement("a");
          link.href = `/listen/${encodeURIComponent(youtubeId)}`;
          link.textContent = `${title} — ${artist}`;
          link.dataset.youtubeId = youtubeId;
          link.addEventListener("click", handleTopSongClick);
          li.appendChild(link);
        } else {
          li.textContent = `${title} — ${artist}`;
        }
        elements.topSongsList.appendChild(li);
      }
    } catch (err) {
      elements.topSongsList.textContent = `Top songs unavailable: ${String(err)}`;
    }
  }

  function handleTopSongClick(event: Event) {
    event.preventDefault();
    const target = event.currentTarget as HTMLAnchorElement | null;
    const youtubeId = target?.dataset.youtubeId;
    if (!youtubeId) {
      return;
    }
    navigateToTabWithState("play", { youtubeId });
    loadTrackByYouTubeId(context, playbackDeps, youtubeId);
  }

  async function copyShortUrl() {
    if (!state.lastYouTubeId) {
      setAnalysisStatus(context, "Select a track to generate a short URL.", false);
      navigateToTabWithState("search");
      return;
    }
    const shortUrl = `${window.location.origin}/listen/${encodeURIComponent(
      state.lastYouTubeId
    )}`;
    try {
      await navigator.clipboard.writeText(shortUrl);
      showToast(context, "Link copied to clipboard");
    } catch (err) {
      setAnalysisStatus(context, `Copy failed: ${String(err)}`, false);
    }
  }

  function setActiveVisualization(index: number) {
    if (index === state.activeVizIndex || index < 0 || index >= visualizations.length) {
      return;
    }
    visualizations[state.activeVizIndex]?.setVisible(false);
    state.activeVizIndex = index;
    visualizations[state.activeVizIndex]?.setVisible(true);
    visualizations[state.activeVizIndex]?.resizeNow();
    if (state.vizData) {
      visualizations[state.activeVizIndex]?.setData(state.vizData);
    }
    visualizations[state.activeVizIndex]?.setSelectedEdge(
      state.selectedEdge && !state.selectedEdge.deleted ? state.selectedEdge : null
    );
    if (state.lastBeatIndex !== null) {
      visualizations[state.activeVizIndex]?.update(state.lastBeatIndex, false, null);
    }
    elements.vizButtons.forEach((button) => {
      button.classList.toggle("active", Number(button.dataset.viz) === state.activeVizIndex);
    });
    localStorage.setItem(vizStorageKey, String(state.activeVizIndex));
  }
}
