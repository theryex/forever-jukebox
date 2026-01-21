import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JukeboxEngine, type JukeboxPlayer } from "./JukeboxEngine";
import type {
  Edge,
  JukeboxGraphState,
  QuantumBase,
  TrackAnalysis,
} from "./types";

function makeBeat(which: number): QuantumBase {
  return {
    start: which,
    duration: 1,
    which,
    prev: null,
    next: null,
    overlappingSegments: [],
    neighbors: [],
    allNeighbors: [],
  };
}

function linkBeats(beats: QuantumBase[]) {
  beats.forEach((beat, idx) => {
    beat.prev = idx > 0 ? beats[idx - 1] : null;
    beat.next = idx < beats.length - 1 ? beats[idx + 1] : null;
  });
}

function makeAnalysis(beats: QuantumBase[]): TrackAnalysis {
  return {
    sections: [],
    bars: [],
    beats,
    tatums: [],
    segments: [],
    track: {},
  };
}

function makeSegment(idx: number) {
  return {
    start: idx,
    duration: 1,
    confidence: 1,
    loudness_start: 0,
    loudness_max: 0,
    loudness_max_time: 0,
    pitches: Array(12).fill(0),
    timbre: Array(12).fill(0),
  };
}

function makeAnalysisPayload(count: number) {
  const beats = Array.from({ length: count }, (_, i) => ({
    start: i,
    duration: 1,
    confidence: 1,
  }));
  const segments = Array.from({ length: count }, (_, i) => makeSegment(i));
  return {
    sections: beats,
    bars: beats,
    beats,
    tatums: beats,
    segments,
    track: { duration: count },
  };
}

function makePlayer(): JukeboxPlayer {
  return {
    play: vi.fn(),
    pause: vi.fn(),
    stop: vi.fn(),
    seek: vi.fn(),
    scheduleJump: vi.fn(),
    getCurrentTime: () => 0,
    isPlaying: () => true,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("JukeboxEngine branching", () => {
  it("forces a branch when current beat is the last branch point", () => {
    const player = makePlayer();
    const engine = new JukeboxEngine(player, { randomMode: "seeded", seed: 1 });
    const beats = [0, 1, 2].map(makeBeat);
    linkBeats(beats);
    const edge: Edge = {
      id: 0,
      src: beats[1],
      dest: beats[0],
      distance: 10,
      deleted: false,
    };
    beats[1].neighbors = [edge];
    beats[1].allNeighbors = [edge];
    const graph: JukeboxGraphState = {
      computedThreshold: 0,
      currentThreshold: 0,
      lastBranchPoint: 1,
      totalBeats: beats.length,
      longestReach: 0,
      allEdges: [edge],
    };

    const engineAny = engine as unknown as {
      analysis: TrackAnalysis;
      graph: JukeboxGraphState;
      beats: QuantumBase[];
      currentBeatIndex: number;
      nextTransitionTime: number;
      curRandomBranchChance: number;
      lastJumpFromIndex: number | null;
      advanceBeat: () => void;
    };
    engineAny.analysis = makeAnalysis(beats);
    engineAny.graph = graph;
    engineAny.beats = beats;
    engineAny.currentBeatIndex = 1;
    engineAny.nextTransitionTime = beats[1].start + beats[1].duration;
    engineAny.curRandomBranchChance = engine.getConfig().minRandomBranchChance;

    engineAny.advanceBeat();

    expect(engineAny.currentBeatIndex).toBe(0);
    expect(player.scheduleJump).toHaveBeenCalledTimes(1);
    expect(engineAny.lastJumpFromIndex).toBe(1);
  });

  it("schedules a jump when wrapping past the last beat", () => {
    const player = makePlayer();
    const engine = new JukeboxEngine(player, { randomMode: "seeded", seed: 2 });
    const beats = [0, 1].map(makeBeat);
    linkBeats(beats);
    const graph: JukeboxGraphState = {
      computedThreshold: 0,
      currentThreshold: 0,
      lastBranchPoint: 0,
      totalBeats: beats.length,
      longestReach: 0,
      allEdges: [],
    };

    const engineAny = engine as unknown as {
      analysis: TrackAnalysis;
      graph: JukeboxGraphState;
      beats: QuantumBase[];
      currentBeatIndex: number;
      nextTransitionTime: number;
      curRandomBranchChance: number;
      lastJumpFromIndex: number | null;
      advanceBeat: () => void;
    };
    engineAny.analysis = makeAnalysis(beats);
    engineAny.graph = graph;
    engineAny.beats = beats;
    engineAny.currentBeatIndex = 1;
    engineAny.nextTransitionTime = beats[1].start + beats[1].duration;
    engineAny.curRandomBranchChance = engine.getConfig().minRandomBranchChance;

    engineAny.advanceBeat();

    expect(engineAny.currentBeatIndex).toBe(0);
    expect(player.scheduleJump).toHaveBeenCalledTimes(1);
    expect(engineAny.lastJumpFromIndex).toBe(1);
  });
});

describe("JukeboxEngine playback loop", () => {
  beforeEach(() => {
    if (!("window" in globalThis)) {
      vi.stubGlobal("window", {
        setTimeout: globalThis.setTimeout,
        clearTimeout: globalThis.clearTimeout,
      });
    }
  });

  it("throws if startJukebox is called without analysis", () => {
    const engine = new JukeboxEngine(makePlayer());
    expect(() => engine.startJukebox()).toThrow("Analysis not loaded");
  });

  it("play/pause/stop delegate to the player", () => {
    const player = makePlayer();
    const engine = new JukeboxEngine(player);
    engine.play();
    engine.pause();
    engine.stopJukebox();
    expect(player.play).toHaveBeenCalledTimes(1);
    expect(player.pause).toHaveBeenCalledTimes(1);
    expect(player.stop).toHaveBeenCalledTimes(1);
  });

  it("updateConfig merges config changes", () => {
    const engine = new JukeboxEngine(makePlayer());
    const before = engine.getConfig().maxBranches;
    engine.updateConfig({ maxBranches: before + 1 });
    expect(engine.getConfig().maxBranches).toBe(before + 1);
  });

  it("ticks, advances beats, and resyncs when time drifts", () => {
    vi.useFakeTimers();
    if ("window" in globalThis) {
      const win = globalThis.window as { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout };
      win.setTimeout = globalThis.setTimeout;
      win.clearTimeout = globalThis.clearTimeout;
    }
    let now = 0;
    const player = makePlayer();
    player.getCurrentTime = () => now;
    const engine = new JukeboxEngine(player, {
      config: {
        minRandomBranchChance: 0,
        maxRandomBranchChance: 0,
        randomBranchChanceDelta: 0,
      },
    });
    engine.loadAnalysis(makeAnalysisPayload(3));
    engine.startJukebox();

    now = 0.2;
    vi.advanceTimersByTime(60);
    const engineAny = engine as unknown as { currentBeatIndex: number };
    expect(engineAny.currentBeatIndex).toBe(0);

    now = 1.05;
    vi.advanceTimersByTime(60);
    expect(engineAny.currentBeatIndex).toBe(1);

    now = 2.4;
    vi.advanceTimersByTime(60);
    expect(engineAny.currentBeatIndex).toBe(2);
    engine.stopJukebox();
  });
});

describe("JukeboxEngine branching controls", () => {
  it("forces a branch when forceBranch is enabled", () => {
    const player = makePlayer();
    const engine = new JukeboxEngine(player, {
      config: {
        minRandomBranchChance: 0,
        maxRandomBranchChance: 0,
        randomBranchChanceDelta: 0,
      },
    });
    const beats = [0, 1, 2].map(makeBeat);
    linkBeats(beats);
    const edge: Edge = {
      id: 0,
      src: beats[2],
      dest: beats[0],
      distance: 10,
      deleted: false,
    };
    beats[2].neighbors = [edge];
    beats[2].allNeighbors = [edge];
    const graph: JukeboxGraphState = {
      computedThreshold: 0,
      currentThreshold: 0,
      lastBranchPoint: 99,
      totalBeats: beats.length,
      longestReach: 0,
      allEdges: [edge],
    };

    const engineAny = engine as unknown as {
      analysis: TrackAnalysis;
      graph: JukeboxGraphState;
      beats: QuantumBase[];
      currentBeatIndex: number;
      nextTransitionTime: number;
      curRandomBranchChance: number;
      lastJumpFromIndex: number | null;
      advanceBeat: () => void;
    };
    engineAny.analysis = makeAnalysis(beats);
    engineAny.graph = graph;
    engineAny.beats = beats;
    engineAny.currentBeatIndex = 1;
    engineAny.nextTransitionTime = beats[1].start + beats[1].duration;
    engineAny.curRandomBranchChance = engine.getConfig().minRandomBranchChance;

    engine.setForceBranch(true);
    engineAny.advanceBeat();

    expect(engineAny.currentBeatIndex).toBe(0);
    expect(player.scheduleJump).toHaveBeenCalledTimes(1);
    expect(engineAny.lastJumpFromIndex).toBe(2);
  });
});

describe("JukeboxEngine graph maintenance", () => {
  it("deletes edges from neighbors and graph storage", () => {
    const player = makePlayer();
    const engine = new JukeboxEngine(player);
    engine.loadAnalysis(makeAnalysisPayload(3));
    const engineAny = engine as unknown as {
      beats: QuantumBase[];
      graph: JukeboxGraphState;
    };
    const beat = engineAny.beats[0];
    expect(beat.neighbors.length).toBeGreaterThan(0);
    const edge = beat.neighbors[0];
    engine.deleteEdge(edge);
    const graphEdge = engineAny.graph.allEdges.find(
      (candidate) =>
        candidate.src.which === edge.src.which &&
        candidate.dest.which === edge.dest.which
    );
    expect(graphEdge?.deleted).toBe(true);
    expect(beat.neighbors.find((candidate) => candidate === edge)).toBeUndefined();
  });
});
