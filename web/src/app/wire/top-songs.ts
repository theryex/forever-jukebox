import type { Elements } from "../elements";
type TopSongsDeps = {
  elements: Elements;
  fetchTopSongs: (limit: number) => Promise<
    Array<{ title?: string; artist?: string; youtube_id?: string }>
  >;
  loadTrackByYouTubeId: (youtubeId: string) => void;
  navigateToTabWithState: (
    tabId: "top" | "search" | "play" | "faq",
    options?: { replace?: boolean; youtubeId?: string | null },
  ) => void;
  limit: number;
};

export type TopSongsHandlers = ReturnType<typeof createTopSongsHandlers>;

export function createTopSongsHandlers(deps: TopSongsDeps) {
  const {
    elements,
    fetchTopSongs,
    loadTrackByYouTubeId,
    navigateToTabWithState,
    limit,
  } = deps;

  async function fetchTopSongsList() {
    elements.topSongsList.textContent = "Loading top songs…";
    try {
      const items = await fetchTopSongs(limit);
      if (items.length === 0) {
        elements.topSongsList.textContent = "No plays recorded yet.";
        return;
      }
      elements.topSongsList.innerHTML = "";
      for (const item of items.slice(0, limit)) {
        const title = typeof item.title === "string" ? item.title : "Untitled";
        const artist = typeof item.artist === "string" ? item.artist : "";
        const youtubeId =
          typeof item.youtube_id === "string" ? item.youtube_id : "";
        const li = document.createElement("li");
        if (youtubeId) {
          const link = document.createElement("a");
          link.href = `/listen/${encodeURIComponent(youtubeId)}`;
          link.textContent = artist ? `${title} — ${artist}` : title;
          link.dataset.youtubeId = youtubeId;
          link.addEventListener("click", handleTopSongClick);
          li.appendChild(link);
        } else {
          li.textContent = artist ? `${title} — ${artist}` : title;
        }
        elements.topSongsList.appendChild(li);
      }
    } catch (err) {
      elements.topSongsList.textContent = `Top songs unavailable: ${String(
        err,
      )}`;
    }
  }

  function handleTopSongClick(event: Event) {
    event.preventDefault();
    const target = event.currentTarget as HTMLAnchorElement | null;
    const youtubeId = target?.dataset.youtubeId;
    if (!youtubeId) {
      return;
    }
    navigateToTabWithState("play", { youtubeId });
    loadTrackByYouTubeId(youtubeId);
  }

  return { fetchTopSongsList };
}
