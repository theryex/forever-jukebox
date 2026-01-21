import { JukeboxEngine } from "../engine";
import { BufferedAudioPlayer } from "../audio/BufferedAudioPlayer";
import type { Edge } from "../engine/types";
import { getElements } from "./elements";
import {
  attachVisualizationResize,
  createVisualizations,
} from "./visualization";
import { applyTheme, applyThemeVariables, resolveStoredTheme } from "./theme";
import {
  setAnalysisStatus,
  setLoadingProgress,
  isEditableTarget,
  showToast,
} from "./ui";
import { navigateToTab, setActiveTab, updateTrackUrl } from "./tabs";
import { handleRouteChange } from "./routing";
import {
  deleteJob,
  fetchAppConfig,
  fetchFavoritesSync,
  fetchTopSongs,
  createFavoritesSync,
  updateFavoritesSync,
  startYoutubeAnalysis,
  uploadAudio,
  type AnalysisComplete,
} from "./api";
import { deleteCachedTrack, loadAppConfig, saveAppConfig } from "./cache";
import {
  applyAnalysisResult,
  applyTuningChanges,
  closeInfo,
  closeTuning,
  loadAudioFromJob,
  loadTrackByJobId,
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
import type { AppConfig } from "./api";
import {
  addFavorite,
  isFavorite,
  loadFavorites,
  loadFavoritesSyncCode,
  maxFavorites,
  removeFavorite,
  saveFavoritesSyncCode,
  saveFavorites,
  sortFavorites,
  type FavoriteTrack,
} from "./favorites";

const vizStorageKey = "fj-viz";

type PlaybackDeps = Parameters<typeof pollAnalysis>[1];

type SearchDeps = Parameters<typeof runSearch>[1];

type FavoritesDelta = {
  added: FavoriteTrack[];
  removedIds: Set<string>;
};

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
    favoritesSyncCode: loadFavoritesSyncCode(),
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
    deleteEligible: false,
    deleteEligibilityJobId: null,
    searchTab: "search",
    appConfig: null,
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
  let syncUpdateInFlight = false;
  let pendingSyncDelta: FavoritesDelta | null = null;

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
        jumpFrom,
      );
      state.lastBeatIndex = engineState.currentBeatIndex;
    }
  });

  setActiveTabWithRefresh("top");
  elements.playTabButton.disabled = true;
  setAnalysisStatus(context, "Select a track to begin.", false);
  applyTheme(context, initialTheme);
  fetchTopSongsList().catch((err) => {
    console.warn(`Top songs load failed: ${String(err)}`);
  });
  loadAppConfig()
    .then((config) => {
      if (config) {
        applyAppConfig(config as AppConfig);
      }
    })
    .catch((err) => {
      console.warn(`App config load failed: ${String(err)}`);
    });
  fetchAppConfig()
    .then((config) => {
      applyAppConfig(config);
      return saveAppConfig(config);
    })
    .catch((err) => {
      console.warn(`App config fetch failed: ${String(err)}`);
    });
  renderFavoritesList();
  setTopSongsTab("top");
  updateFavoritesSyncControls();

  resetForNewTrack(context);
  syncFavoriteButton();

  handleRouteChange(context, playbackDeps, window.location.pathname).catch(
    (err) => {
      console.warn(`Route load failed: ${String(err)}`);
    },
  );

  window.addEventListener("popstate", handlePopState);
  wireUiHandlers();

  function createPlaybackDeps(): PlaybackDeps {
    return {
      setActiveTab: (tabId: TabId) => setActiveTabWithRefresh(tabId),
      navigateToTab: (
        tabId: TabId,
        options?: { replace?: boolean; youtubeId?: string | null },
      ) => navigateToTabWithState(tabId, options),
      updateTrackUrl: (youtubeId: string, replace?: boolean) =>
        updateTrackUrl(youtubeId, replace),
      setAnalysisStatus: (message: string, spinning: boolean) =>
        setAnalysisStatus(context, message, spinning),
      setLoadingProgress: (progress: number | null, message?: string | null) =>
        setLoadingProgress(context, progress, message),
      onTrackChange: () => syncFavoriteButton(),
      onAnalysisLoaded: (response) => maybeAutoFavoriteUserSupplied(response),
    };
  }

  function createSearchDeps(): SearchDeps {
    return {
      setActiveTab: (tabId: TabId) => setActiveTabWithRefresh(tabId),
      navigateToTab: (
        tabId: TabId,
        options?: { replace?: boolean; youtubeId?: string | null },
      ) => navigateToTabWithState(tabId, options),
      updateTrackUrl: (youtubeId: string, replace?: boolean) =>
        updateTrackUrl(youtubeId, replace),
      setAnalysisStatus: (message: string, spinning: boolean) =>
        setAnalysisStatus(context, message, spinning),
      setLoadingProgress: (progress: number | null, message?: string | null) =>
        setLoadingProgress(context, progress, message),
      pollAnalysis: (jobId: string) =>
        pollAnalysis(context, playbackDeps, jobId),
      applyAnalysisResult: (response) =>
        applyAnalysisResult(context, response, maybeAutoFavoriteUserSupplied),
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
      },
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
    elements.searchSubtabButtons.forEach((button) => {
      button.addEventListener("click", handleSearchSubtabClick);
    });
    elements.favoritesSyncButton.addEventListener(
      "click",
      handleFavoritesSyncToggle,
    );
    elements.favoritesSyncItems.forEach((button) => {
      button.addEventListener("click", handleFavoritesSyncItem);
    });
    elements.favoritesSyncEnterClose.addEventListener(
      "click",
      handleFavoritesSyncEnterClose,
    );
    elements.favoritesSyncCreateClose.addEventListener(
      "click",
      handleFavoritesSyncCreateClose,
    );
    elements.favoritesSyncEnterButton.addEventListener(
      "click",
      handleFavoritesSyncEnterSubmit,
    );
    elements.favoritesSyncCreateButton.addEventListener(
      "click",
      handleFavoritesSyncCreateSubmit,
    );
    elements.favoritesSyncEnterInput.addEventListener(
      "keydown",
      handleFavoritesSyncEnterKeydown,
    );
    elements.uploadFileButton.addEventListener("click", handleUploadFileClick);
    elements.uploadYoutubeButton.addEventListener(
      "click",
      handleUploadYoutubeClick,
    );
    elements.thresholdInput.addEventListener("input", handleThresholdInput);
    elements.minProbInput.addEventListener("input", handleMinProbInput);
    elements.maxProbInput.addEventListener("input", handleMaxProbInput);
    elements.rampInput.addEventListener("input", handleRampInput);
    elements.tuningButton.addEventListener("click", handleOpenTuning);
    elements.infoButton.addEventListener("click", handleOpenInfo);
    elements.favoriteButton.addEventListener("click", handleFavoriteToggle);
    elements.deleteButton.addEventListener("click", handleDeleteJobClick);
    elements.fullscreenButton.addEventListener("click", handleFullscreenToggle);
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    elements.tuningClose.addEventListener("click", handleCloseTuning);
    elements.infoClose.addEventListener("click", handleCloseInfo);
    elements.tuningModal.addEventListener("click", handleTuningModalClick);
    elements.infoModal.addEventListener("click", handleInfoModalClick);
    elements.favoritesSyncEnterModal.addEventListener(
      "click",
      handleFavoritesSyncEnterModalClick,
    );
    elements.favoritesSyncCreateModal.addEventListener(
      "click",
      handleFavoritesSyncCreateModalClick,
    );
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
    document.addEventListener("click", handleFavoritesSyncDocumentClick);
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
    elements.topListTitle.textContent =
      tabId === "top" ? "Top 20" : "Favorites";
    closeFavoritesSyncMenu();
    updateFavoritesSyncControls();
  }

  function setSearchTab(tabId: "search" | "upload") {
    state.searchTab = tabId;
    elements.searchSubtabButtons.forEach((button) => {
      button.classList.toggle("active", button.dataset.searchSubtab === tabId);
    });
    elements.searchPanel.classList.toggle("hidden", tabId !== "search");
    elements.uploadPanel.classList.toggle("hidden", tabId !== "upload");
    elements.searchPanelTitle.textContent =
      tabId === "search" ? "Search" : "Upload";
  }

  function applyAppConfig(config: AppConfig) {
    state.appConfig = config;
    const allowUpload = Boolean(config.allow_user_upload);
    const allowYoutube = Boolean(config.allow_user_youtube);
    const showUpload = allowUpload || allowYoutube;
    elements.searchSubtabs.classList.toggle("hidden", !showUpload);
    elements.uploadFileSection.classList.toggle("hidden", !allowUpload);
    elements.uploadYoutubeSection.classList.toggle("hidden", !allowYoutube);
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
    if (!showUpload && state.searchTab === "upload") {
      setSearchTab("search");
    }
    setSearchTab(state.searchTab);
    updateFavoritesSyncControls();
    if (config.allow_favorites_sync) {
      hydrateFavoritesFromSync();
    }
  }

  function handleSearchSubtabClick(event: Event) {
    const button = event.currentTarget as HTMLButtonElement | null;
    const tabId = button?.dataset.searchSubtab as
      | "search"
      | "upload"
      | undefined;
    if (!tabId) {
      return;
    }
    setSearchTab(tabId);
  }

  function handleFavoritesSyncToggle(event: Event) {
    event.preventDefault();
    event.stopPropagation();
    toggleFavoritesSyncMenu();
  }

  function handleFavoritesSyncItem(event: Event) {
    event.preventDefault();
    closeFavoritesSyncMenu();
    const button = event.currentTarget as HTMLButtonElement | null;
    const action = button?.dataset.favoritesSync;
    if (action === "refresh") {
      void refreshFavoritesFromSync();
    } else if (action === "create") {
      openFavoritesSyncCreateModal();
    } else if (action === "enter") {
      openFavoritesSyncEnterModal();
    }
  }

  function handleFavoritesSyncDocumentClick(event: Event) {
    if (elements.favoritesSyncMenu.classList.contains("hidden")) {
      return;
    }
    const target = event.target as Node | null;
    if (!target) {
      return;
    }
    if (
      elements.favoritesSyncMenu.contains(target) ||
      elements.favoritesSyncButton.contains(target)
    ) {
      return;
    }
    closeFavoritesSyncMenu();
  }

  function toggleFavoritesSyncMenu() {
    if (elements.favoritesSyncMenu.classList.contains("hidden")) {
      openFavoritesSyncMenu();
    } else {
      closeFavoritesSyncMenu();
    }
  }

  function openFavoritesSyncMenu() {
    elements.favoritesSyncMenu.classList.remove("hidden");
    elements.favoritesSyncButton.setAttribute("aria-expanded", "true");
  }

  function closeFavoritesSyncMenu() {
    elements.favoritesSyncMenu.classList.add("hidden");
    elements.favoritesSyncButton.setAttribute("aria-expanded", "false");
  }

  function updateFavoritesSyncControls() {
    const allowSync = Boolean(state.appConfig?.allow_favorites_sync);
    const hasCode = Boolean(state.favoritesSyncCode);
    const showControls = state.topSongsTab === "favorites" && allowSync;
    elements.favoritesSyncButton.classList.toggle("hidden", !showControls);
    elements.favoritesSyncIcon.textContent = hasCode ? "cloud" : "cloud_off";
    const refreshItem = getFavoritesSyncRefreshItem();
    if (refreshItem) {
      refreshItem.classList.toggle("hidden", !hasCode || !allowSync);
    }
    const createItem = getFavoritesSyncCreateItem();
    if (createItem) {
      createItem.textContent = hasCode ? "View sync code" : "Create sync code";
    }
  }

  function getFavoritesSyncCreateItem() {
    return elements.favoritesSyncItems.find(
      (item) => item.dataset.favoritesSync === "create",
    );
  }

  function getFavoritesSyncRefreshItem() {
    return elements.favoritesSyncItems.find(
      (item) => item.dataset.favoritesSync === "refresh",
    );
  }

  function openFavoritesSyncEnterModal() {
    closeFavoritesSyncCreateModal();
    elements.favoritesSyncEnterInput.value = "";
    clearFavoritesSyncEnterStatus();
    elements.favoritesSyncEnterModal.classList.add("open");
    elements.favoritesSyncEnterInput.focus();
  }

  async function hydrateFavoritesFromSync() {
    if (!state.appConfig?.allow_favorites_sync) {
      return;
    }
    const code = state.favoritesSyncCode;
    if (!code) {
      return;
    }
    try {
      await refreshFavoritesFromSync();
    } catch (err) {
      console.warn(`Favorites sync hydrate failed: ${String(err)}`);
      showToast(context, "Favorites sync failed.");
    }
  }

  async function refreshFavoritesFromSync() {
    if (!state.appConfig?.allow_favorites_sync) {
      return;
    }
    const code = state.favoritesSyncCode;
    if (!code) {
      return;
    }
    try {
      const items = await fetchFavoritesSync(code);
      const favorites = normalizeFavoritesFromSync(items);
      updateFavorites(favorites, { sync: false });
      showToast(context, "Favorites refreshed.", { icon: "cloud_done" });
    } catch (err) {
      console.warn(`Favorites sync refresh failed: ${String(err)}`);
      showToast(context, "Favorites sync failed.");
    }
  }

  function closeFavoritesSyncEnterModal() {
    elements.favoritesSyncEnterModal.classList.remove("open");
  }

  function openFavoritesSyncCreateModal() {
    closeFavoritesSyncEnterModal();
    resetFavoritesSyncCreateModal();
    const existingCode = state.favoritesSyncCode;
    const hintText = existingCode
      ? "Enter this code on another device to sync."
      : "Create a sync code to share your favorites between devices.";
    elements.favoritesSyncCreateHint.textContent = hintText;
    if (existingCode) {
      elements.favoritesSyncCreateOutput.textContent = existingCode;
      elements.favoritesSyncCreateOutput.classList.remove("hidden");
      elements.favoritesSyncCreateButton.textContent = "Create new sync code";
    }
    elements.favoritesSyncCreateModal.classList.add("open");
  }

  function closeFavoritesSyncCreateModal() {
    elements.favoritesSyncCreateModal.classList.remove("open");
  }

  function resetFavoritesSyncCreateModal() {
    elements.favoritesSyncCreateButton.classList.remove("hidden");
    elements.favoritesSyncCreateButton.disabled = false;
    elements.favoritesSyncCreateButton.textContent = "Create sync code";
    elements.favoritesSyncCreateOutput.classList.add("hidden");
    elements.favoritesSyncCreateOutput.textContent = "";
    elements.favoritesSyncCreateHint.textContent =
      "Create a sync code to share your favorites between devices.";
    clearFavoritesSyncCreateStatus();
  }

  async function handleFavoritesSyncEnterSubmit() {
    const code = elements.favoritesSyncEnterInput.value.trim();
    if (!code) {
      setFavoritesSyncEnterStatus("Enter a sync code first.", true);
      return;
    }
    elements.favoritesSyncEnterButton.disabled = true;
    elements.favoritesSyncEnterButton.textContent = "Syncing...";
    setFavoritesSyncEnterStatus("Syncing favorites...");
    try {
      const items = await fetchFavoritesSync(code);
      const favorites = normalizeFavoritesFromSync(items);
      const confirmed = window.confirm(
        "Replace your local favorites with the synced list?",
      );
      if (confirmed) {
        const normalizedCode = code.trim().toLowerCase();
        state.favoritesSyncCode = normalizedCode;
        saveFavoritesSyncCode(normalizedCode);
        updateFavoritesSyncControls();
        updateFavorites(favorites, { sync: false });
        setFavoritesSyncEnterStatus("Favorites updated.");
        closeFavoritesSyncEnterModal();
      } else {
        clearFavoritesSyncEnterStatus();
      }
    } catch {
      setFavoritesSyncEnterStatus("Unable to sync favorites.", true);
    } finally {
      elements.favoritesSyncEnterButton.disabled = false;
      elements.favoritesSyncEnterButton.textContent = "Sync favorites";
    }
  }

  async function handleFavoritesSyncCreateSubmit() {
    elements.favoritesSyncCreateButton.classList.add("hidden");
    setFavoritesSyncCreateStatus("Creating sync code...");
    try {
      const response = await createFavoritesSync(state.favorites);
      const code = response.code ?? "";
      if (!code) {
        throw new Error("Missing sync code");
      }
      state.favoritesSyncCode = code;
      saveFavoritesSyncCode(code);
      updateFavoritesSyncControls();
      if (Array.isArray(response.favorites)) {
        const normalized = normalizeFavoritesFromSync(response.favorites);
        updateFavorites(normalized, { sync: false });
      }
      elements.favoritesSyncCreateButton.classList.add("hidden");
      elements.favoritesSyncCreateOutput.textContent = code;
      elements.favoritesSyncCreateOutput.classList.remove("hidden");
      elements.favoritesSyncCreateHint.textContent =
        "Enter this code on another device to sync.";
      clearFavoritesSyncCreateStatus();
    } catch {
      setFavoritesSyncCreateStatus("Unable to create sync code.", true);
      elements.favoritesSyncCreateButton.classList.remove("hidden");
      elements.favoritesSyncCreateButton.textContent = "Create sync code";
    }
  }

  function handleFavoritesSyncEnterKeydown(event: KeyboardEvent) {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    void handleFavoritesSyncEnterSubmit();
  }

  function handleFavoritesSyncEnterClose() {
    closeFavoritesSyncEnterModal();
  }

  function handleFavoritesSyncCreateClose() {
    closeFavoritesSyncCreateModal();
  }

  function handleFavoritesSyncEnterModalClick(event: MouseEvent) {
    if (event.target === elements.favoritesSyncEnterModal) {
      closeFavoritesSyncEnterModal();
    }
  }

  function handleFavoritesSyncCreateModalClick(event: MouseEvent) {
    if (event.target === elements.favoritesSyncCreateModal) {
      closeFavoritesSyncCreateModal();
    }
  }

  function normalizeFavoritesFromSync(items: FavoriteTrack[]) {
    const normalized: FavoriteTrack[] = [];
    for (const item of items) {
      if (!item || typeof item.uniqueSongId !== "string") {
        continue;
      }
      const title =
        typeof item.title === "string" && item.title.trim()
          ? item.title.trim()
          : "Untitled";
      const artist = typeof item.artist === "string" ? item.artist : "";
      const duration =
        typeof item.duration === "number" && Number.isFinite(item.duration)
          ? item.duration
          : null;
      const sourceType =
        item.sourceType === "upload" ? "upload" : ("youtube" as const);
      normalized.push({
        uniqueSongId: item.uniqueSongId,
        title,
        artist,
        duration,
        sourceType,
      });
    }
    return sortFavorites(normalized).slice(0, maxFavorites());
  }

  function setFavoritesSyncEnterStatus(message: string, isError = false) {
    elements.favoritesSyncEnterStatus.textContent = message;
    elements.favoritesSyncEnterStatus.classList.remove("hidden");
    elements.favoritesSyncEnterStatus.classList.toggle("error", isError);
  }

  function clearFavoritesSyncEnterStatus() {
    elements.favoritesSyncEnterStatus.textContent = "";
    elements.favoritesSyncEnterStatus.classList.add("hidden");
    elements.favoritesSyncEnterStatus.classList.remove("error");
  }

  function setFavoritesSyncCreateStatus(message: string, isError = false) {
    elements.favoritesSyncCreateStatus.textContent = message;
    elements.favoritesSyncCreateStatus.classList.remove("hidden");
    elements.favoritesSyncCreateStatus.classList.toggle("error", isError);
  }

  function clearFavoritesSyncCreateStatus() {
    elements.favoritesSyncCreateStatus.textContent = "";
    elements.favoritesSyncCreateStatus.classList.add("hidden");
    elements.favoritesSyncCreateStatus.classList.remove("error");
  }

  function updateFavorites(
    nextFavorites: FavoriteTrack[],
    options?: { sync?: boolean },
  ) {
    const prevFavorites = state.favorites;
    state.favorites = nextFavorites;
    saveFavorites(nextFavorites);
    renderFavoritesList();
    syncFavoriteButton();
    if (options?.sync === false) {
      return;
    }
    const delta = computeFavoritesDelta(prevFavorites, nextFavorites);
    if (delta.added.length === 0 && delta.removedIds.size === 0) {
      return;
    }
    scheduleFavoritesSync(delta);
  }

  function scheduleFavoritesSync(delta: FavoritesDelta) {
    if (!state.appConfig?.allow_favorites_sync) {
      return;
    }
    if (!state.favoritesSyncCode) {
      return;
    }
    if (syncUpdateInFlight) {
      pendingSyncDelta = delta;
      return;
    }
    void syncFavoritesToBackend(delta);
  }

  async function syncFavoritesToBackend(delta: FavoritesDelta) {
    syncUpdateInFlight = true;
    try {
      const code = state.favoritesSyncCode;
      if (!code) {
        return;
      }
      const remoteItems = await fetchFavoritesSync(code);
      const serverFavorites = normalizeFavoritesFromSync(remoteItems);
      const merged = applyFavoritesDelta(serverFavorites, delta);
      const response = await updateFavoritesSync(code, merged);
      if (Array.isArray(response.favorites)) {
        const normalized = normalizeFavoritesFromSync(response.favorites);
        updateFavorites(normalized, { sync: false });
      }
    } catch (err) {
      console.warn(`Favorites sync update failed: ${String(err)}`);
      showToast(context, "Favorites sync failed.");
    } finally {
      syncUpdateInFlight = false;
      if (pendingSyncDelta) {
        const pending = pendingSyncDelta;
        pendingSyncDelta = null;
        scheduleFavoritesSync(pending);
      }
    }
  }

  function computeFavoritesDelta(
    prevFavorites: FavoriteTrack[],
    nextFavorites: FavoriteTrack[],
  ): FavoritesDelta {
    const prevMap = new Map<string, FavoriteTrack>();
    const nextMap = new Map<string, FavoriteTrack>();
    prevFavorites.forEach((item) => prevMap.set(item.uniqueSongId, item));
    nextFavorites.forEach((item) => nextMap.set(item.uniqueSongId, item));
    const added: FavoriteTrack[] = [];
    for (const [id, item] of nextMap.entries()) {
      if (!prevMap.has(id)) {
        added.push(item);
      }
    }
    const removedIds = new Set<string>();
    for (const id of prevMap.keys()) {
      if (!nextMap.has(id)) {
        removedIds.add(id);
      }
    }
    return { added, removedIds };
  }

  function applyFavoritesDelta(
    serverFavorites: FavoriteTrack[],
    delta: FavoritesDelta,
  ) {
    let next = serverFavorites.filter(
      (item) => !delta.removedIds.has(item.uniqueSongId),
    );
    const existingIds = new Set(next.map((item) => item.uniqueSongId));
    for (const item of delta.added) {
      if (!existingIds.has(item.uniqueSongId)) {
        next.push(item);
      }
    }
    next = sortFavorites(next).slice(0, maxFavorites());
    return next;
  }

  function getCurrentFavoriteId() {
    return state.lastYouTubeId ?? state.lastJobId;
  }

  function getCurrentTrackId() {
    return state.lastYouTubeId ?? state.lastJobId;
  }

  function getCurrentFavoriteSourceType(): FavoriteTrack["sourceType"] {
    return state.lastYouTubeId ? "youtube" : "upload";
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
      const sourceType = item.sourceType ?? "youtube";
      const link = document.createElement("a");
      link.href = `/listen/${encodeURIComponent(item.uniqueSongId)}`;
      const titleText = item.title || "Untitled";
      const artist = (item.artist || "").trim();
      const showArtist = artist !== "" && artist !== "Unknown";
      const artistText = showArtist ? ` — ${artist}` : "";
      link.textContent = `${titleText}${artistText}`;
      link.dataset.favoriteId = item.uniqueSongId;
      link.dataset.sourceType = sourceType;
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
    const currentId = getCurrentFavoriteId();
    const active = currentId ? isFavorite(state.favorites, currentId) : false;
    elements.favoriteButton.classList.toggle("active", active);
    const label = active ? "Remove from Favorites" : "Add to Favorites";
    elements.favoriteButton.setAttribute("aria-label", label);
    elements.favoriteButton.title = label;
  }

  function maybeAutoFavoriteUserSupplied(response: AnalysisComplete) {
    if (!response.is_user_supplied) {
      return;
    }
    const favoriteId = response.youtube_id ?? response.id;
    if (!favoriteId || isFavorite(state.favorites, favoriteId)) {
      return;
    }
    const title = state.trackTitle || "Untitled";
    const artist = state.trackArtist || "";
    const track: FavoriteTrack = {
      uniqueSongId: favoriteId,
      title,
      artist,
      duration: state.trackDurationSec,
      sourceType: response.youtube_id ? "youtube" : "upload",
    };
    const result = addFavorite(state.favorites, track);
    if (result.status === "added") {
      updateFavorites(result.favorites);
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

  function handleFavoriteClick(event: Event) {
    event.preventDefault();
    const target = event.currentTarget as HTMLAnchorElement | null;
    const favoriteId = target?.dataset.favoriteId;
    if (!favoriteId) {
      return;
    }
    const sourceType = target?.dataset.sourceType ?? "youtube";
    navigateToTabWithState("play", { youtubeId: favoriteId });
    if (sourceType === "upload") {
      loadTrackByJobId(context, playbackDeps, favoriteId);
      return;
    }
    loadTrackByYouTubeId(context, playbackDeps, favoriteId);
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
    showFavoriteToast("Removed from Favorites");
  }

  function handleFavoriteToggle() {
    const currentId = getCurrentFavoriteId();
    if (!currentId) {
      return;
    }
    if (isFavorite(state.favorites, currentId)) {
      updateFavorites(removeFavorite(state.favorites, currentId));
      showFavoriteToast("Removed from Favorites");
      return;
    }
    const title = state.trackTitle || "Untitled";
    const artist = state.trackArtist || "";
    const track: FavoriteTrack = {
      uniqueSongId: currentId,
      title,
      artist,
      duration: state.trackDurationSec,
      sourceType: getCurrentFavoriteSourceType(),
    };
    const result = addFavorite(state.favorites, track);
    if (result.status === "limit") {
      showToast(context, `Maximum favorites reached (${maxFavorites()}).`);
      return;
    }
    updateFavorites(result.favorites);
    if (result.status === "added") {
      showFavoriteToast("Added to Favorites");
    } else {
      showToast(context, "Favorited");
    }
  }

  function showFavoriteToast(message: string) {
    if (state.favoritesSyncCode) {
      showToast(context, message, { icon: "cloud_done" });
      return;
    }
    showToast(context, message);
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
      setSearchTab("search");
    }
    if (tabId === "play" && !state.lastYouTubeId && !state.lastJobId) {
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

  function extractYoutubeId(value: string) {
    const trimmed = value.trim();
    if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
      return trimmed;
    }
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      return null;
    }
    const host = url.hostname.replace(/^www\./, "");
    if (host === "youtu.be") {
      return url.pathname.split("/").filter(Boolean)[0] ?? null;
    }
    if (host.endsWith("youtube.com")) {
      const idParam = url.searchParams.get("v");
      if (idParam) {
        return idParam;
      }
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts[0] === "embed" || parts[0] === "shorts") {
        return parts[1] ?? null;
      }
    }
    return null;
  }

  async function handleUploadFileClick() {
    const config = state.appConfig;
    if (!config?.allow_user_upload) {
      showToast(context, "Uploads are disabled.");
      return;
    }
    const file = elements.uploadFileInput.files?.[0];
    if (!file) {
      showToast(context, "Choose a file to upload.");
      return;
    }
    if (config.max_upload_size && file.size > config.max_upload_size) {
      showToast(
        context,
        `File is too large. Max ${Math.round(config.max_upload_size / (1024 * 1024))} MB.`,
      );
      return;
    }
    const originalLabel = elements.uploadFileButton.textContent ?? "Load";
    elements.uploadFileButton.disabled = true;
    elements.uploadFileButton.textContent = "Loading";
    try {
      const response = await uploadAudio(file);
      if (!response || !response.id) {
        throw new Error("Upload failed");
      }
      resetForNewTrack(context);
      state.lastJobId = response.id;
      state.lastYouTubeId = null;
      state.audioLoaded = false;
      state.analysisLoaded = false;
      updateTrackUrl(response.id, true);
      elements.uploadFileInput.value = "";
      setActiveTabWithRefresh("play");
      setLoadingProgress(context, null, "Queued");
      await pollAnalysis(context, playbackDeps, response.id);
    } catch (err) {
      showToast(context, `Upload failed: ${String(err)}`);
    } finally {
      elements.uploadFileButton.disabled = false;
      elements.uploadFileButton.textContent = originalLabel;
    }
  }

  async function handleUploadYoutubeClick() {
    const config = state.appConfig;
    if (!config?.allow_user_youtube) {
      showToast(context, "YouTube uploads are disabled.");
      return;
    }
    const raw = elements.uploadYoutubeInput.value.trim();
    if (!raw) {
      showToast(context, "Enter a YouTube URL.");
      return;
    }
    const youtubeId = extractYoutubeId(raw);
    if (!youtubeId) {
      showToast(context, "Invalid YouTube URL.");
      return;
    }
    const originalLabel = elements.uploadYoutubeButton.textContent ?? "Load";
    elements.uploadYoutubeButton.disabled = true;
    elements.uploadYoutubeButton.textContent = "Loading";
    try {
      const response = await startYoutubeAnalysis({
        youtube_id: youtubeId,
        is_user_supplied: true,
      });
      if (!response || !response.id) {
        throw new Error("Upload failed");
      }
      resetForNewTrack(context);
      state.lastYouTubeId = youtubeId;
      state.lastJobId = response.id;
      elements.uploadYoutubeInput.value = "";
      updateTrackUrl(youtubeId, true);
      setActiveTabWithRefresh("play");
      setLoadingProgress(context, null, "Fetching audio");
      await pollAnalysis(context, playbackDeps, response.id);
    } catch (err) {
      showToast(context, `Upload failed: ${String(err)}`);
    } finally {
      elements.uploadYoutubeButton.disabled = false;
      elements.uploadYoutubeButton.textContent = originalLabel;
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

  function handleDeleteJobClick() {
    const jobId = state.lastJobId;
    const youtubeId = state.lastYouTubeId;
    if (!jobId) {
      return;
    }
    deleteJob(jobId)
      .then(() => {
        const favoriteId = youtubeId ?? jobId;
        if (favoriteId) {
          deleteCachedTrack(favoriteId).catch((err) => {
            console.warn(`Cache delete failed: ${String(err)}`);
          });
        }
        if (favoriteId && isFavorite(state.favorites, favoriteId)) {
          updateFavorites(removeFavorite(state.favorites, favoriteId));
        }
        resetForNewTrack(context);
        navigateToTabWithState("top", { replace: true });
        showToast(context, "Deleted song");
      })
      .catch(() => {
        state.deleteEligible = false;
        state.deleteEligibilityJobId = jobId;
        elements.deleteButton.classList.add("hidden");
        showToast(context, "Song can no longer be deleted");
      });
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
    const icon =
      elements.fullscreenButton.querySelector<HTMLSpanElement>(
        ".fullscreen-icon",
      );
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
    options?: { replace?: boolean; youtubeId?: string | null },
  ) {
    setActiveTabWithRefresh(tabId);
    navigateToTab(tabId, options, getCurrentTrackId());
  }

  function setActiveTabWithRefresh(tabId: TabId) {
    setActiveTab(context, tabId, () => {});
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
        const artist =
          typeof item.artist === "string" ? item.artist : "Unknown";
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
      elements.topSongsList.textContent = `Top songs unavailable: ${String(
        err,
      )}`;
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
      setAnalysisStatus(
        context,
        "Select a track to generate a short URL.",
        false,
      );
      navigateToTabWithState("search");
      return;
    }
    const shortUrl = `${window.location.origin}/listen/${encodeURIComponent(
      state.lastYouTubeId,
    )}`;
    try {
      await navigator.clipboard.writeText(shortUrl);
      showToast(context, "Link copied to clipboard");
    } catch (err) {
      setAnalysisStatus(context, `Copy failed: ${String(err)}`, false);
    }
  }

  function setActiveVisualization(index: number) {
    if (
      index === state.activeVizIndex ||
      index < 0 ||
      index >= visualizations.length
    ) {
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
      state.selectedEdge && !state.selectedEdge.deleted
        ? state.selectedEdge
        : null,
    );
    if (state.lastBeatIndex !== null) {
      visualizations[state.activeVizIndex]?.update(
        state.lastBeatIndex,
        false,
        null,
      );
    }
    elements.vizButtons.forEach((button) => {
      button.classList.toggle(
        "active",
        Number(button.dataset.viz) === state.activeVizIndex,
      );
    });
    localStorage.setItem(vizStorageKey, String(state.activeVizIndex));
  }
}
