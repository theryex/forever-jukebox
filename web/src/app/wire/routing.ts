import type { AppContext } from "../context";
import type { PlaybackUiHandlers } from "./playback";
import type { PlaybackDeps } from "../playback";

type RoutingDeps = {
  context: AppContext;
  playbackHandlers: Pick<PlaybackUiHandlers, "applyModeFromUrl">;
  handleRouteChange: (
    context: AppContext,
    playbackDeps: PlaybackDeps,
    path: string,
  ) => Promise<void>;
  playbackDeps: PlaybackDeps;
  onFaqOpen?: () => void;
};

export type RoutingHandlers = ReturnType<typeof createRoutingHandlers>;

export function createRoutingHandlers(deps: RoutingDeps) {
  const {
    context,
    playbackHandlers,
    handleRouteChange,
    playbackDeps,
    onFaqOpen,
  } = deps;

  function handlePopState() {
    const path = window.location.pathname;
    playbackHandlers.applyModeFromUrl();
    handleRouteChange(context, playbackDeps, path)
      .then(() => {
        if (path.startsWith("/faq")) {
          onFaqOpen?.();
        }
      })
      .catch((err) => {
        console.warn(`Route load failed: ${String(err)}`);
      });
  }

  return { handlePopState };
}
