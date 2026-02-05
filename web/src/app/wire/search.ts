import type { AppContext, AppState, TabId } from "../context";
import type { Elements } from "../elements";
import type { SearchDeps } from "../search";

type SearchHandlersDeps = {
  context: AppContext;
  elements: Elements;
  state: AppState;
  searchDeps: SearchDeps;
  runSearch: (context: AppContext, deps: SearchDeps) => Promise<void>;
  showToast: (context: AppContext, message: string, options?: { icon?: string }) => void;
  uploadAudio: (file: File) => Promise<{ id?: string } | null>;
  startYoutubeAnalysis: (payload: {
    youtube_id: string;
    is_user_supplied?: boolean;
  }) => Promise<{ id?: string } | null>;
  resetForNewTrack: (context: AppContext) => void;
  setActiveTabWithRefresh: (tabId: TabId) => void;
  setLoadingProgress: (
    context: AppContext,
    progress: number | null,
    message?: string | null,
  ) => void;
  updateTrackUrl: (
    youtubeId: string,
    replace?: boolean,
    tuningParams?: string | null,
    playMode?: "jukebox" | "autocanonizer",
  ) => void;
  pollAnalysisJob: (jobId: string) => Promise<void>;
};

export type SearchHandlers = ReturnType<typeof createSearchHandlers>;

export function createSearchHandlers(deps: SearchHandlersDeps) {
  const {
    context,
    elements,
    state,
    searchDeps,
    runSearch,
    showToast,
    uploadAudio,
    startYoutubeAnalysis,
    resetForNewTrack,
    setActiveTabWithRefresh,
    setLoadingProgress,
    updateTrackUrl,
    pollAnalysisJob,
  } = deps;

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
      state.pendingAutoFavoriteId = response.id;
      state.lastYouTubeId = null;
      state.audioLoaded = false;
      state.analysisLoaded = false;
      updateTrackUrl(response.id, true, state.tuningParams, state.playMode);
      elements.uploadFileInput.value = "";
      setActiveTabWithRefresh("play");
      setLoadingProgress(context, null, "Queued");
      await pollAnalysisJob(response.id);
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
      state.pendingAutoFavoriteId = youtubeId;
      elements.uploadYoutubeInput.value = "";
      updateTrackUrl(youtubeId, true, state.tuningParams, state.playMode);
      setActiveTabWithRefresh("play");
      setLoadingProgress(context, null, "Fetching audio");
      await pollAnalysisJob(response.id);
    } catch (err) {
      showToast(context, `Upload failed: ${String(err)}`);
    } finally {
      elements.uploadYoutubeButton.disabled = false;
      elements.uploadYoutubeButton.textContent = originalLabel;
    }
  }

  return {
    handleSearchClick,
    handleSearchKeydown,
    handleUploadFileClick,
    handleUploadYoutubeClick,
  };
}
