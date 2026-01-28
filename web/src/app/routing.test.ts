import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "./context";
import type { PlaybackDeps } from "./playback";
import { handleRouteChange } from "./routing";
import { setWindowUrl } from "./__tests__/test-utils";

vi.mock("./playback", () => ({
  loadTrackByYouTubeId: vi.fn(),
  loadTrackByJobId: vi.fn(),
}));

let playbackModule: typeof import("./playback");

function createContext(): AppContext {
  return {
    elements: {
      canonizerFinish: { checked: false, addEventListener: vi.fn() },
    } as unknown as AppContext["elements"],
    engine: {} as AppContext["engine"],
    player: {} as AppContext["player"],
    autocanonizer: {} as AppContext["autocanonizer"],
    jukebox: { refresh: vi.fn() } as unknown as AppContext["jukebox"],
    defaultConfig: {} as AppContext["defaultConfig"],
    state: {
      playMode: "jukebox",
      lastYouTubeId: null,
      lastJobId: null,
      audioLoaded: false,
      analysisLoaded: false,
      audioLoadInFlight: false,
      isRunning: false,
    } as unknown as AppContext["state"],
  };
}

function createDeps(): PlaybackDeps {
  return {
    setActiveTab: vi.fn(),
    navigateToTab: vi.fn(),
    updateTrackUrl: vi.fn(),
    setAnalysisStatus: vi.fn(),
    setLoadingProgress: vi.fn(),
  };
}

describe("routing", () => {
  beforeEach(async () => {
    setWindowUrl("http://localhost/");
    playbackModule = await import("./playback");
    vi.clearAllMocks();
  });

  it("handles legacy track param", async () => {
    setWindowUrl("http://localhost/?track=abc123");
    const context = createContext();
    const deps = createDeps();
    await handleRouteChange(context, deps, "/");
    expect(deps.updateTrackUrl).toHaveBeenCalledWith("abc123", true);
    expect(playbackModule.loadTrackByYouTubeId).toHaveBeenCalled();
  });

  it("loads youtube id from /listen and preserves tuning params", async () => {
    setWindowUrl("http://localhost/listen/abc123def45?jb=1");
    const context = createContext();
    const deps = createDeps();
    await handleRouteChange(context, deps, "/listen/abc123def45");
    expect(deps.navigateToTab).toHaveBeenCalledWith("play", {
      replace: true,
      youtubeId: "abc123def45",
    });
    expect(playbackModule.loadTrackByYouTubeId).toHaveBeenCalledWith(
      context,
      deps,
      "abc123def45",
      { preserveUrlTuning: true },
    );
  });

  it("loads job id from /listen", async () => {
    setWindowUrl("http://localhost/listen/job123");
    const context = createContext();
    const deps = createDeps();
    await handleRouteChange(context, deps, "/listen/job123");
    expect(playbackModule.loadTrackByJobId).toHaveBeenCalledWith(
      context,
      deps,
      "job123",
      { preserveUrlTuning: false },
    );
  });

  it("routes to search tab", async () => {
    const context = createContext();
    const deps = createDeps();
    await handleRouteChange(context, deps, "/search");
    expect(deps.navigateToTab).toHaveBeenCalledWith("search", { replace: true });
  });
});
