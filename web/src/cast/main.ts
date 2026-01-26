import "../cast/style.css";
import { BufferedAudioPlayer } from "../audio/BufferedAudioPlayer";
import { JukeboxEngine } from "../engine";
import { CanvasViz } from "../visualization/CanvasViz";
import { fetchAnalysis, fetchAudio, fetchJobByYoutube } from "../app/api";
import { formatDuration } from "../app/format";

type CastCustomData = {
  baseUrl?: string;
  songId?: string;
};

type CastLoadRequest = {
  customData?: CastCustomData;
  media?: {
    customData?: CastCustomData;
  };
};

declare global {
  interface Window {
    cast?: {
      framework?: {
        CastReceiverContext?: {
          getInstance(): {
            getPlayerManager(): {
              setMessageInterceptor(
                type: unknown,
                handler: (loadRequestData: CastLoadRequest) => unknown,
              ): void;
            };
            start(): void;
          };
        };
        messages?: {
          MessageType?: {
            LOAD?: unknown;
          };
        };
      };
    };
  }
}

type CastElements = {
  logo: HTMLElement;
  bottomBar: HTMLElement;
  vizLayer: HTMLElement;
  vizPanel: HTMLElement;
  title: HTMLElement;
  listenTime: HTMLElement;
  beatsPlayed: HTMLElement;
  status: HTMLElement;
};

type CastState = {
  lastBeatIndex: number | null;
  vizData: ReturnType<JukeboxEngine["getVisualizationData"]> | null;
  loadToken: number;
  currentTrackId: string | null;
};

function getElements(): CastElements {
  const require = <T extends HTMLElement>(el: T | null, name: string) => {
    if (!el) {
      throw new Error(`Missing element ${name}`);
    }
    return el;
  };
  return {
    logo: require(document.querySelector("#cast-logo"), "#cast-logo"),
    bottomBar: require(document.querySelector("#cast-bottom"), "#cast-bottom"),
    vizLayer: require(document.querySelector("#viz-layer"), "#viz-layer"),
    vizPanel: require(document.querySelector("#viz-panel"), "#viz-panel"),
    title: require(document.querySelector("#cast-title"), "#cast-title"),
    listenTime: require(document.querySelector(
      "#cast-listen-time",
    ), "#cast-listen-time"),
    beatsPlayed: require(document.querySelector(
      "#cast-beats-played",
    ), "#cast-beats-played"),
    status: require(document.querySelector("#cast-status"), "#cast-status"),
  };
}

function isLikelyYoutubeId(value: string) {
  return /^[a-zA-Z0-9_-]{11}$/.test(value);
}

function getTrackId(): string | null {
  const parts = window.location.pathname.split("/").filter(Boolean);
  if (parts[0] === "cast" && parts[1]) {
    return parts[1];
  }
  const param = new URLSearchParams(window.location.search).get("id");
  return param || null;
}

function setStatus(el: HTMLElement, message: string) {
  el.textContent = message;
}

function setLoadingState(elements: CastElements, isLoading: boolean) {
  elements.status.classList.toggle("hidden", !isLoading);
  elements.title.classList.toggle("hidden", isLoading);
  const meta = elements.status.parentElement?.querySelector(".cast-meta");
  if (meta instanceof HTMLElement) {
    meta.classList.toggle("hidden", isLoading);
  }
}

function setLogoVisible(elements: CastElements, isVisible: boolean) {
  elements.logo.classList.toggle("hidden", !isVisible);
  elements.bottomBar.classList.toggle("hidden", isVisible);
}

function setIdleState(elements: CastElements) {
  elements.status.classList.add("hidden");
  elements.title.classList.add("hidden");
  const meta = elements.status.parentElement?.querySelector(".cast-meta");
  if (meta instanceof HTMLElement) {
    meta.classList.add("hidden");
  }
}

async function pollAnalysis(
  jobId: string,
  statusEl: HTMLElement,
  token: number,
  state: CastState,
) {
  const intervalMs = 2000;
  while (true) {
    if (token !== state.loadToken) {
      throw new Error("Load cancelled");
    }
    const response = await fetchAnalysis(jobId);
    if (!response) {
      throw new Error("Analysis not found");
    }
    if (response.status === "failed") {
      throw new Error(response.error || "Analysis failed");
    }
    if (response.status === "complete") {
      return response;
    }
    const progress =
      typeof response.progress === "number"
        ? Math.round(response.progress)
        : null;
    const message = response.message || "Processing";
    setStatus(
      statusEl,
      progress === null ? message : `${message} (${progress}%)`,
    );
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

async function loadAnalysis(
  trackId: string,
  statusEl: HTMLElement,
  token: number,
  state: CastState,
): Promise<{
  analysis: Awaited<ReturnType<typeof fetchAnalysis>>;
  jobId: string;
}> {
  if (isLikelyYoutubeId(trackId)) {
    setStatus(statusEl, "Loading analysis");
    const response = await fetchJobByYoutube(trackId);
    if (!response || !response.id) {
      throw new Error("Analysis lookup failed");
    }
    if (response.status === "failed") {
      throw new Error(response.error || "Analysis failed");
    }
    if (response.status === "complete") {
      return { analysis: response, jobId: response.id };
    }
    const analysis = await pollAnalysis(response.id, statusEl, token, state);
    return { analysis, jobId: response.id };
  }
  setStatus(statusEl, "Loading analysis");
  const analysis = await pollAnalysis(trackId, statusEl, token, state);
  if (!analysis || analysis.status !== "complete" || !analysis.id) {
    throw new Error("Analysis lookup failed");
  }
  return { analysis, jobId: analysis.id };
}

async function loadAudio(
  jobId: string,
  statusEl: HTMLElement,
  player: BufferedAudioPlayer,
  token: number,
  state: CastState,
) {
  if (token !== state.loadToken) {
    throw new Error("Load cancelled");
  }
  setStatus(statusEl, "Loading audio");
  const buffer = await fetchAudio(jobId);
  if (token !== state.loadToken) {
    throw new Error("Load cancelled");
  }
  await player.decode(buffer);
}

async function bootstrap() {
  const elements = getElements();
  setIdleState(elements);
  setLogoVisible(elements, true);

  let player: BufferedAudioPlayer | null = null;
  let engine: JukeboxEngine | null = null;
  Object.defineProperty(window, "devicePixelRatio", {
    value: 1,
    configurable: true,
  });
  const positioner = (count: number, width: number, height: number) => {
    const radius = Math.min(width, height) * 0.4;
    const cx = width / 2;
    const cy = height / 2;
    return Array.from({ length: count }, (_, i) => {
      const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
      return {
        x: cx + Math.cos(angle) * radius,
        y: cy + Math.sin(angle) * radius,
      };
    });
  };

  let viz: CanvasViz | null = null;
  const destroyViz = () => {
    if (viz) {
      viz.destroy();
      viz = null;
    }
  };

  const createViz = () => {
    destroyViz();
    viz = new CanvasViz(elements.vizLayer, positioner, { enableInteraction: false });
    viz.setVisible(false);
  };

  const state: CastState = {
    lastBeatIndex: null,
    vizData: null,
    loadToken: 0,
    currentTrackId: null,
  };

  const attachEngineListeners = (nextEngine: JukeboxEngine) => {
    nextEngine.onUpdate((engineState) => {
      if (!viz) {
        return;
      }
      elements.beatsPlayed.textContent = `${engineState.beatsPlayed}`;
      if (engineState.currentBeatIndex < 0) {
        return;
      }
      const beatChanged = engineState.currentBeatIndex !== state.lastBeatIndex;
      if (!beatChanged && !engineState.lastJumped) {
        return;
      }
      const jumpFrom =
        engineState.lastJumped && engineState.lastJumpFromIndex !== null
          ? engineState.lastJumpFromIndex
          : state.lastBeatIndex;
      viz.update(engineState.currentBeatIndex, engineState.lastJumped, jumpFrom);
      state.lastBeatIndex = engineState.currentBeatIndex;
    });
  };

  const resetEngine = async () => {
    if (engine) {
      engine.stopJukebox();
      engine.resetStats();
    }
    if (player) {
      await player.dispose();
    }
    destroyViz();
    player = new BufferedAudioPlayer();
    engine = new JukeboxEngine(player, { randomMode: "random" });
    attachEngineListeners(engine);
  };

  let playStartAtMs: number | null = null;
  window.setInterval(() => {
    if (playStartAtMs === null) {
      return;
    }
    const elapsed = Math.max(0, performance.now() - playStartAtMs);
    elements.listenTime.textContent = formatDuration(elapsed / 1000);
  }, 200);

  async function startTrack(trackId: string) {
    if (!trackId) {
      setIdleState(elements);
      setLogoVisible(elements, true);
      if (viz) {
        viz.setVisible(false);
      }
      return;
    }
    if (trackId === state.currentTrackId) {
      return;
    }
    setLogoVisible(elements, false);
    if (viz) {
      viz.setVisible(false);
    }
    state.currentTrackId = trackId;
    state.loadToken += 1;
    const token = state.loadToken;
    setLoadingState(elements, true);
    setStatus(elements.status, "Loading…");
    elements.listenTime.textContent = "00:00:00";
    elements.beatsPlayed.textContent = "0";
    elements.title.textContent = "The Forever Jukebox";
    state.lastBeatIndex = null;
    state.vizData = null;
    if (viz) {
      viz.reset();
      viz.setVisible(false);
    }
    await resetEngine();
    if (token !== state.loadToken) {
      return;
    }
    playStartAtMs = null;

    try {
      const { analysis, jobId } = await loadAnalysis(
        trackId,
        elements.status,
        token,
        state,
      );
      if (token !== state.loadToken) {
        return;
      }
      if (!analysis || analysis.status !== "complete") {
        throw new Error("Analysis unavailable");
      }
      if (!player || !engine) {
        throw new Error("Audio engine not ready");
      }
      await loadAudio(jobId, elements.status, player, token, state);
      if (token !== state.loadToken) {
        return;
      }
      engine.loadAnalysis(analysis.result);
      state.vizData = engine.getVisualizationData();
      if (state.vizData) {
        if (!viz) {
          createViz();
        }
        if (viz) {
          viz.setData(state.vizData);
        }
      }
      const trackMeta = analysis.result?.track || analysis.track;
      if (trackMeta) {
        const title = trackMeta.title || "Unknown";
        const artist = trackMeta.artist || "";
        elements.title.textContent = artist ? `${title} — ${artist}` : title;
      }
      setLoadingState(elements, false);
      if (viz) {
        viz.setVisible(true);
      }
      engine.startJukebox();
      engine.play();
      playStartAtMs = performance.now();
    } catch (err) {
      if (token !== state.loadToken) {
        return;
      }
      state.currentTrackId = null;
      state.lastBeatIndex = null;
      state.vizData = null;
      if (viz) {
        viz.reset();
        viz.setVisible(false);
      }
      if (engine) {
        engine.stopJukebox();
        engine.resetStats();
      }
      if (player) {
        await player.dispose();
      }
      player = null;
      engine = null;
      playStartAtMs = null;
      setIdleState(elements);
      setLogoVisible(elements, true);
    }
  }

  function initCastReceiver(): boolean {
    const framework = window.cast && window.cast.framework;
    const ctx = framework && framework.CastReceiverContext;
    const messages = framework && framework.messages;
    if (!framework || !ctx || !messages?.MessageType) {
      return false;
    }
    const context = ctx.getInstance();
    const playerManager = context.getPlayerManager();
    playerManager.setMessageInterceptor(
      messages.MessageType.LOAD,
      (loadRequestData: CastLoadRequest) => {
        const customData = loadRequestData.customData ?? loadRequestData.media?.customData ?? {};
        const baseUrl =
          typeof customData.baseUrl === "string" ? customData.baseUrl : null;
        const songId =
          typeof customData.songId === "string" ? customData.songId : null;
        if (songId) {
          const nextUrl = baseUrl
            ? `${baseUrl.replace(/\/+$/, "")}/cast/${encodeURIComponent(songId)}`
            : null;
          if (nextUrl) {
            window.history.replaceState({}, "", nextUrl);
          }
          void startTrack(songId);
        }
        return loadRequestData;
      },
    );
    context.start();
    return true;
  }

  const maxAttempts = 40;
  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    if (initCastReceiver() || attempts >= maxAttempts) {
      clearInterval(timer);
    }
  }, 250);
  const initialTrackId = getTrackId();
  if (initialTrackId) {
    void startTrack(initialTrackId);
  } else {
    setIdleState(elements);
  }
}

bootstrap();
