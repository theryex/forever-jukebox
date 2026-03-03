import type { AppContext } from "./context";
import { SEARCH_RESULTS_LIMIT } from "./constants";
import { formatTrackDuration } from "./format";
import {
  fetchJobByYoutube,
  searchYoutube,
  startYoutubeAnalysis,
  type AnalysisComplete,
  type AnalysisFailed,
  type AnalysisInProgress,
  type AnalysisResponse,
} from "./api";
import { tryLoadCachedAudio } from "./playback";

export type SearchDeps = {
  setActiveTab: (tabId: "top" | "search" | "play" | "faq") => void;
  navigateToTab: (
    tabId: "top" | "search" | "play" | "faq",
    options?: { replace?: boolean; youtubeId?: string | null }
  ) => void;
  updateTrackUrl: (youtubeId: string, replace?: boolean) => void;
  setAnalysisStatus: (message: string, spinning: boolean) => void;
  setLoadingProgress: (progress: number | null, message?: string | null) => void;
  pollAnalysis: (jobId: string) => Promise<void>;
  applyAnalysisResult: (response: AnalysisComplete) => boolean;
  loadAudioFromJob: (jobId: string) => Promise<boolean>;
  resetForNewTrack: (options?: { clearTuning?: boolean }) => void;
  updateVizVisibility: () => void;
  onTrackChange?: (youtubeId: string | null) => void;
};

function isAnalysisComplete(response: AnalysisResponse | null): response is AnalysisComplete {
  return response?.status === "complete";
}

function isAnalysisFailed(response: AnalysisResponse | null): response is AnalysisFailed {
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

export async function startYoutubeAnalysisFlow(
  context: AppContext,
  deps: SearchDeps,
  youtubeId: string,
  title: string,
  artist: string
) {
  deps.resetForNewTrack({ clearTuning: true });
  resetSearchUI(context);
  context.state.audioLoaded = false;
  context.state.analysisLoaded = false;
  deps.updateVizVisibility();
  deps.setActiveTab("play");
  deps.setLoadingProgress(null, "Fetching audio");
  context.state.lastYouTubeId = youtubeId;
  deps.onTrackChange?.(youtubeId);
  deps.updateTrackUrl(youtubeId);
  await tryLoadCachedAudio(context, youtubeId);
  const payload = { youtube_id: youtubeId, title, artist };
  const response = await startYoutubeAnalysis(payload);
  if (!response || !response.id) {
    throw new Error("Invalid job response");
  }
  if (isAnalysisInProgress(response)) {
    const progress =
      typeof response.progress === "number" ? response.progress : null;
    deps.setLoadingProgress(progress, response.message);
  }
  context.state.lastJobId = response.id;
  await deps.pollAnalysis(response.id);
}

export async function tryLoadExistingTrackByYoutube(
  context: AppContext,
  deps: SearchDeps,
  youtubeId: string,
  _title: string,
) {
  const { state } = context;
  try {
    const response = await fetchJobByYoutube(youtubeId);
    if (!response || !response.id) {
      return false;
    }
    const jobId = response.id;
    deps.resetForNewTrack({ clearTuning: true });
    resetSearchUI(context);
    state.audioLoaded = false;
    state.analysisLoaded = false;
    deps.updateVizVisibility();
    deps.setActiveTab("play");
    deps.setLoadingProgress(null, "Fetching audio");
    state.lastYouTubeId = youtubeId;
    deps.onTrackChange?.(youtubeId);
    deps.updateTrackUrl(youtubeId);
    state.lastJobId = jobId;
    if (isAnalysisInProgress(response)) {
      await deps.pollAnalysis(jobId);
      return true;
    }
    if (isAnalysisFailed(response)) {
      return false;
    }
    if (isAnalysisComplete(response)) {
      if (!state.audioLoaded) {
        const audioLoaded = await deps.loadAudioFromJob(jobId);
        if (!audioLoaded) {
          await deps.pollAnalysis(jobId);
          return true;
        }
      }
      deps.applyAnalysisResult(response);
      return true;
    }
    await deps.pollAnalysis(jobId);
    return true;
  } catch {
    return false;
  }
}

export async function runSearch(context: AppContext, deps: SearchDeps) {
  const { elements } = context;
  const query = elements.searchInput.value.trim();
  if (!query) {
    elements.searchResults.textContent = "Enter a search query.";
    return;
  }
  elements.searchButton.disabled = true;
  elements.searchResults.textContent = "Searching YouTube...";
  elements.searchHint.textContent = "Search YouTube by artist or track name.";
  try {
    const items = (await searchYoutube(query, 0)).slice(0, SEARCH_RESULTS_LIMIT);
    if (items.length === 0) {
      elements.searchResults.textContent = "No YouTube results found.";
      return;
    }
    elements.searchResults.innerHTML = "";
    const list = document.createElement("ol");
    list.className = "search-list";
    for (const item of items) {
      const title = typeof item.title === "string" ? item.title : "Untitled";
      const ytDuration =
        typeof item.duration === "number" ? item.duration : null;
      const li = document.createElement("li");
      li.className = "search-item";
      li.dataset.youtubeId = item.id ? String(item.id) : "";
      li.dataset.trackName = title;
      const titleSpan = document.createElement("strong");
      titleSpan.textContent = title;
      const durationSpan = document.createElement("span");
      durationSpan.textContent = formatTrackDuration(ytDuration);
      const metaWrap = document.createElement("span");
      metaWrap.className = "search-meta";
      metaWrap.append(durationSpan);
      if (item.id) {
        const openLink = document.createElement("a");
        openLink.className = "search-open";
        openLink.href = `https://www.youtube.com/watch?v=${encodeURIComponent(String(item.id))}`;
        openLink.target = "_blank";
        openLink.rel = "noreferrer";
        openLink.title = "Open on YouTube";
        openLink.addEventListener("click", (event) => {
          event.stopPropagation();
        });
        const openIcon = document.createElement("span");
        openIcon.className = "material-symbols-outlined search-open-icon";
        openIcon.setAttribute("aria-hidden", "true");
        openIcon.textContent = "open_in_new";
        openLink.append(openIcon);
        metaWrap.append(openLink);
      }
      li.append(titleSpan, metaWrap);
      function handleClick(event: Event) {
        handleYoutubeResultClick(context, deps, event);
      }
      li.addEventListener("click", handleClick);
      list.append(li);
    }
    elements.searchResults.append(list);
  } catch (err) {
    elements.searchResults.textContent = `YouTube search failed: ${String(err)}`;
  } finally {
    elements.searchButton.disabled = false;
  }
}

export function resetSearchUI(context: AppContext) {
  const { elements } = context;
  elements.searchInput.value = "";
  elements.searchResults.textContent = "Search results will appear here.";
  elements.searchHint.textContent = "Search YouTube by artist or track name.";
}

function handleYoutubeResultClick(
  context: AppContext,
  deps: SearchDeps,
  event: Event
) {
  const target = event.currentTarget as HTMLLIElement | null;
  const youtubeId = target?.dataset.youtubeId;
  const name = target?.dataset.trackName ?? "";
  if (!youtubeId) {
    deps.setAnalysisStatus("No YouTube id available.", false);
    return;
  }
  tryLoadExistingTrackByYoutube(context, deps, youtubeId, name).then((loaded) => {
    if (loaded) {
      return;
    }
    startYoutubeAnalysisFlow(context, deps, youtubeId, name, "").catch((err) => {
      deps.setAnalysisStatus(`YouTube analysis failed: ${String(err)}`, false);
    });
  });
}
