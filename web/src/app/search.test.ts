import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "./context";
import type { SearchDeps } from "./search";
import { startYoutubeAnalysisFlow, tryLoadExistingTrackByYoutube } from "./search";
import { setWindowUrl } from "./__tests__/test-utils";

vi.mock("./api", () => ({
  fetchJobByYoutube: vi.fn(),
  startYoutubeAnalysis: vi.fn(),
}));

vi.mock("./playback", () => ({
  tryLoadCachedAudio: vi.fn(),
}));

let api: typeof import("./api");
let playback: typeof import("./playback");

function createContext(): AppContext {
  return {
    elements: {
      searchInput: { value: "" },
      searchResults: { textContent: "" },
      searchHint: { textContent: "" },
    } as unknown as AppContext["elements"],
    engine: {} as unknown as AppContext["engine"],
    player: {} as unknown as AppContext["player"],
    visualizations: [],
    autocanonizer: {} as unknown as AppContext["autocanonizer"],
    jukebox: { refresh: vi.fn() } as unknown as AppContext["jukebox"],
    defaultConfig: {} as unknown as AppContext["defaultConfig"],
    canonizerEngine: {} as AppContext["canonizerEngine"],
    canonizerPlayer: {} as AppContext["canonizerPlayer"],
    canonizerViz: {} as AppContext["canonizerViz"],

    state: {
      playMode: "jukebox",
      lastYouTubeId: null,
      lastJobId: null,
      audioLoaded: false,
      analysisLoaded: false,
    } as unknown as AppContext["state"],
  };
}

function createDeps(): SearchDeps {
  return {
    setActiveTab: vi.fn(),
    navigateToTab: vi.fn(),
    updateTrackUrl: vi.fn(),
    setAnalysisStatus: vi.fn(),
    setLoadingProgress: vi.fn(),
    pollAnalysis: vi.fn(),
    applyAnalysisResult: vi.fn(() => true),
    loadAudioFromJob: vi.fn(() => Promise.resolve(true)),
    resetForNewTrack: vi.fn(),
    updateVizVisibility: vi.fn(),
    onTrackChange: vi.fn(),
  };
}

describe("search flows", () => {
  beforeEach(async () => {
    setWindowUrl("http://localhost/");
    vi.clearAllMocks();
    api = await import("./api");
    playback = await import("./playback");
    (playback.tryLoadCachedAudio as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  });

  it("loads existing track by youtube id and applies analysis", async () => {
    const context = createContext();
    const deps = createDeps();
    (api.fetchJobByYoutube as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "complete",
      id: "job1",
      youtube_id: "yt1",
      result: {},
    });
    const result = await tryLoadExistingTrackByYoutube(
      context,
      deps,
      "yt1",
      "Song Title",
    );
    expect(result).toBe(true);
    expect(deps.updateTrackUrl).toHaveBeenCalledWith("yt1");
    expect(deps.applyAnalysisResult).toHaveBeenCalled();
  });

  it("starts youtube analysis flow", async () => {
    const context = createContext();
    const deps = createDeps();
    (api.startYoutubeAnalysis as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "job2", status: "queued" });
    await startYoutubeAnalysisFlow(context, deps, "yt2", "Song", "Artist");
    expect(deps.updateTrackUrl).toHaveBeenCalledWith("yt2");
    expect(deps.pollAnalysis).toHaveBeenCalledWith("job2");
  });
});
