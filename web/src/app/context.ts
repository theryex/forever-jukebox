import type { JukeboxEngine } from "../engine";
import type { BufferedAudioPlayer } from "../audio/BufferedAudioPlayer";
import type { CanvasViz } from "../visualization/CanvasViz";
import type { Edge } from "../engine/types";
import type { getElements } from "./elements";
import type { FavoriteTrack } from "./favorites";

export type TabId = "top" | "search" | "play" | "faq";

export type Elements = ReturnType<typeof getElements>;

export type AppState = {
  activeTabId: TabId;
  activeVizIndex: number;
  topSongsTab: "top" | "favorites";
  favorites: FavoriteTrack[];
  playTimerMs: number;
  lastPlayStamp: number | null;
  lastBeatIndex: number | null;
  vizData: ReturnType<JukeboxEngine["getVisualizationData"]>;
  isRunning: boolean;
  audioLoaded: boolean;
  analysisLoaded: boolean;
  audioLoadInFlight: boolean;
  autoComputedThreshold: number | null;
  lastJobId: string | null;
  lastYouTubeId: string | null;
  lastPlayCountedJobId: string | null;
  shiftBranching: boolean;
  selectedEdge: Edge | null;
  topSongsRefreshTimer: number | null;
  trackDurationSec: number | null;
  trackTitle: string | null;
  trackArtist: string | null;
  toastTimer: number | null;
  pollController: AbortController | null;
  listenTimerId: number | null;
  wakeLock: WakeLockSentinel | null;
};

export type AppContext = {
  elements: Elements;
  engine: JukeboxEngine;
  player: BufferedAudioPlayer;
  visualizations: CanvasViz[];
  defaultConfig: ReturnType<JukeboxEngine["getConfig"]>;
  state: AppState;
};
