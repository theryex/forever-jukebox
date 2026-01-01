import "./style.css";
import { JukeboxEngine } from "./engine";
import { BufferedAudioPlayer } from "./audio/BufferedAudioPlayer";
import { CanvasViz } from "./visualization/CanvasViz";
import type { Edge } from "./engine/types";

function requireElement<T>(value: T | null, name: string): T {
  if (!value) {
    throw new Error(`Missing required DOM element: ${name}`);
  }
  return value;
}

function requireNonEmpty<T>(value: T[], name: string): T[] {
  if (value.length === 0) {
    throw new Error(`Missing required DOM elements: ${name}`);
  }
  return value;
}

const listenTimeEl = requireElement(
  document.querySelector<HTMLSpanElement>("#listen-time"),
  "#listen-time"
);
const beatsPlayedEl = requireElement(
  document.querySelector<HTMLSpanElement>("#beats-played"),
  "#beats-played"
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
const infoCloseFooter = requireElement(
  document.querySelector<HTMLButtonElement>("#info-close-footer"),
  "#info-close-footer"
);

const trackCacheDbName = "forever-jukebox-cache";
const trackCacheStore = "tracks";

type CachedTrack = {
  youtubeId: string;
  audio?: ArrayBuffer;
  jobId?: string;
  updatedAt: number;
};

let trackCacheDbPromise: Promise<IDBDatabase> | null = null;

function openTrackCacheDb(): Promise<IDBDatabase> {
  if (!("indexedDB" in window)) {
    return Promise.reject(new Error("IndexedDB not available"));
  }
  if (trackCacheDbPromise) {
    return trackCacheDbPromise;
  }
  trackCacheDbPromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(trackCacheDbName, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(trackCacheStore)) {
        db.createObjectStore(trackCacheStore, { keyPath: "youtubeId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB open failed"));
  });
  return trackCacheDbPromise;
}

async function readCachedTrack(youtubeId: string): Promise<CachedTrack | null> {
  const db = await openTrackCacheDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(trackCacheStore, "readonly");
    const store = tx.objectStore(trackCacheStore);
    const request = store.get(youtubeId);
    request.onsuccess = () => {
      resolve((request.result as CachedTrack | undefined) ?? null);
    };
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB read failed"));
  });
}

async function updateCachedTrack(
  youtubeId: string,
  patch: Partial<CachedTrack>
) {
  const existing = await readCachedTrack(youtubeId);
  const next: CachedTrack = {
    youtubeId,
    audio: existing?.audio,
    jobId: existing?.jobId,
    updatedAt: Date.now(),
    ...patch,
  };
  const db = await openTrackCacheDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(trackCacheStore, "readwrite");
    const store = tx.objectStore(trackCacheStore);
    const request = store.put(next);
    request.onsuccess = () => resolve();
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB write failed"));
  });
}
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

const player = new BufferedAudioPlayer();
const engine = new JukeboxEngine(player, { randomMode: "random" });
const positioners = [
  (count: number, width: number, height: number) => {
    const radius = Math.min(width, height) * 0.4;
    const cx = width / 2;
    const cy = height / 2;
    return Array.from({ length: count }, (_, i) => {
      const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
      return {
        x: cx + Math.cos(angle) * radius,
        y: cy + Math.sin(angle) * radius,
      };
    });
  },
  (count: number, width: number, height: number) => {
    const cx = width / 2;
    const cy = height / 2;
    const maxRadius = Math.min(width, height) * 0.42;
    const minRadius = Math.min(width, height) * 0.08;
    const turns = 3;
    return Array.from({ length: count }, (_, i) => {
      const t = i / count;
      const angle = t * Math.PI * 2 * turns - Math.PI / 2;
      const radius = minRadius + (maxRadius - minRadius) * t;
      return {
        x: cx + Math.cos(angle) * radius,
        y: cy + Math.sin(angle) * radius,
      };
    });
  },
  (count: number, width: number, height: number) => {
    const cols = Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / cols);
    const padding = 40;
    const gridW = width - padding * 2;
    const gridH = height - padding * 2;
    return Array.from({ length: count }, (_, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      return {
        x: padding + (col / Math.max(1, cols - 1)) * gridW,
        y: padding + (row / Math.max(1, rows - 1)) * gridH,
      };
    });
  },
  (count: number, width: number, height: number) => {
    const padding = 40;
    const amp = height * 0.25;
    const center = height / 2;
    const span = width - padding * 2;
    const waveTurns = 3;
    return Array.from({ length: count }, (_, i) => {
      const t = i / Math.max(1, count - 1);
      return {
        x: padding + span * t,
        y: center + Math.sin(t * Math.PI * 2 * waveTurns) * amp,
      };
    });
  },
  (count: number, width: number, height: number) => {
    const cx = width / 2;
    const cy = height / 2;
    const ampX = width * 0.35;
    const ampY = height * 0.25;
    return Array.from({ length: count }, (_, i) => {
      const t = (i / count) * Math.PI * 2;
      return {
        x: cx + Math.sin(t) * ampX,
        y: cy + Math.sin(t * 2) * ampY,
      };
    });
  },
  (count: number, width: number, height: number) => {
    const cx = width / 2;
    const cy = height / 2;
    const maxRadius = Math.min(width, height) * 0.42;
    const minRadius = Math.min(width, height) * 0.08;
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    return Array.from({ length: count }, (_, i) => {
      const t = i / Math.max(1, count - 1);
      const angle = i * goldenAngle;
      const radius = minRadius + (maxRadius - minRadius) * Math.sqrt(t);
      const wobble = 0.06 * Math.sin(i * 12.9898) + 0.04 * Math.cos(i * 4.1414);
      const r = radius * (1 + wobble);
      return {
        x: cx + Math.cos(angle) * r,
        y: cy + Math.sin(angle) * r,
      };
    });
  },
];
const visualizations = positioners.map(
  (positioner) => new CanvasViz(vizLayer, positioner)
);
let activeVizIndex = 0;
visualizations.forEach((viz, index) => viz.setVisible(index === 0));
const vizStats = document.querySelector<HTMLDivElement>("#viz-stats");
let playTimerMs = 0;
let lastPlayStamp: number | null = null;
let lastBeatIndex: number | null = null;
let vizData: ReturnType<typeof engine.getVisualizationData> = null;
let isRunning = false;
let audioLoaded = false;
let analysisLoaded = false;
let audioLoadInFlight = false;
let autoComputedThreshold: number | null = null;
const defaultConfig = engine.getConfig();
let lastJobId: string | null = null;
let lastYouTubeId: string | null = null;
let lastPlayCountedJobId: string | null = null;
let shortUrlResetTimer: number | null = null;
let activeTabId = "top";
let shiftBranching = false;
let selectedEdge: Edge | null = null;
let topSongsRefreshTimer: number | null = null;
let trackDurationSec: number | null = null;
const themeStorageKey = "fj-theme";
const vizStorageKey = "fj-viz";
vizButtons.forEach((button) => {
  button.disabled = true;
});
let wakeLock: WakeLockSentinel | null = null;
const storedViz = localStorage.getItem(vizStorageKey);
if (storedViz) {
  const parsed = Number.parseInt(storedViz, 10);
  if (Number.isFinite(parsed)) {
    setActiveVisualization(parsed);
  }
}

function syncTuningUI() {
  const config = engine.getConfig();
  const graph = engine.getGraphState();
  const thresholdValue =
    config.currentThreshold === 0 && graph
      ? Math.round(graph.currentThreshold)
      : config.currentThreshold;
  thresholdInput.value = `${thresholdValue}`;
  thresholdVal.textContent = thresholdInput.value;
  const minProbPct = Math.round(config.minRandomBranchChance * 100);
  const maxProbPct = Math.round(config.maxRandomBranchChance * 100);
  const rampPct = Math.round(config.randomBranchChanceDelta * 1000) / 10;
  minProbInput.value = `${minProbPct}`;
  minProbVal.textContent = `${minProbPct}%`;
  maxProbInput.value = `${maxProbPct}`;
  maxProbVal.textContent = `${maxProbPct}%`;
  rampInput.value = `${rampPct}`;
  rampVal.textContent = `${rampPct}%`;
  lastEdgeInput.checked = config.addLastEdge;
  justBackwardsInput.checked = config.justBackwards;
  justLongInput.checked = config.justLongBranches;
  removeSeqInput.checked = config.removeSequentialBranches;
  const computedValue =
    autoComputedThreshold ??
    (graph ? Math.round(graph.currentThreshold) : null);
  computedThresholdEl.textContent =
    computedValue === null ? "-" : `${computedValue}`;
}

function setActiveTab(tabId: string) {
  activeTabId = tabId;
  tabPanels.forEach((panel) => {
    panel.classList.toggle("hidden", panel.dataset.tabPanel !== tabId);
  });
  tabButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.tabButton === tabId);
  });
  if (tabId === "play") {
    visualizations[activeVizIndex]?.resizeNow();
  } else if (tabId === "top") {
    if (topSongsRefreshTimer !== null) {
      window.clearTimeout(topSongsRefreshTimer);
    }
    topSongsRefreshTimer = window.setTimeout(() => {
      topSongsRefreshTimer = null;
      fetchTopSongs().catch((err) => {
        console.warn(`Top songs load failed: ${String(err)}`);
      });
    }, 250);
  } else if (shiftBranching) {
    shiftBranching = false;
    engine.setForceBranch(false);
  }
  if (tabId !== "play" && selectedEdge) {
    selectedEdge = null;
    visualizations.forEach((viz) => viz.setSelectedEdge(null));
  }
}

function pathForTab(tabId: string, youtubeId?: string | null) {
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

function navigateToTab(
  tabId: string,
  options?: { replace?: boolean; youtubeId?: string | null }
) {
  setActiveTab(tabId);
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

function updateTrackUrl(youtubeId: string, replace = false) {
  const url = new URL(window.location.href);
  url.pathname = pathForTab("play", youtubeId);
  url.search = "";
  if (replace) {
    window.history.replaceState({}, "", url.toString());
  } else {
    window.history.pushState({}, "", url.toString());
  }
}

tabButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const tabId = button.dataset.tabButton;
    if (!tabId) {
      return;
    }
    if (tabId === "play" && !lastYouTubeId) {
      return;
    }
    navigateToTab(tabId);
  });
});

function applyTheme(theme: "light" | "dark") {
  document.body.classList.toggle("theme-light", theme === "light");
  themeLinks.forEach((link) => {
    link.classList.toggle("active", link.dataset.theme === theme);
  });
  localStorage.setItem(themeStorageKey, theme);
  visualizations.forEach((viz) => viz.refresh());
}

function setAnalysisStatus(message: string, spinning: boolean) {
  analysisStatus.textContent = message;
  if (spinning) {
    analysisSpinner.classList.remove("hidden");
  } else {
    analysisSpinner.classList.add("hidden");
    analysisProgress.textContent = "";
  }
}

function setLoadingProgress(progress: number | null) {
  analysisStatus.textContent = "Loading";
  analysisSpinner.classList.remove("hidden");
  if (typeof progress === "number") {
    analysisProgress.textContent = `${Math.round(progress)}%`;
  } else {
    analysisProgress.textContent = "";
  }
}

function formatDuration(seconds: number) {
  const totalSeconds = Math.floor(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  const hh = String(hours).padStart(2, "0");
  const mm = String(minutes).padStart(2, "0");
  const ss = String(secs).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function formatTrackDuration(seconds: unknown) {
  if (typeof seconds !== "number" || Number.isNaN(seconds)) {
    return "-";
  }
  return formatDuration(seconds);
}

function updateListenTimeDisplay() {
  const now = performance.now();
  const totalMs =
    playTimerMs + (lastPlayStamp !== null ? now - lastPlayStamp : 0);
  listenTimeEl.textContent = formatDuration(totalMs / 1000);
}

function updateTrackInfo() {
  const graph = engine.getGraphState();
  const resolvedDuration =
    typeof trackDurationSec === "number" && Number.isFinite(trackDurationSec)
      ? trackDurationSec
      : player.getDuration();
  infoDurationEl.textContent =
    typeof resolvedDuration === "number" && Number.isFinite(resolvedDuration)
      ? formatDuration(resolvedDuration)
      : "00:00:00";
  infoBeatsEl.textContent = `${graph ? graph.totalBeats : 0}`;
  const currentVizData = vizData ?? engine.getVisualizationData();
  infoBranchesEl.textContent = `${currentVizData ? currentVizData.edges.length : 0}`;
}

function updateVizVisibility() {
  if (audioLoaded && analysisLoaded) {
    playStatusPanel.classList.add("hidden");
    playMenu.classList.remove("hidden");
    vizPanel.classList.remove("hidden");
    playButton.classList.remove("hidden");
    playTabButton.disabled = false;
    visualizations[activeVizIndex]?.resizeNow();
    vizButtons.forEach((button) => {
      button.disabled = false;
    });
  } else {
    playStatusPanel.classList.remove("hidden");
    playMenu.classList.add("hidden");
    vizPanel.classList.add("hidden");
    playButton.classList.add("hidden");
    playTabButton.disabled = true;
    vizButtons.forEach((button) => {
      button.disabled = true;
    });
  }
}

function openTuning() {
  syncTuningUI();
  tuningModal.classList.add("open");
}

function closeTuning() {
  tuningModal.classList.remove("open");
}

function openInfo() {
  updateTrackInfo();
  infoModal.classList.add("open");
}

function closeInfo() {
  infoModal.classList.remove("open");
}

function requestWakeLock() {
  if (!("wakeLock" in navigator)) {
    return;
  }
  navigator.wakeLock
    .request("screen")
    .then((lock) => {
      wakeLock = lock;
      wakeLock.addEventListener("release", () => {
        wakeLock = null;
      });
    })
    .catch(() => {
      console.warn("Wake lock unavailable");
    });
}

function releaseWakeLock() {
  if (!wakeLock) {
    return;
  }
  wakeLock.release().catch(() => {
    console.warn("Failed to release wake lock");
  });
  wakeLock = null;
}

engine.onUpdate((state) => {
  beatsPlayedEl.textContent = `${state.beatsPlayed}`;
  if (state.currentBeatIndex >= 0) {
    const jumpFrom =
      state.lastJumped && state.lastJumpFromIndex !== null
        ? state.lastJumpFromIndex
        : lastBeatIndex;
    visualizations[activeVizIndex]?.update(
      state.currentBeatIndex,
      state.lastJumped,
      jumpFrom
    );
    lastBeatIndex = state.currentBeatIndex;
  }
});

window.setInterval(() => {
  updateListenTimeDisplay();
}, 200);

function applyAnalysisResult(data: any): boolean {
  if (!data || data.status !== "complete" || !data.result) {
    return false;
  }
  engine.loadAnalysis(data.result);
  const graph = engine.getGraphState();
  autoComputedThreshold = graph ? Math.round(graph.currentThreshold) : null;
  vizData = engine.getVisualizationData();
  const nextVizData = vizData;
  if (nextVizData) {
    visualizations.forEach((viz) => viz.setData(nextVizData));
  }
  selectedEdge = null;
  visualizations.forEach((viz) => viz.setSelectedEdge(null));
  selectedEdge = null;
  visualizations.forEach((viz) => viz.setSelectedEdge(null));
  analysisLoaded = true;
  updateVizVisibility();
  setActiveTab("play");
  const track = data?.result?.track ?? data?.track;
  const title = track?.title;
  const artist = track?.artist;
  trackDurationSec =
    typeof track?.duration === "number" && Number.isFinite(track.duration)
      ? track.duration
      : null;
  if (title || artist) {
    playTitle.textContent = artist
      ? `${title ?? "Unknown"} — ${artist}`
      : `${title}`;
  } else {
    playTitle.textContent = "";
  }
  updateTrackInfo();
  const jobId = typeof data.id === "string" ? data.id : lastJobId;
  if (jobId) {
    recordPlay(jobId).catch((err) => {
      console.warn(`Failed to record play: ${String(err)}`);
    });
  }
  return true;
}

async function recordPlay(jobId: string) {
  if (lastPlayCountedJobId === jobId) {
    return;
  }
  lastPlayCountedJobId = jobId;
  const response = await fetch(`/api/plays/${encodeURIComponent(jobId)}`, {
    method: "POST",
  });
  if (!response.ok) {
    lastPlayCountedJobId = null;
    throw new Error(`Play count failed (${response.status})`);
  }
}

async function pollAnalysis(jobId: string) {
  const intervalMs = 2000;
  while (true) {
    const response = await fetch(`/api/analysis/${encodeURIComponent(jobId)}`);
    if (response.status === 404) {
      setAnalysisStatus("Load failed. Try again.", false);
      navigateToTab("top", { replace: true });
      return;
    }
    if (response.status === 202) {
      const data = await response.json();
      const progress =
        typeof data?.progress === "number" ? data.progress : null;
      setLoadingProgress(progress);
      if (data.status !== "downloading" && !audioLoaded && !audioLoadInFlight) {
        audioLoadInFlight = true;
        try {
          await loadAudioFromJob(jobId);
        } catch (_err) {
          audioLoadInFlight = false;
        }
      }
    } else if (response.status === 200) {
      const data = await response.json();
      if (data.status === "failed") {
        setAnalysisStatus("Loading failed.", false);
        throw new Error(data.error || "Analysis failed");
      }
      if (!audioLoaded) {
        await loadAudioFromJob(jobId);
      }
      if (applyAnalysisResult(data)) {
        return;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

async function loadAudioFromJob(jobId: string) {
  const response = await fetch(`/api/audio/${encodeURIComponent(jobId)}`);
  if (!response.ok) {
    throw new Error(`Audio download failed (${response.status})`);
  }
  const buffer = await response.arrayBuffer();
  await player.decode(buffer);
  audioLoaded = true;
  audioLoadInFlight = false;
  updateVizVisibility();
  updateTrackInfo();
  if (lastYouTubeId) {
    updateCachedTrack(lastYouTubeId, { audio: buffer, jobId }).catch((err) => {
      console.warn(`Cache save failed: ${String(err)}`);
    });
  }
}

async function startYoutubeAnalysis(
  youtubeId: string,
  title: string,
  artist: string
) {
  resetForNewTrack();
  resetSearchUI();
  audioLoaded = false;
  analysisLoaded = false;
  updateVizVisibility();
  setActiveTab("play");
  setLoadingProgress(0);
  lastYouTubeId = youtubeId;
  updateTrackUrl(youtubeId);
  await tryLoadCachedAudio(youtubeId);
  const payload = { youtube_id: youtubeId, title, artist };
  const response = await fetch("/api/analysis/youtube", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`YouTube download failed (${response.status})`);
  }
  const data = await response.json();
  if (!data || typeof data.id !== "string") {
    throw new Error("Invalid job response");
  }
  lastJobId = data.id;
  await pollAnalysis(data.id);
}

async function showYoutubeMatches(
  name: string,
  artist: string,
  duration: number
) {
  const query = artist ? `${artist} - ${name}` : name;
  navigateToTab("search", { replace: true });
  searchResults.textContent = "Searching YouTube for matches...";
  searchHint.textContent = "Step 2: Choose the closest YouTube match.";
  try {
    const response = await fetch(
      `/api/search/youtube?q=${encodeURIComponent(
        query
      )}&target_duration=${encodeURIComponent(duration)}`
    );
    if (!response.ok) {
      throw new Error(`YouTube search failed (${response.status})`);
    }
    const data = await response.json();
    const ytItems = Array.isArray(data?.items) ? data.items.slice(0, 10) : [];
    if (ytItems.length === 0) {
      searchResults.textContent = "No YouTube matches found.";
      searchHint.textContent = "Step 1: Find a Spotify track.";
      return;
    }
    searchResults.innerHTML = "";
    const list = document.createElement("ol");
    list.className = "search-list";
    for (const item of ytItems) {
      const title = typeof item.title === "string" ? item.title : "Untitled";
      const ytDuration =
        typeof item.duration === "number" ? item.duration : null;
      const li = document.createElement("li");
      li.className = "search-item";
      const titleSpan = document.createElement("strong");
      titleSpan.textContent = title;
      const durationSpan = document.createElement("span");
      durationSpan.textContent = formatTrackDuration(ytDuration);
      li.append(titleSpan, durationSpan);
      li.addEventListener("click", async () => {
        if (!item.id) {
          alert("No YouTube id available.");
          return;
        }
        try {
          await startYoutubeAnalysis(String(item.id), name, artist);
        } catch (err) {
          setAnalysisStatus(`YouTube analysis failed: ${String(err)}`, false);
        }
      });
      list.append(li);
    }
    searchResults.append(list);
  } catch (err) {
    searchResults.textContent = `YouTube search failed: ${String(err)}`;
    searchHint.textContent = "Step 1: Find a Spotify track.";
  }
}

async function tryLoadCachedAudio(youtubeId: string) {
  try {
    const cached = await readCachedTrack(youtubeId);
    if (!cached?.audio) {
      return false;
    }
    lastJobId = cached.jobId ?? null;
    await player.decode(cached.audio);
    audioLoaded = true;
    audioLoadInFlight = false;
    updateVizVisibility();
    updateTrackInfo();
    return true;
  } catch (err) {
    console.warn(`Cache lookup failed: ${String(err)}`);
    return false;
  }
}

async function tryLoadExistingTrackByName(title: string, artist: string) {
  if (!artist) {
    return false;
  }
  searchResults.textContent = "Checking existing analysis...";
  searchHint.textContent = "Step 2: Choose the closest YouTube match.";
  try {
    const params = new URLSearchParams({
      title,
      artist,
    });
    const response = await fetch(
      `/api/jobs/by-track?${params.toString()}`
    );
    if (response.status === 404) {
      return false;
    }
    if (!response.ok) {
      throw new Error(`Lookup failed (${response.status})`);
    }
    const data = await response.json();
    const jobId = typeof data.id === "string" ? data.id : null;
    const youtubeId =
      typeof data.youtube_id === "string" ? data.youtube_id : null;
    if (!jobId || !youtubeId) {
      return false;
    }
    resetForNewTrack();
    resetSearchUI();
    audioLoaded = false;
    analysisLoaded = false;
    updateVizVisibility();
    setActiveTab("play");
    setLoadingProgress(0);
    lastYouTubeId = youtubeId;
    updateTrackUrl(youtubeId);
    lastJobId = jobId;
    if (response.status === 202) {
      await pollAnalysis(jobId);
      return true;
    }
    if (data.status === "failed") {
      return false;
    }
    if (data.status === "complete" && data.result) {
      if (!audioLoaded) {
        await loadAudioFromJob(jobId);
      }
      applyAnalysisResult(data);
      return true;
    }
    await pollAnalysis(jobId);
    return true;
  } catch (err) {
    searchResults.textContent = `Lookup failed: ${String(err)}`;
    return false;
  }
}

async function runSearch() {
  const query = searchInput.value.trim();
  if (!query) {
    searchResults.textContent = "Enter a search query.";
    return;
  }
  searchButton.disabled = true;
  searchResults.textContent = "Searching Spotify...";
  searchHint.textContent = "Step 1: Find a Spotify track.";
  try {
    const response = await fetch(
      `/api/search/spotify?q=${encodeURIComponent(query)}`
    );
    if (!response.ok) {
      throw new Error(`Search failed (${response.status})`);
    }
    const data = await response.json();
    const items = Array.isArray(data?.items) ? data.items.slice(0, 10) : [];
    if (items.length === 0) {
      searchResults.textContent = "No Spotify results found.";
      return;
    }
    searchResults.innerHTML = "";
    const list = document.createElement("ol");
    list.className = "search-list";
    for (const item of items) {
      const name = typeof item.name === "string" ? item.name : "Untitled";
      const artist = typeof item.artist === "string" ? item.artist : "";
      const title = artist ? `${name} — ${artist}` : name;
      const duration = typeof item.duration === "number" ? item.duration : null;
      const li = document.createElement("li");
      li.className = "search-item";
      const titleSpan = document.createElement("strong");
      titleSpan.textContent = title;
      const durationSpan = document.createElement("span");
      durationSpan.textContent = formatTrackDuration(item.duration);
      li.append(titleSpan, durationSpan);
      li.addEventListener("click", async () => {
        if (await tryLoadExistingTrackByName(name, artist)) {
          return;
        }
        if (duration === null) {
          alert("No duration available for this track.");
          return;
        }
        await showYoutubeMatches(name, artist, duration);
      });
      list.append(li);
    }
    searchResults.append(list);
  } catch (err) {
    searchResults.textContent = `Search failed: ${String(err)}`;
  } finally {
    searchButton.disabled = false;
  }
}

function resetForNewTrack() {
  shiftBranching = false;
  engine.setForceBranch(false);
  selectedEdge = null;
  visualizations.forEach((viz) => viz.setSelectedEdge(null));
  engine.clearDeletedEdges();
  audioLoaded = false;
  analysisLoaded = false;
  audioLoadInFlight = false;
  updateVizVisibility();
  playTimerMs = 0;
  lastPlayStamp = null;
  lastBeatIndex = null;
  updateListenTimeDisplay();
  beatsPlayedEl.textContent = "0";
  if (tuningModal.classList.contains("open")) {
    tuningModal.classList.remove("open");
  }
  if (infoModal.classList.contains("open")) {
    infoModal.classList.remove("open");
  }
  if (isRunning) {
    engine.stopJukebox();
    isRunning = false;
    playButton.textContent = "Play";
  }
  autoComputedThreshold = null;
  computedThresholdEl.textContent = "-";
  engine.updateConfig({ ...defaultConfig });
  syncTuningUI();
  lastJobId = null;
  lastYouTubeId = null;
  lastPlayCountedJobId = null;
  playTitle.textContent = "";
  trackDurationSec = null;
  vizData = null;
  updateTrackInfo();
  const emptyVizData = { beats: [], edges: [] };
  visualizations.forEach((viz) => {
    viz.setData(emptyVizData);
    viz.reset();
  });
}

function resetSearchUI() {
  searchInput.value = "";
  searchResults.textContent = "Search results will appear here.";
  searchHint.textContent = "Step 1: Find a Spotify track.";
}

async function fetchTopSongs() {
  topSongsList.textContent = "Loading top songs…";
  try {
    const response = await fetch("/api/top?limit=20");
    if (!response.ok) {
      throw new Error(`Top songs failed (${response.status})`);
    }
    const data = await response.json();
    const items = Array.isArray(data?.items) ? data.items : [];
    if (items.length === 0) {
      topSongsList.textContent = "No plays recorded yet.";
      return;
    }
    topSongsList.innerHTML = "";
    for (const item of items.slice(0, 20)) {
      const title = typeof item.title === "string" ? item.title : "Untitled";
      const artist = typeof item.artist === "string" ? item.artist : "Unknown";
      const youtubeId =
        typeof item.youtube_id === "string" ? item.youtube_id : "";
      const li = document.createElement("li");
      if (youtubeId) {
        const link = document.createElement("a");
        link.href = `/listen/${encodeURIComponent(youtubeId)}`;
        link.textContent = `${title} — ${artist}`;
        link.addEventListener("click", (event) => {
          event.preventDefault();
          navigateToListen(youtubeId);
        });
        li.appendChild(link);
      } else {
        li.textContent = `${title} — ${artist}`;
      }
      topSongsList.appendChild(li);
    }
  } catch (err) {
    topSongsList.textContent = `Top songs unavailable: ${String(err)}`;
  }
}

async function loadTrackByYouTubeId(youtubeId: string) {
  resetForNewTrack();
  setActiveTab("play");
  setLoadingProgress(0);
  lastYouTubeId = youtubeId;
  await tryLoadCachedAudio(youtubeId);
  try {
    const response = await fetch(
      `/api/jobs/by-youtube/${encodeURIComponent(youtubeId)}`
    );
    if (response.status === 404) {
      setAnalysisStatus("Track unavailable. Try again.", false);
      navigateToTab("top", { replace: true });
      return;
    }
    if (response.ok) {
      const data = await response.json();
      if (typeof data.id === "string") {
        lastJobId = data.id;
      }
      if (response.status === 202 && data.id) {
        await pollAnalysis(data.id);
        return;
      }
      if (data.status === "complete" && data.result && data.id) {
        if (!audioLoaded) {
          await loadAudioFromJob(data.id);
        }
        applyAnalysisResult(data);
        return;
      }
      if (data.id) {
        await pollAnalysis(data.id);
        return;
      }
      setAnalysisStatus("Track unavailable. Try again.", false);
      return;
    }
    setAnalysisStatus("Track unavailable. Try again.", false);
  } catch (err) {
    setAnalysisStatus(`Load failed: ${String(err)}`, false);
  }
}

function navigateToListen(youtubeId: string) {
  updateTrackUrl(youtubeId);
  loadTrackByYouTubeId(youtubeId);
}

searchButton.addEventListener("click", () => {
  runSearch();
});

searchInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    runSearch();
  }
});

thresholdInput.addEventListener("input", () => {
  thresholdVal.textContent = thresholdInput.value;
});

minProbInput.addEventListener("input", () => {
  minProbVal.textContent = `${minProbInput.value}%`;
});

maxProbInput.addEventListener("input", () => {
  maxProbVal.textContent = `${maxProbInput.value}%`;
});

rampInput.addEventListener("input", () => {
  rampVal.textContent = `${rampInput.value}%`;
});

tuningButton.addEventListener("click", () => {
  openTuning();
});

infoButton.addEventListener("click", () => {
  openInfo();
});

fullscreenButton.addEventListener("click", () => {
  if (!document.fullscreenElement) {
    vizPanel
      .requestFullscreen()
      .then(() => {
        requestWakeLock();
      })
      .catch(() => {
        console.warn("Failed to enter fullscreen");
      });
  } else {
    document
      .exitFullscreen()
      .then(() => {
        releaseWakeLock();
      })
      .catch(() => {
        console.warn("Failed to exit fullscreen");
      });
  }
});

document.addEventListener("fullscreenchange", () => {
  if (document.fullscreenElement) {
    fullscreenButton.textContent = "Exit Fullscreen";
    requestWakeLock();
  } else {
    fullscreenButton.textContent = "Fullscreen";
    releaseWakeLock();
  }
  visualizations[activeVizIndex]?.resizeNow();
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && document.fullscreenElement) {
    requestWakeLock();
  } else if (document.hidden) {
    releaseWakeLock();
  }
});

tuningClose.addEventListener("click", () => {
  closeTuning();
});

infoClose.addEventListener("click", () => {
  closeInfo();
});

infoCloseFooter.addEventListener("click", () => {
  closeInfo();
});

tuningModal.addEventListener("click", (event) => {
  if (event.target === tuningModal) {
    closeTuning();
  }
});

infoModal.addEventListener("click", (event) => {
  if (event.target === infoModal) {
    closeInfo();
  }
});

tuningApply.addEventListener("click", () => {
  const threshold = Number(thresholdInput.value);
  let minProb = Number(minProbInput.value) / 100;
  let maxProb = Number(maxProbInput.value) / 100;
  const ramp = Number(rampInput.value) / 100;
  if (minProb > maxProb) {
    [minProb, maxProb] = [maxProb, minProb];
    minProbInput.value = `${Math.round(minProb * 100)}`;
    maxProbInput.value = `${Math.round(maxProb * 100)}`;
    minProbVal.textContent = `${minProbInput.value}%`;
    maxProbVal.textContent = `${maxProbInput.value}%`;
  }
  engine.updateConfig({
    currentThreshold: threshold,
    minRandomBranchChance: minProb,
    maxRandomBranchChance: maxProb,
    randomBranchChanceDelta: ramp,
    addLastEdge: lastEdgeInput.checked,
    justBackwards: justBackwardsInput.checked,
    justLongBranches: justLongInput.checked,
    removeSequentialBranches: removeSeqInput.checked,
  });
  engine.rebuildGraph();
  vizData = engine.getVisualizationData();
  const nextVizData = vizData;
  if (nextVizData) {
    visualizations.forEach((viz) => viz.setData(nextVizData));
  }
  const graph = engine.getGraphState();
  updateTrackInfo();
  computedThresholdEl.textContent =
    autoComputedThreshold === null ? "-" : `${autoComputedThreshold}`;
  if (threshold === 0 && graph) {
    const resolved = Math.max(0, Math.round(graph.currentThreshold));
    autoComputedThreshold = resolved;
    thresholdInput.value = `${resolved}`;
    thresholdVal.textContent = thresholdInput.value;
    engine.updateConfig({ currentThreshold: resolved });
  }
  closeTuning();
});

visualizations.forEach((viz) => {
  viz.setOnSelect((index) => {
    if (!vizData) {
      return;
    }
    const beat = vizData.beats[index];
    if (!beat) {
      return;
    }
    player.seek(beat.start);
    lastBeatIndex = index;
    visualizations[activeVizIndex]?.update(index, true, null);
  });
  viz.setOnEdgeSelect((edge) => {
    selectedEdge = edge;
    visualizations[activeVizIndex]?.setSelectedEdge(edge);
  });
});

function setActiveVisualization(index: number) {
  if (index === activeVizIndex || index < 0 || index >= visualizations.length) {
    return;
  }
  visualizations[activeVizIndex]?.setVisible(false);
  activeVizIndex = index;
  visualizations[activeVizIndex]?.setVisible(true);
  visualizations[activeVizIndex]?.resizeNow();
  if (vizData) {
    visualizations[activeVizIndex]?.setData(vizData);
  }
  visualizations[activeVizIndex]?.setSelectedEdge(
    selectedEdge && !selectedEdge.deleted ? selectedEdge : null
  );
  if (lastBeatIndex !== null) {
    visualizations[activeVizIndex]?.update(lastBeatIndex, false, null);
  }
  vizButtons.forEach((button) => {
    button.classList.toggle(
      "active",
      Number(button.dataset.viz) === activeVizIndex
    );
  });
  localStorage.setItem(vizStorageKey, String(activeVizIndex));
}

vizButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const idx = Number(button.dataset.viz);
    setActiveVisualization(idx);
  });
});

function togglePlayback() {
  if (!isRunning) {
    try {
      if (player.getDuration() === null) {
        console.warn("Audio not loaded");
        return;
      }
      engine.stopJukebox();
      engine.resetStats();
      playTimerMs = 0;
      lastPlayStamp = null;
      updateListenTimeDisplay();
      beatsPlayedEl.textContent = "0";
      lastBeatIndex = null;
      visualizations[activeVizIndex]?.reset();
      if (vizStats) {
        vizStats.classList.remove("pulse");
        void vizStats.offsetWidth;
        vizStats.classList.add("pulse");
      }

      engine.startJukebox();
      engine.play();
      lastPlayStamp = performance.now();
      isRunning = true;
      playButton.textContent = "Stop";
      if (document.fullscreenElement) {
        requestWakeLock();
      }
    } catch (err) {
      console.warn(`Play error: ${String(err)}`);
    }
  } else {
    engine.stopJukebox();
    if (lastPlayStamp !== null) {
      playTimerMs += performance.now() - lastPlayStamp;
      lastPlayStamp = null;
    }
    isRunning = false;
    playButton.textContent = "Play";
  }
}

playButton.addEventListener("click", () => {
  togglePlayback();
});

setActiveTab("top");
playTabButton.disabled = true;
setAnalysisStatus("Select a track to begin.", false);

const storedTheme = localStorage.getItem(themeStorageKey);
if (storedTheme === "light" || storedTheme === "dark") {
  applyTheme(storedTheme);
} else {
  applyTheme("dark");
}
themeLinks.forEach((link) => {
  link.addEventListener("click", () => {
    const value = link.dataset.theme === "light" ? "light" : "dark";
    applyTheme(value);
  });
});

function isEditableTarget(target: EventTarget | null): boolean {
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

window.addEventListener("keydown", (event) => {
  if (activeTabId !== "play") {
    return;
  }
  if (isEditableTarget(event.target)) {
    return;
  }
  if (event.code === "Space") {
    event.preventDefault();
    togglePlayback();
    return;
  }
  if (
    (event.key === "Delete" || event.key === "Backspace") &&
    selectedEdge &&
    !selectedEdge.deleted
  ) {
    event.preventDefault();
    engine.deleteEdge(selectedEdge);
    engine.rebuildGraph();
    vizData = engine.getVisualizationData();
    const nextVizData = vizData;
    if (nextVizData) {
      visualizations.forEach((viz) => viz.setData(nextVizData));
    }
    visualizations.forEach((viz) => viz.refresh());
    visualizations[activeVizIndex]?.resizeNow();
    updateTrackInfo();
    selectedEdge = null;
    visualizations.forEach((viz) => viz.setSelectedEdge(null));
    return;
  }
  if (event.key === "Shift" && isRunning && !shiftBranching) {
    shiftBranching = true;
    engine.setForceBranch(true);
  }
});

window.addEventListener("keyup", (event) => {
  if (event.key === "Shift" && shiftBranching) {
    shiftBranching = false;
    engine.setForceBranch(false);
  }
});

resetForNewTrack();
fetchTopSongs().catch((err) => {
  console.warn(`Top songs load failed: ${String(err)}`);
});

shortUrlButton.addEventListener("click", async () => {
  if (!lastYouTubeId) {
    setAnalysisStatus("Select a track to generate a short URL.", false);
    navigateToTab("search");
    return;
  }
  const shortUrl = `${window.location.origin}/listen/${encodeURIComponent(
    lastYouTubeId
  )}`;
  try {
    await navigator.clipboard.writeText(shortUrl);
    shortUrlButton.textContent = "Copied";
    if (shortUrlResetTimer !== null) {
      window.clearTimeout(shortUrlResetTimer);
    }
    shortUrlResetTimer = window.setTimeout(() => {
      shortUrlButton.textContent = "Copy URL";
      shortUrlResetTimer = null;
    }, 3000);
  } catch (err) {
    setAnalysisStatus(`Copy failed: ${String(err)}`, false);
  }
});

async function handleRouteChange(pathname: string) {
  const legacyTrack = new URLSearchParams(window.location.search).get("track");
  if (legacyTrack) {
    updateTrackUrl(legacyTrack, true);
    await loadTrackByYouTubeId(legacyTrack);
    return;
  }
  if (pathname.startsWith("/search")) {
    navigateToTab("search", { replace: true });
    return;
  }
  if (pathname.startsWith("/listen")) {
    const parts = pathname.split("/").filter(Boolean);
    const youtubeId = parts.length >= 2 ? parts[1] : null;
    if (youtubeId) {
      if (
        youtubeId === lastYouTubeId &&
        (audioLoaded || analysisLoaded || audioLoadInFlight || isRunning)
      ) {
        navigateToTab("play", { replace: true, youtubeId });
        return;
      }
      navigateToTab("play", { replace: true, youtubeId });
      await loadTrackByYouTubeId(youtubeId);
      return;
    }
    navigateToTab("top", { replace: true });
    return;
  }
  navigateToTab("top", { replace: true });
}

handleRouteChange(window.location.pathname);

window.addEventListener("popstate", () => {
  handleRouteChange(window.location.pathname);
});
