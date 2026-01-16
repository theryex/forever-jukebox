import { requireElement, requireNonEmpty } from "./dom";

export type Elements = ReturnType<typeof getElements>;

export function getElements() {
  const listenTimeEl = requireElement(
    document.querySelector<HTMLSpanElement>("#listen-time"),
    "#listen-time"
  );
  const beatsPlayedEl = requireElement(
    document.querySelector<HTMLSpanElement>("#beats-played"),
    "#beats-played"
  );
  const vizNowPlayingEl = requireElement(
    document.querySelector<HTMLDivElement>("#viz-now-playing"),
    "#viz-now-playing"
  );
  const vizPanel = requireElement(
    document.querySelector<HTMLElement>("#viz-panel"),
    "#viz-panel"
  );
  const vizLayer = requireElement(
    document.querySelector<HTMLDivElement>("#viz-layer"),
    "#viz-layer"
  );
  const vizButtons = requireNonEmpty(
    Array.from(document.querySelectorAll<HTMLButtonElement>("[data-viz]")),
    "[data-viz]"
  );
  const playStatusPanel = requireElement(
    document.querySelector<HTMLDivElement>("#play-status"),
    "#play-status"
  );
  const playMenu = requireElement(
    document.querySelector<HTMLDivElement>("#play-menu"),
    "#play-menu"
  );
  const tabButtons = requireNonEmpty(
    Array.from(document.querySelectorAll<HTMLButtonElement>("[data-tab-button]")),
    "[data-tab-button]"
  );
  const tabPanels = requireNonEmpty(
    Array.from(document.querySelectorAll<HTMLElement>("[data-tab-panel]")),
    "[data-tab-panel]"
  );
  const playTabButton = requireElement(
    document.querySelector<HTMLButtonElement>('[data-tab-button="play"]'),
    '[data-tab-button="play"]'
  );
  const analysisStatus = requireElement(
    document.querySelector<HTMLDivElement>("#analysis-status"),
    "#analysis-status"
  );
  const analysisSpinner = requireElement(
    document.querySelector<HTMLDivElement>("#analysis-spinner"),
    "#analysis-spinner"
  );
  const analysisProgress = requireElement(
    document.querySelector<HTMLDivElement>("#analysis-progress"),
    "#analysis-progress"
  );
  const playButton = requireElement(
    document.querySelector<HTMLButtonElement>("#play"),
    "#play"
  );
  const shortUrlButton = requireElement(
    document.querySelector<HTMLButtonElement>("#short-url"),
    "#short-url"
  );
  const tuningButton = requireElement(
    document.querySelector<HTMLButtonElement>("#tuning"),
    "#tuning"
  );
  const infoButton = requireElement(
    document.querySelector<HTMLButtonElement>("#track-info"),
    "#track-info"
  );
  const favoriteButton = requireElement(
    document.querySelector<HTMLButtonElement>("#favorite-toggle"),
    "#favorite-toggle"
  );
  const playTitle = requireElement(
    document.querySelector<HTMLDivElement>("#play-title"),
    "#play-title"
  );
  const themeLinks = requireNonEmpty(
    Array.from(document.querySelectorAll<HTMLButtonElement>("[data-theme]")),
    "[data-theme]"
  );
  const fullscreenButton = requireElement(
    document.querySelector<HTMLButtonElement>("#fullscreen"),
    "#fullscreen"
  );
  const tuningModal = requireElement(
    document.querySelector<HTMLDivElement>("#tuning-modal"),
    "#tuning-modal"
  );
  const infoModal = requireElement(
    document.querySelector<HTMLDivElement>("#info-modal"),
    "#info-modal"
  );
  const tuningClose = requireElement(
    document.querySelector<HTMLButtonElement>("#tuning-close"),
    "#tuning-close"
  );
  const infoClose = requireElement(
    document.querySelector<HTMLButtonElement>("#info-close"),
    "#info-close"
  );
  const tuningApply = requireElement(
    document.querySelector<HTMLButtonElement>("#tuning-apply"),
    "#tuning-apply"
  );
  const infoDurationEl = requireElement(
    document.querySelector<HTMLSpanElement>("#info-duration"),
    "#info-duration"
  );
  const infoBeatsEl = requireElement(
    document.querySelector<HTMLSpanElement>("#info-beats"),
    "#info-beats"
  );
  const infoBranchesEl = requireElement(
    document.querySelector<HTMLSpanElement>("#info-branches"),
    "#info-branches"
  );
  const thresholdInput = requireElement(
    document.querySelector<HTMLInputElement>("#threshold"),
    "#threshold"
  );
  const thresholdVal = requireElement(
    document.querySelector<HTMLSpanElement>("#threshold-val"),
    "#threshold-val"
  );
  const computedThresholdEl = requireElement(
    document.querySelector<HTMLSpanElement>("#computed-threshold"),
    "#computed-threshold"
  );
  const minProbInput = requireElement(
    document.querySelector<HTMLInputElement>("#min-prob"),
    "#min-prob"
  );
  const minProbVal = requireElement(
    document.querySelector<HTMLSpanElement>("#min-prob-val"),
    "#min-prob-val"
  );
  const maxProbInput = requireElement(
    document.querySelector<HTMLInputElement>("#max-prob"),
    "#max-prob"
  );
  const maxProbVal = requireElement(
    document.querySelector<HTMLSpanElement>("#max-prob-val"),
    "#max-prob-val"
  );
  const rampInput = requireElement(
    document.querySelector<HTMLInputElement>("#ramp"),
    "#ramp"
  );
  const rampVal = requireElement(
    document.querySelector<HTMLSpanElement>("#ramp-val"),
    "#ramp-val"
  );
  const lastEdgeInput = requireElement(
    document.querySelector<HTMLInputElement>("#last-edge"),
    "#last-edge"
  );
  const justBackwardsInput = requireElement(
    document.querySelector<HTMLInputElement>("#just-backwards"),
    "#just-backwards"
  );
  const justLongInput = requireElement(
    document.querySelector<HTMLInputElement>("#just-long"),
    "#just-long"
  );
  const removeSeqInput = requireElement(
    document.querySelector<HTMLInputElement>("#remove-seq"),
    "#remove-seq"
  );
  const searchInput = requireElement(
    document.querySelector<HTMLInputElement>("#search-input"),
    "#search-input"
  );
  const searchButton = requireElement(
    document.querySelector<HTMLButtonElement>("#search-button"),
    "#search-button"
  );
  const searchResults = requireElement(
    document.querySelector<HTMLDivElement>("#search-results"),
    "#search-results"
  );
  const searchHint = requireElement(
    document.querySelector<HTMLDivElement>("#search-hint"),
    "#search-hint"
  );
  const topSongsList = requireElement(
    document.querySelector<HTMLOListElement>("#top-songs"),
    "#top-songs"
  );
  const favoritesList = requireElement(
    document.querySelector<HTMLOListElement>("#favorites-list"),
    "#favorites-list"
  );
  const topSongsTabs = requireNonEmpty(
    Array.from(document.querySelectorAll<HTMLButtonElement>("[data-top-subtab]")),
    "[data-top-subtab]"
  );
  const topListTitle = requireElement(
    document.querySelector<HTMLDivElement>("#top-list-title"),
    "#top-list-title"
  );
  const toast = requireElement(
    document.querySelector<HTMLDivElement>("#toast"),
    "#toast"
  );
  const vizStats = document.querySelector<HTMLDivElement>("#viz-stats");

  return {
    listenTimeEl,
    beatsPlayedEl,
    vizNowPlayingEl,
    vizPanel,
    vizLayer,
    vizButtons,
    playStatusPanel,
    playMenu,
    tabButtons,
    tabPanels,
    playTabButton,
    analysisStatus,
    analysisSpinner,
    analysisProgress,
    playButton,
    shortUrlButton,
    tuningButton,
    infoButton,
    favoriteButton,
    playTitle,
    themeLinks,
    fullscreenButton,
    tuningModal,
    infoModal,
    tuningClose,
    infoClose,
    tuningApply,
    infoDurationEl,
    infoBeatsEl,
    infoBranchesEl,
    thresholdInput,
    thresholdVal,
    computedThresholdEl,
    minProbInput,
    minProbVal,
    maxProbInput,
    maxProbVal,
    rampInput,
    rampVal,
    lastEdgeInput,
    justBackwardsInput,
    justLongInput,
    removeSeqInput,
    searchInput,
    searchButton,
    searchResults,
    searchHint,
    topSongsList,
    favoritesList,
    topSongsTabs,
    topListTitle,
    toast,
    vizStats,
  };
}
