import type { TrackMeta } from "../engine/types";

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null;
}

export type AnalysisStatus =
  | "downloading"
  | "queued"
  | "processing"
  | "complete"
  | "failed";

type AnalysisBase = {
  youtube_id?: string;
};

export type AnalysisInProgress = AnalysisBase & {
  status: "downloading" | "queued" | "processing";
  id: string;
  progress?: number;
};

export type AnalysisResult = Record<string, unknown> & {
  track?: TrackMeta;
};

export type AnalysisComplete = AnalysisBase & {
  status: "complete";
  id: string;
  result: AnalysisResult;
  track?: TrackMeta;
};

export type AnalysisFailed = AnalysisBase & {
  status: "failed";
  id?: string;
  error?: string;
};

export type AnalysisResponse =
  | AnalysisInProgress
  | AnalysisComplete
  | AnalysisFailed;

export type SpotifySearchItem = {
  id?: string;
  name?: string;
  artist?: string;
  duration?: number;
};

export type YoutubeSearchItem = {
  id?: string;
  title?: string;
  duration?: number;
};

export type TopSongItem = {
  title?: string;
  artist?: string;
  youtube_id?: string;
};

async function fetchJson(url: string, options?: RequestInit) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const error = new Error(`Request failed (${response.status})`);
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }
  return response.json();
}

function parseAnalysisResponse(data: unknown): AnalysisResponse | null {
  if (!isRecord(data)) {
    return null;
  }
  const status = typeof data.status === "string" ? data.status : null;
  const id = typeof data.id === "string" ? data.id : undefined;
  const youtubeId =
    typeof data.youtube_id === "string" ? data.youtube_id : undefined;
  const progress = typeof data.progress === "number" ? data.progress : undefined;
  if (status === "downloading" || status === "queued" || status === "processing") {
    if (!id) {
      return null;
    }
    return { status, id, progress, youtube_id: youtubeId };
  }
  if (status === "failed") {
    return {
      status,
      id,
      youtube_id: youtubeId,
      error: typeof data.error === "string" ? data.error : undefined,
    };
  }
  if (status === "complete") {
    if (!id || data.result === undefined) {
      return null;
    }
    return {
      status,
      id,
      result: data.result as AnalysisResult,
      youtube_id: youtubeId,
      track: isRecord(data.track) ? (data.track as TrackMeta) : undefined,
    };
  }
  if (id && data.result !== undefined) {
    return {
      status: "complete",
      id,
      result: data.result as AnalysisResult,
      youtube_id: youtubeId,
      track: isRecord(data.track) ? (data.track as TrackMeta) : undefined,
    };
  }
  return null;
}

export async function fetchAnalysis(jobId: string, signal?: AbortSignal) {
  const response = await fetch(`/api/analysis/${encodeURIComponent(jobId)}`, {
    signal,
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    const error = new Error(`Request failed (${response.status})`);
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }
  const data = await response.json();
  return parseAnalysisResponse(data);
}

export async function fetchAudio(jobId: string, signal?: AbortSignal) {
  const response = await fetch(`/api/audio/${encodeURIComponent(jobId)}`, {
    signal,
  });
  if (!response.ok) {
    throw new Error(`Audio download failed (${response.status})`);
  }
  return response.arrayBuffer();
}

export async function startYoutubeAnalysis(payload: {
  youtube_id: string;
  title: string;
  artist: string;
}) {
  const data = await fetchJson("/api/analysis/youtube", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseAnalysisResponse(data);
}

export async function searchSpotify(query: string) {
  const data = await fetchJson(
    `/api/search/spotify?q=${encodeURIComponent(query)}`
  );
  return Array.isArray(data?.items) ? (data.items as SpotifySearchItem[]) : [];
}

export async function searchYoutube(query: string, duration: number) {
  const data = await fetchJson(
    `/api/search/youtube?q=${encodeURIComponent(
      query
    )}&target_duration=${encodeURIComponent(duration)}`
  );
  return Array.isArray(data?.items) ? (data.items as YoutubeSearchItem[]) : [];
}

export async function fetchTopSongs(limit: number) {
  const data = await fetchJson(`/api/top?limit=${encodeURIComponent(limit)}`);
  return Array.isArray(data?.items) ? (data.items as TopSongItem[]) : [];
}

export async function recordPlay(jobId: string) {
  const response = await fetch(`/api/plays/${encodeURIComponent(jobId)}`, {
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(`Play count failed (${response.status})`);
  }
}

export async function fetchJobByYoutube(
  youtubeId: string
): Promise<AnalysisResponse | null> {
  const response = await fetch(
    `/api/jobs/by-youtube/${encodeURIComponent(youtubeId)}`
  );
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Lookup failed (${response.status})`);
  }
  const data = await response.json();
  return parseAnalysisResponse(data);
}

export async function fetchJobByTrack(
  title: string,
  artist: string
): Promise<AnalysisResponse | null> {
  const params = new URLSearchParams({ title, artist });
  const response = await fetch(`/api/jobs/by-track?${params.toString()}`);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Lookup failed (${response.status})`);
  }
  const data = await response.json();
  return parseAnalysisResponse(data);
}
