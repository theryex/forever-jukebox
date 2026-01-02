const trackCacheDbName = "forever-jukebox-cache";
const trackCacheStore = "tracks";

export type CachedTrack = {
  youtubeId: string;
  audio?: ArrayBuffer;
  jobId?: string;
  updatedAt: number;
};

let trackCacheDbPromise: Promise<IDBDatabase> | null = null;

function openTrackCacheDb(): Promise<IDBDatabase> {
  if (!("indexedDB" in window)) {
    return Promise.reject(new Error("IndexedDB not available"));
  }
  if (trackCacheDbPromise) {
    return trackCacheDbPromise;
  }
  trackCacheDbPromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(trackCacheDbName, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(trackCacheStore)) {
        db.createObjectStore(trackCacheStore, { keyPath: "youtubeId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB open failed"));
  });
  return trackCacheDbPromise;
}

export async function readCachedTrack(
  youtubeId: string
): Promise<CachedTrack | null> {
  const db = await openTrackCacheDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(trackCacheStore, "readonly");
    const store = tx.objectStore(trackCacheStore);
    const request = store.get(youtubeId);
    request.onsuccess = () => {
      resolve((request.result as CachedTrack | undefined) ?? null);
    };
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB read failed"));
  });
}

export async function updateCachedTrack(
  youtubeId: string,
  patch: Partial<CachedTrack>
) {
  const existing = await readCachedTrack(youtubeId);
  const next: CachedTrack = {
    youtubeId,
    audio: existing?.audio,
    jobId: existing?.jobId,
    updatedAt: Date.now(),
    ...patch,
  };
  const db = await openTrackCacheDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(trackCacheStore, "readwrite");
    const store = tx.objectStore(trackCacheStore);
    const request = store.put(next);
    request.onsuccess = () => resolve();
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB write failed"));
  });
}
