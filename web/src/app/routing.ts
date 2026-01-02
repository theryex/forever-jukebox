import type { AppContext } from "./context";
import type { PlaybackDeps } from "./playback";
import { loadTrackByYouTubeId } from "./playback";

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
    const youtubeId = parts.length >= 2 ? parts[1] : null;
    if (youtubeId) {
      const { state } = context;
      if (
        youtubeId === state.lastYouTubeId &&
        (state.audioLoaded ||
          state.analysisLoaded ||
          state.audioLoadInFlight ||
          state.isRunning)
      ) {
        deps.navigateToTab("play", { replace: true, youtubeId });
        return;
      }
      deps.navigateToTab("play", { replace: true, youtubeId });
      await loadTrackByYouTubeId(context, deps, youtubeId);
      return;
    }
    deps.navigateToTab("top", { replace: true });
    return;
  }
  deps.navigateToTab("top", { replace: true });
}
