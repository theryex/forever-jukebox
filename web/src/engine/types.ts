export interface TrackMeta {
  title?: string;
  artist?: string;
  duration?: number;
  tempo?: number;
  time_signature?: number;
}

export interface QuantumBase {
  start: number;
  duration: number;
  confidence?: number;
  which: number;
  prev: QuantumBase | null;
  next: QuantumBase | null;
  parent?: QuantumBase;
  children?: QuantumBase[];
  indexInParent?: number;
  overlappingSegments: Segment[];
  oseg?: Segment | null;
  neighbors: Edge[];
  allNeighbors: Edge[];
  reach?: number;
}

export interface Segment {
  start: number;
  duration: number;
  confidence: number;
  loudness_start: number;
  loudness_max: number;
  loudness_max_time: number;
  pitches: number[];
  timbre: number[];
  which: number;
}

export interface Edge {
  id: number;
  src: QuantumBase;
  dest: QuantumBase;
  distance: number;
  deleted: boolean;
}

export interface TrackAnalysis {
  sections: QuantumBase[];
  bars: QuantumBase[];
  beats: QuantumBase[];
  tatums: QuantumBase[];
  segments: Segment[];
  track?: TrackMeta;
}

export interface JukeboxConfig {
  maxBranches: number;
  maxBranchThreshold: number;
  currentThreshold: number;
  addLastEdge: boolean;
  justBackwards: boolean;
  justLongBranches: boolean;
  removeSequentialBranches: boolean;
  minRandomBranchChance: number;
  maxRandomBranchChance: number;
  randomBranchChanceDelta: number;
  minLongBranch: number;
}

export interface JukeboxGraphState {
  computedThreshold: number;
  currentThreshold: number;
  lastBranchPoint: number;
  totalBeats: number;
  longestReach: number;
  allEdges: Edge[];
}

export interface JukeboxState {
  currentBeatIndex: number;
  beatsPlayed: number;
  currentTime: number;
  lastJumped: boolean;
  lastJumpTime: number | null;
  lastJumpFromIndex: number | null;
  currentThreshold: number;
  lastBranchPoint: number;
  curRandomBranchChance: number;
}

// Types for Canonizer
export interface Beat {
  start: number;
  duration: number;
  confidence?: number;
  which: number;
}

export interface Section {
  start: number;
  duration: number;
  confidence?: number;
  loudness?: number;
  tempo?: number;
  tempo_confidence?: number;
  key?: number;
  key_confidence?: number;
  mode?: number;
  mode_confidence?: number;
  time_signature?: number;
  time_signature_confidence?: number;
}

export interface AnalysisResult {
  track?: TrackMeta;
  bars?: { start: number; duration: number; confidence?: number }[];
  beats?: Beat[];
  sections?: Section[];
  segments?: Segment[];
  tatums?: { start: number; duration: number; confidence?: number }[];
}
