import type { AppContext } from "./context";
import {
  ANALYSIS_POLL_INTERVAL_MS,
  LISTEN_TIMER_INTERVAL_MS,
} from "./constants";
import { formatDuration } from "./format";
import {
  fetchAnalysis,
  fetchAudio,
  fetchJobByYoutube,
  recordPlay,
  repairJob,
  type AnalysisComplete,
  type AnalysisFailed,
  type AnalysisInProgress,
  type AnalysisResponse,
} from "./api";
import { readCachedTrack, updateCachedTrack } from "./cache";

export type PlaybackDeps = {
  setActiveTab: (tabId: "top" | "search" | "play" | "faq") => void;
  navigateToTab: (
    tabId: "top" | "search" | "play" | "faq",
    options?: { replace?: boolean; youtubeId?: string | null }
  ) => void;
  updateTrackUrl: (youtubeId: string, replace?: boolean) => void;
  setAnalysisStatus: (message: string, spinning: boolean) => void;
  setLoadingProgress: (
    progress: number | null,
    message?: string | null
  ) => void;
  onTrackChange?: (youtubeId: string | null) => void;
  onAnalysisLoaded?: (response: AnalysisComplete) => void;
};

export function updateListenTimeDisplay(context: AppContext) {
  const { elements, state } = context;
  const now = performance.now();
  const totalMs =
    state.playTimerMs +
    (state.lastPlayStamp !== null ? now - state.lastPlayStamp : 0);
  elements.listenTimeEl.textContent = formatDuration(totalMs / 1000);
}

function maybeUpdateDeleteEligibility(
  context: AppContext,
  response: AnalysisResponse | null,
  jobIdOverride?: string | null
) {
  if (!response) {
    return;
  }
  const { state, elements } = context;
  const jobId = jobIdOverride ?? ("id" in response ? response.id : undefined);
  if (!jobId || state.deleteEligibilityJobId === jobId) {
    return;
  }
  let eligible = false;
  const createdAt =
    "created_at" in response ? response.created_at : undefined;
  if (typeof createdAt === "string") {
    const createdMs = Date.parse(createdAt);
    if (!Number.isNaN(createdMs)) {
      const ageMs = Date.now() - createdMs;
      eligible = ageMs <= 30 * 60 * 1000;
    }
  } else {
    state.deleteEligible = false;
    elements.deleteButton.classList.add("hidden");
    state.deleteEligibilityJobId = null;
    return;
  }
  state.deleteEligibilityJobId = jobId;
  state.deleteEligible = eligible;
  elements.deleteButton.classList.toggle("hidden", !eligible);
}

export function updateTrackInfo(context: AppContext) {
  const { elements, engine, player, state } = context;
  const graph = engine.getGraphState();
  const resolvedDuration =
    typeof state.trackDurationSec === "number" &&
    Number.isFinite(state.trackDurationSec)
      ? state.trackDurationSec
      : player.getDuration();
  elements.infoDurationEl.textContent =
    typeof resolvedDuration === "number" && Number.isFinite(resolvedDuration)
      ? formatDuration(resolvedDuration)
      : "00:00:00";
  elements.infoBeatsEl.textContent = `${graph ? graph.totalBeats : 0}`;
  const branchCount = state.vizData
    ? state.vizData.edges.length
    : graph
    ? graph.allEdges.filter((edge) => !edge.deleted).length
    : 0;
  elements.infoBranchesEl.textContent = `${branchCount}`;
}

export function updateVizVisibility(context: AppContext) {
  const { elements, visualizations, state } = context;
  const hasTrack = Boolean(state.lastYouTubeId || state.lastJobId);
  if (state.audioLoaded && state.analysisLoaded) {
    elements.playStatusPanel.classList.add("hidden");
    elements.playMenu.classList.remove("hidden");
    elements.vizPanel.classList.remove("hidden");
    elements.playButton.classList.remove("hidden");
    updatePlayButton(context, state.isRunning);
    elements.playTabButton.disabled = false;
    visualizations[state.activeVizIndex]?.resizeNow();
    elements.vizButtons.forEach((button) => {
      button.disabled = false;
    });
  } else {
    elements.playStatusPanel.classList.remove("hidden");
    elements.playMenu.classList.add("hidden");
    elements.vizPanel.classList.add("hidden");
    elements.playButton.classList.add("hidden");
    elements.playTabButton.disabled = !hasTrack;
    elements.vizButtons.forEach((button) => {
      button.disabled = true;
    });
  }
}

export function openTuning(context: AppContext) {
  syncTuningUI(context);
  context.elements.tuningModal.classList.add("open");
}

export function closeTuning(context: AppContext) {
  context.elements.tuningModal.classList.remove("open");
}

export function openInfo(context: AppContext) {
  updateTrackInfo(context);
  context.elements.infoModal.classList.add("open");
}

export function closeInfo(context: AppContext) {
  context.elements.infoModal.classList.remove("open");
}

export function syncTuningUI(context: AppContext) {
  const { elements, engine, state } = context;
  const config = engine.getConfig();
  const graph = engine.getGraphState();
  const thresholdValue =
    config.currentThreshold === 0 && graph
      ? Math.round(graph.currentThreshold)
      : config.currentThreshold;
  elements.thresholdInput.value = `${thresholdValue}`;
  elements.thresholdVal.textContent = elements.thresholdInput.value;
  const minProbPct = Math.round(config.minRandomBranchChance * 100);
  const maxProbPct = Math.round(config.maxRandomBranchChance * 100);
  const rampPct = Math.round(config.randomBranchChanceDelta * 1000) / 10;
  elements.minProbInput.value = `${minProbPct}`;
  elements.minProbVal.textContent = `${minProbPct}%`;
  elements.maxProbInput.value = `${maxProbPct}`;
  elements.maxProbVal.textContent = `${maxProbPct}%`;
  elements.rampInput.value = `${rampPct}`;
  elements.rampVal.textContent = `${rampPct}%`;
  elements.lastEdgeInput.checked = config.addLastEdge;
  elements.justBackwardsInput.checked = config.justBackwards;
  elements.justLongInput.checked = config.justLongBranches;
  elements.removeSeqInput.checked = config.removeSequentialBranches;
  const computedValue =
    state.autoComputedThreshold ??
    (graph ? Math.round(graph.currentThreshold) : null);
  elements.computedThresholdEl.textContent =
    computedValue === null ? "-" : `${computedValue}`;
}

export function applyTuningChanges(context: AppContext) {
  const { elements, engine, state, visualizations } = context;
  const threshold = Number(elements.thresholdInput.value);
  let minProb = Number(elements.minProbInput.value) / 100;
  let maxProb = Number(elements.maxProbInput.value) / 100;
  const ramp = Number(elements.rampInput.value) / 100;
  if (minProb > maxProb) {
    [minProb, maxProb] = [maxProb, minProb];
    elements.minProbInput.value = `${Math.round(minProb * 100)}`;
    elements.maxProbInput.value = `${Math.round(maxProb * 100)}`;
    elements.minProbVal.textContent = `${elements.minProbInput.value}%`;
    elements.maxProbVal.textContent = `${elements.maxProbInput.value}%`;
  }
  engine.updateConfig({
    currentThreshold: threshold,
    minRandomBranchChance: minProb,
    maxRandomBranchChance: maxProb,
    randomBranchChanceDelta: ramp,
    addLastEdge: elements.lastEdgeInput.checked,
    justBackwards: elements.justBackwardsInput.checked,
    justLongBranches: elements.justLongInput.checked,
    removeSequentialBranches: elements.removeSeqInput.checked,
  });
  engine.rebuildGraph();
  state.vizData = engine.getVisualizationData();
  const data = state.vizData;
  if (data) {
    visualizations.forEach((viz) => viz.setData(data));
  }
  const graph = engine.getGraphState();
  updateTrackInfo(context);
  elements.computedThresholdEl.textContent =
    state.autoComputedThreshold === null
      ? "-"
      : `${state.autoComputedThreshold}`;
  if (threshold === 0 && graph) {
    const resolved = Math.max(0, Math.round(graph.currentThreshold));
    state.autoComputedThreshold = resolved;
    elements.thresholdInput.value = `${resolved}`;
    elements.thresholdVal.textContent = elements.thresholdInput.value;
    engine.updateConfig({ currentThreshold: resolved });
  }
  closeTuning(context);
}

export function startListenTimer(context: AppContext) {
  const { state } = context;
  if (state.listenTimerId !== null) {
    return;
  }
  state.listenTimerId = window.setInterval(() => {
    updateListenTimeDisplay(context);
  }, LISTEN_TIMER_INTERVAL_MS);
}

export function stopListenTimer(context: AppContext) {
  const { state } = context;
  if (state.listenTimerId === null) {
    return;
  }
  window.clearInterval(state.listenTimerId);
  state.listenTimerId = null;
}

export function stopPlayback(context: AppContext) {
  const { engine, state } = context;
  engine.stopJukebox();
  if (state.lastPlayStamp !== null) {
    state.playTimerMs += performance.now() - state.lastPlayStamp;
    state.lastPlayStamp = null;
  }
  state.isRunning = false;
  stopListenTimer(context);
  updateListenTimeDisplay(context);
  updatePlayButton(context, false);
}

export function togglePlayback(context: AppContext) {
  const { engine, elements, visualizations, player, state } = context;
  if (!state.isRunning) {
    try {
      if (player.getDuration() === null) {
        console.warn("Audio not loaded");
        return;
      }
      engine.stopJukebox();
      engine.resetStats();
      state.playTimerMs = 0;
      state.lastPlayStamp = null;
      updateListenTimeDisplay(context);
      elements.beatsPlayedEl.textContent = "0";
      state.lastBeatIndex = null;
      visualizations[state.activeVizIndex]?.reset();
      if (elements.vizStats) {
        elements.vizStats.classList.remove("pulse");
        void elements.vizStats.offsetWidth;
        elements.vizStats.classList.add("pulse");
      }

      engine.startJukebox();
      engine.play();
      state.lastPlayStamp = performance.now();
      state.isRunning = true;
      startListenTimer(context);
      updatePlayButton(context, true);
      if (document.fullscreenElement) {
        requestWakeLock(context);
      }
    } catch (err) {
      console.warn(`Play error: ${String(err)}`);
    }
  } else {
    stopPlayback(context);
  }
}

function updatePlayButton(context: AppContext, isRunning: boolean) {
  const label = isRunning ? "Stop" : "Play";
  const updateButton = (button: HTMLButtonElement) => {
    const icon = button.querySelector<HTMLSpanElement>(".play-icon");
    const text = button.querySelector<HTMLSpanElement>(".play-text");
    if (icon) {
      icon.textContent = isRunning ? "stop" : "play_arrow";
    }
    if (text) {
      text.textContent = label;
    }
    button.title = label;
    button.setAttribute("aria-label", label);
  };
  updateButton(context.elements.playButton);
  updateButton(context.elements.vizPlayButton);
  const shouldPulse = isRunning && context.state.activeTabId !== "play";
  context.elements.playTabButton.classList.toggle("is-playing", shouldPulse);
}

export function resetForNewTrack(context: AppContext) {
  const { elements, engine, visualizations, state, defaultConfig } = context;
  cancelPoll(context);
  state.shiftBranching = false;
  engine.setForceBranch(false);
  state.selectedEdge = null;
  visualizations.forEach((viz) => viz.setSelectedEdge(null));
  engine.clearDeletedEdges();
  state.audioLoaded = false;
  state.analysisLoaded = false;
  state.audioLoadInFlight = false;
  state.lastJobId = null;
  state.lastYouTubeId = null;
  state.lastPlayCountedJobId = null;
  updateVizVisibility(context);
  state.playTimerMs = 0;
  state.lastPlayStamp = null;
  state.lastBeatIndex = null;
  updateListenTimeDisplay(context);
  elements.beatsPlayedEl.textContent = "0";
  elements.vizNowPlayingEl.textContent = "The Forever Jukebox";
  if (elements.tuningModal.classList.contains("open")) {
    elements.tuningModal.classList.remove("open");
  }
  if (elements.infoModal.classList.contains("open")) {
    elements.infoModal.classList.remove("open");
  }
  if (state.isRunning) {
    stopPlayback(context);
  }
  state.autoComputedThreshold = null;
  elements.computedThresholdEl.textContent = "-";
  engine.updateConfig({ ...defaultConfig });
  syncTuningUI(context);
  elements.playTitle.textContent = "";
  state.trackDurationSec = null;
  state.trackTitle = null;
  state.trackArtist = null;
  state.deleteEligible = false;
  state.deleteEligibilityJobId = null;
  elements.deleteButton.classList.add("hidden");
  state.vizData = null;
  updateTrackInfo(context);
  const emptyVizData = { beats: [], edges: [] };
  visualizations.forEach((viz) => {
    viz.setData(emptyVizData);
    viz.reset();
  });
}

export async function loadAudioFromJob(context: AppContext, jobId: string) {
  const { player, state } = context;
  try {
    const buffer = await fetchAudio(jobId);
    await player.decode(buffer);
    state.audioLoaded = true;
    state.audioLoadInFlight = false;
    updateVizVisibility(context);
    updateTrackInfo(context);
    const cacheId = state.lastYouTubeId ?? state.lastJobId;
    if (cacheId) {
      updateCachedTrack(cacheId, { audio: buffer, jobId }).catch((err) => {
        console.warn(`Cache save failed: ${String(err)}`);
      });
    }
    return true;
  } catch (err) {
    const status = (err as Error & { status?: number }).status;
    if (status === 404) {
      try {
        await repairJob(jobId);
      } catch (repairErr) {
        console.warn(`Repair failed: ${String(repairErr)}`);
      }
    }
    state.audioLoadInFlight = false;
    return false;
  }
}

function isAnalysisComplete(
  response: AnalysisResponse | null
): response is AnalysisComplete {
  return response?.status === "complete";
}

function isAnalysisFailed(
  response: AnalysisResponse | null
): response is AnalysisFailed {
  return response?.status === "failed";
}

function isAnalysisInProgress(
  response: AnalysisResponse | null
): response is AnalysisInProgress {
  return (
    response?.status === "downloading" ||
    response?.status === "queued" ||
    response?.status === "processing"
  );
}

export function applyAnalysisResult(
  context: AppContext,
  response: AnalysisComplete,
  onAnalysisLoaded?: (response: AnalysisComplete) => void
): boolean {
  if (!response || response.status !== "complete" || !response.result) {
    return false;
  }
  maybeUpdateDeleteEligibility(context, response, response.id);
  const { elements, engine, state, visualizations } = context;
  engine.loadAnalysis(response.result);
  const graph = engine.getGraphState();
  state.autoComputedThreshold = graph
    ? Math.round(graph.currentThreshold)
    : null;
  state.vizData = engine.getVisualizationData();
  const data = state.vizData;
  if (data) {
    visualizations.forEach((viz) => viz.setData(data));
  }
  state.selectedEdge = null;
  visualizations.forEach((viz) => viz.setSelectedEdge(null));
  state.analysisLoaded = true;
  updateVizVisibility(context);
  const resultTrack = response.result.track ?? null;
  const track = resultTrack ?? response.track;
  const title = track?.title;
  const artist = track?.artist;
  state.trackTitle = typeof title === "string" ? title : null;
  state.trackArtist = typeof artist === "string" ? artist : null;
  state.trackDurationSec =
    typeof track?.duration === "number" && Number.isFinite(track.duration)
      ? track.duration
      : null;
  if (title || artist) {
    const displayTitle = artist
      ? `${title ?? "Unknown"} — ${artist}`
      : `${title}`;
    elements.playTitle.textContent = displayTitle;
    elements.vizNowPlayingEl.textContent = displayTitle;
  } else {
    elements.playTitle.textContent = "";
    elements.vizNowPlayingEl.textContent = "The Forever Jukebox";
  }
  updateTrackInfo(context);
  onAnalysisLoaded?.(response);
  const jobId = response.id || state.lastJobId;
  if (jobId) {
    recordPlayOnce(context, jobId).catch((err) => {
      console.warn(`Failed to record play: ${String(err)}`);
    });
  }
  return true;
}

async function recordPlayOnce(context: AppContext, jobId: string) {
  const { state } = context;
  if (state.lastPlayCountedJobId === jobId) {
    return;
  }
  state.lastPlayCountedJobId = jobId;
  try {
    await recordPlay(jobId);
  } catch (err) {
    state.lastPlayCountedJobId = null;
    throw err;
  }
}

export async function pollAnalysis(
  context: AppContext,
  deps: PlaybackDeps,
  jobId: string
) {
  const { state } = context;
  const controller = new AbortController();
  state.pollController?.abort();
  state.pollController = controller;
  try {
    while (true) {
      if (controller.signal.aborted) {
        return;
      }
      const response = await fetchAnalysis(jobId, controller.signal);
      if (!response) {
        deps.setAnalysisStatus(
          "ERROR: Something went wrong. Please try again or report an issue on GitHub.",
          false
        );
        return;
      }
      maybeUpdateDeleteEligibility(context, response, jobId);
      if (isAnalysisInProgress(response)) {
        const progress =
          typeof response.progress === "number" ? response.progress : null;
        deps.setLoadingProgress(progress, response.message);
        if (
          response.status !== "downloading" &&
          !state.audioLoaded &&
          !state.audioLoadInFlight
        ) {
          state.audioLoadInFlight = true;
          await loadAudioFromJob(context, jobId);
        }
      } else if (isAnalysisFailed(response)) {
        if (response.error_code === "analysis_missing" && response.id) {
          try {
            await repairJob(response.id);
            continue;
          } catch (err) {
            console.warn(`Repair failed: ${String(err)}`);
          }
        }
        deps.setAnalysisStatus(response.error || "Loading failed.", false);
        return;
      } else if (isAnalysisComplete(response)) {
        if (!state.audioLoaded) {
          const audioLoaded = await loadAudioFromJob(context, jobId);
          if (!audioLoaded) {
            await delay(ANALYSIS_POLL_INTERVAL_MS, controller.signal);
            continue;
          }
        }
        deps.setLoadingProgress(100, "Calculating pathways");
        if (applyAnalysisResult(context, response, deps.onAnalysisLoaded)) {
          deps.setActiveTab("play");
          return;
        }
      }
      await delay(ANALYSIS_POLL_INTERVAL_MS, controller.signal);
      if (controller.signal.aborted) {
        return;
      }
    }
  } finally {
    if (state.pollController === controller) {
      state.pollController = null;
    }
  }
}

export async function loadTrackByYouTubeId(
  context: AppContext,
  deps: PlaybackDeps,
  youtubeId: string
) {
  resetForNewTrack(context);
  deps.setActiveTab("play");
  deps.setLoadingProgress(null, "Fetching audio");
  context.state.lastYouTubeId = youtubeId;
  deps.onTrackChange?.(youtubeId);
  await tryLoadCachedAudio(context, youtubeId);
  try {
    const response = await fetchJobByYoutube(youtubeId);
    if (!response || !response.id) {
      deps.setAnalysisStatus(
        "ERROR: Something went wrong. Please try again or report an issue on GitHub.",
        false
      );
      return;
    }
    maybeUpdateDeleteEligibility(context, response, response.id);
    context.state.lastJobId = response.id;
    if (isAnalysisInProgress(response)) {
      await pollAnalysis(context, deps, response.id);
      return;
    }
    if (isAnalysisComplete(response) && response.id) {
      if (!context.state.audioLoaded) {
        const audioLoaded = await loadAudioFromJob(context, response.id);
        if (!audioLoaded) {
          await pollAnalysis(context, deps, response.id);
          return;
        }
      }
      applyAnalysisResult(context, response, deps.onAnalysisLoaded);
      deps.setActiveTab("play");
      return;
    }
    if (response.id) {
      await pollAnalysis(context, deps, response.id);
      return;
    }
    deps.setAnalysisStatus(
      "ERROR: Something went wrong. Please try again or report an issue on GitHub.",
      false
    );
  } catch (err) {
    deps.setAnalysisStatus(`Load failed: ${String(err)}`, false);
  }
}

export async function loadTrackByJobId(
  context: AppContext,
  deps: PlaybackDeps,
  jobId: string
) {
  resetForNewTrack(context);
  deps.setActiveTab("play");
  deps.setLoadingProgress(null, "Fetching audio");
  context.state.lastJobId = jobId;
  context.state.lastYouTubeId = null;
  deps.onTrackChange?.(null);
  await tryLoadCachedAudio(context, jobId);
  try {
    const response = await fetchAnalysis(jobId);
    if (!response || !response.id) {
      deps.setAnalysisStatus(
        "ERROR: Something went wrong. Please try again or report an issue on GitHub.",
        false
      );
      return;
    }
    maybeUpdateDeleteEligibility(context, response, response.id);
    if (isAnalysisInProgress(response)) {
      await pollAnalysis(context, deps, response.id);
      return;
    }
    if (isAnalysisComplete(response)) {
      if (!context.state.audioLoaded) {
        const audioLoaded = await loadAudioFromJob(context, response.id);
        if (!audioLoaded) {
          await pollAnalysis(context, deps, response.id);
          return;
        }
      }
      applyAnalysisResult(context, response, deps.onAnalysisLoaded);
      deps.setActiveTab("play");
      return;
    }
    if (response.id) {
      await pollAnalysis(context, deps, response.id);
      return;
    }
    deps.setAnalysisStatus(
      "ERROR: Something went wrong. Please try again or report an issue on GitHub.",
      false
    );
  } catch (err) {
    deps.setAnalysisStatus(`Load failed: ${String(err)}`, false);
  }
}

export function requestWakeLock(context: AppContext) {
  if (!("wakeLock" in navigator)) {
    return;
  }
  navigator.wakeLock
    .request("screen")
    .then((lock) => {
      context.state.wakeLock = lock;
      function onRelease() {
        handleWakeLockRelease(context);
      }
      context.state.wakeLock.addEventListener("release", onRelease);
    })
    .catch(() => {
      console.warn("Wake lock unavailable");
    });
}

function handleWakeLockRelease(context: AppContext) {
  context.state.wakeLock = null;
}

export function releaseWakeLock(context: AppContext) {
  if (!context.state.wakeLock) {
    return;
  }
  context.state.wakeLock.release().catch(() => {
    console.warn("Failed to release wake lock");
  });
  context.state.wakeLock = null;
}

export function cancelPoll(context: AppContext) {
  if (!context.state.pollController) {
    return;
  }
  context.state.pollController.abort();
  context.state.pollController = null;
}

export function delay(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timer = window.setTimeout(resolve, ms);
    if (!signal) {
      return;
    }
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
  });
}

export async function tryLoadCachedAudio(
  context: AppContext,
  youtubeId: string
) {
  const { player, state } = context;
  try {
    const cached = await readCachedTrack(youtubeId);
    if (!cached?.audio) {
      return false;
    }
    state.lastJobId = cached.jobId ?? null;
    await player.decode(cached.audio);
    state.audioLoaded = true;
    state.audioLoadInFlight = false;
    updateVizVisibility(context);
    updateTrackInfo(context);
    return true;
  } catch (err) {
    console.warn(`Cache lookup failed: ${String(err)}`);
    return false;
  }
}
