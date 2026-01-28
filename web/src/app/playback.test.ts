import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "./context";
import { applyTuningChanges, syncTuningUI, updateListenTimeDisplay } from "./playback";
import { setWindowUrl } from "./__tests__/test-utils";

function createClassList() {
  return {
    add: vi.fn(),
    remove: vi.fn(),
    toggle: vi.fn(),
    contains: vi.fn().mockReturnValue(false),
  };
}

function createInput(initial = "") {
  return { value: initial, checked: false } as HTMLInputElement;
}

function createSpan() {
  return { textContent: "" } as HTMLSpanElement;
}

function createElements() {
  return {
    thresholdInput: createInput("0"),
    thresholdVal: createSpan(),
    computedThresholdEl: createSpan(),
    minProbInput: createInput("0"),
    minProbVal: createSpan(),
    maxProbInput: createInput("0"),
    maxProbVal: createSpan(),
    rampInput: createInput("0"),
    rampVal: createSpan(),
    volumeInput: createInput("50"),
    volumeVal: createSpan(),
    lastEdgeInput: createInput(),
    justBackwardsInput: createInput(),
    justLongInput: createInput(),
    removeSeqInput: createInput(),
    tuningModal: { classList: createClassList() },
    infoModal: { classList: createClassList() },
    listenTimeEl: createSpan(),
    playStatusPanel: { classList: createClassList() },
    playMenu: { classList: createClassList() },
    vizPanel: { classList: createClassList() },
    playButton: { classList: createClassList(), disabled: false },
    playTabButton: { classList: createClassList(), disabled: false },
    vizButtons: [{ disabled: false }, { disabled: false }],
    canonizerFinish: { checked: false, addEventListener: vi.fn() },
    infoDurationEl: createSpan(),
    infoBeatsEl: createSpan(),
    infoBranchesEl: createSpan(),
  };
}

function createContext(overrides?: Partial<AppContext>): AppContext {
  const elements = createElements();
  const engineConfig = {
    currentThreshold: 0,
    minRandomBranchChance: 0.18,
    maxRandomBranchChance: 0.5,
    randomBranchChanceDelta: 0.1,
    addLastEdge: true,
    justBackwards: false,
    justLongBranches: false,
    removeSequentialBranches: false,
  };
  const engine = {
    getConfig: vi.fn(() => ({ ...engineConfig })),
    updateConfig: vi.fn((partial: Record<string, unknown>) => {
      Object.assign(engineConfig, partial);
    }),
    rebuildGraph: vi.fn(),
    getGraphState: vi.fn(() => ({ currentThreshold: 45, allEdges: [], totalBeats: 0 })),
    getVisualizationData: vi.fn(() => ({ beats: [], edges: [] })),
  };
  const player = {
    getVolume: vi.fn(() => 0.5),
    getDuration: vi.fn(() => null),
    stop: vi.fn(),
  };
  const autocanonizer = {
    setAnalysis: vi.fn(),
    setAudio: vi.fn(),
    setVolume: vi.fn(),
    reset: vi.fn(),
    stop: vi.fn(),
    start: vi.fn(),
    isReady: vi.fn(() => false),
    setOnBeat: vi.fn(),
    setOnEnded: vi.fn(),
    setVisible: vi.fn(),
    resizeNow: vi.fn(),
  };
  const jukebox = {
    setData: vi.fn(),
    setSelectedEdge: vi.fn(),
    resizeActive: vi.fn(),
    reset: vi.fn(),
    update: vi.fn(),
  };
  return {
    elements: elements as unknown as AppContext["elements"],
    engine: engine as unknown as AppContext["engine"],
    player: player as unknown as AppContext["player"],
    autocanonizer: autocanonizer as unknown as AppContext["autocanonizer"],
    jukebox: jukebox as unknown as AppContext["jukebox"],
    defaultConfig: engineConfig as AppContext["defaultConfig"],
    state: {
      playMode: "jukebox",
      autoComputedThreshold: null,
      vizData: null,
      playTimerMs: 0,
      lastPlayStamp: null,
      audioLoaded: false,
      analysisLoaded: false,
      audioLoadInFlight: false,
      activeTabId: "play",
      activeVizIndex: 0,
      lastYouTubeId: null,
      lastJobId: null,
      isRunning: false,
      trackDurationSec: null,
      trackTitle: null,
      trackArtist: null,
      selectedEdge: null,
      deleteEligible: false,
      deleteEligibilityJobId: null,
      shiftBranching: false,
      lastBeatIndex: null,
      listenTimerId: null,
      pollController: null,
      wakeLock: null,
      favorites: [],
      favoritesSyncCode: null,
      topSongsTab: "top",
      searchTab: "search",
      topSongsRefreshTimer: null,
      toastTimer: null,
      pendingAutoFavoriteId: null,
      lastPlayCountedJobId: null,
      appConfig: null,
      tuningParams: null,
      beatsPlayed: 0,
    } as unknown as AppContext["state"],
    ...overrides,
  };
}

describe("playback tuning", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setWindowUrl("http://localhost/listen/abc");
  });

  it("syncs tuning UI from config and graph", () => {
    const context = createContext();
    syncTuningUI(context);
    expect(context.elements.thresholdInput.value).toBe("45");
    expect(context.elements.thresholdVal.textContent).toBe("45");
    expect(context.elements.volumeVal.textContent).toBe("50");
    expect(context.elements.computedThresholdEl.textContent).toBe("45");
  });

  it("applies tuning changes and normalizes min/max", () => {
    const context = createContext();
    context.elements.minProbInput.value = "80";
    context.elements.maxProbInput.value = "10";
    context.elements.rampInput.value = "10";
    context.elements.thresholdInput.value = "50";
    context.elements.computedThresholdEl.textContent = "50";
    applyTuningChanges(context);
    expect(context.elements.minProbInput.value).toBe("10");
    expect(context.elements.maxProbInput.value).toBe("80");
    expect(context.engine.updateConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        currentThreshold: 0,
        minRandomBranchChance: 0.1,
        maxRandomBranchChance: 0.8,
      }),
    );
    expect(context.elements.thresholdInput.value).toBe("45");
  });
});

describe("playback timers", () => {
  it("updates listen time display", () => {
    const context = createContext();
    context.state.playTimerMs = 1000;
    context.state.lastPlayStamp = 0;
    vi.spyOn(performance, "now").mockReturnValue(1000);
    updateListenTimeDisplay(context);
    expect(context.elements.listenTimeEl.textContent).toBe("00:00:02");
  });
});
