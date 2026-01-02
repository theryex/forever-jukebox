# The Forever Jukebox

The Forever Jukebox is a self-hosted, end-to-end system that analyzes audio,
serves the results via a lightweight API, and powers a refreshed Infinite
Jukebox-style web UI with branching playback and multiple visualizations. It
also includes a native Android app for on-device playback. It replaces reliance
on the deprecated Spotify Audio Analysis endpoint by generating
beat/segment/section data locally.

## Credits

- The Echo Nest / Spotify Audio Analysis: foundational analysis schema and ideas.
- The Infinite Jukebox (Paul Lamere): original interactive concept and UX inspiration.
- EternalJukebox: continued inspiration for infinite playback experiences.
- Remixatron: beat-aligned segmentation concepts and madmom usage.
- madmom: beat/downbeat tracking models and utilities.
- librosa, numpy, scipy, soundfile, audioread: DSP and audio I/O.
- yt-dlp: YouTube search metadata and audio.
- OpenAI Codex (GPT-5): implementation guidance and tooling.

## Structure

- `engine/` — The Forever Jukebox Audio Analysis (generator + calibration).
- `api/` — REST API + worker that calls the engine.
- `web/` — Web UI (see `web/README.md` for details).
- `android/` — Native Android app (see `android/README.md` for details).
- `schema.json` — JSON schema reference for analysis output.

## Quick Start

Prereqs: Python 3, npm (Node.js).

All-in-one (dev):

```bash
./dev.sh
```

Then open the web UI at `http://localhost:5173`.

Android (native app):

1. Open `android/` in Android Studio.
2. Ensure the API + worker are running.
3. Set the API base URL in the app (e.g. `http://10.0.2.2:8000` for emulator).

## Docker (production)

Build and run a single container that serves the UI and API:

```bash
docker build -t forever-jukebox .
docker run -p 8000:8000 \
  -v $(pwd)/api/storage:/app/api/storage \
  -e SPOTIFY_CLIENT_ID=... \
  -e SPOTIFY_CLIENT_SECRET=... \
  -e YOUTUBE_API_KEY=... \
  -e WORKER_COUNT=2 \
  forever-jukebox
```

Open the UI at `http://localhost/` when publishing port 80, or use `-p 8000:8000`
and visit `http://localhost:8000/`. The UI is served at `/` and API routes are
under `/api/*`. Persist `api/storage/`
with a volume (EBS/EFS on AWS) since container storage is ephemeral.

For standalone setup, see:

- [`engine/README.md`](https://github.com/creightonlinza/forever-jukebox/blob/master/engine/README.md)
- [`api/README.md`](https://github.com/creightonlinza/forever-jukebox/blob/master/api/README.md)
- [`web/README.md`](https://github.com/creightonlinza/forever-jukebox/blob/master/web/README.md)
- [`android/README.md`](https://github.com/creightonlinza/forever-jukebox/blob/master/android/README.md)
