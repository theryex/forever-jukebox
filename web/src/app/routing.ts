import type { AppContext } from "./context";
import type { PlaybackDeps } from "./playback";
import { loadTrackByJobId, loadTrackByYouTubeId } from "./playback";
import { hasTuningParamsInUrl } from "./tuning";

function isLikelyYoutubeId(value: string) {
  return /^[a-zA-Z0-9_-]{11}$/.test(value);
}

export async function handleRouteChange(
  context: AppContext,
  deps: PlaybackDeps,
  pathname: string
) {
  const legacyTrack = new URLSearchParams(window.location.search).get("track");
  if (legacyTrack) {
    deps.updateTrackUrl(legacyTrack, true);
    await loadTrackByYouTubeId(context, deps, legacyTrack);
    return;
  }
  if (pathname.startsWith("/search")) {
    deps.navigateToTab("search", { replace: true });
    return;
  }
  if (pathname.startsWith("/listen")) {
    const parts = pathname.split("/").filter(Boolean);
    const trackId = parts.length >= 2 ? parts[1] : null;
    if (trackId) {
      const { state } = context;
      const preserveUrlTuning = hasTuningParamsInUrl();
      if (isLikelyYoutubeId(trackId)) {
        if (
          trackId === state.lastYouTubeId &&
          (state.audioLoaded ||
            state.analysisLoaded ||
            state.audioLoadInFlight ||
            state.isRunning)
        ) {
          deps.navigateToTab("play", { replace: true, youtubeId: trackId });
          return;
        }
        deps.navigateToTab("play", { replace: true, youtubeId: trackId });
        await loadTrackByYouTubeId(context, deps, trackId, {
          preserveUrlTuning,
        });
        return;
      }
      deps.navigateToTab("play", { replace: true, youtubeId: trackId });
      await loadTrackByJobId(context, deps, trackId, { preserveUrlTuning });
      return;
    }
    deps.navigateToTab("top", { replace: true });
    return;
  }
  deps.navigateToTab("top", { replace: true });
}
