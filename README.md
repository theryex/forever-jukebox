# The Forever Jukebox

![The Forever Jukebox logo](./tfj-logo.png)

The Forever Jukebox is a self-hosted, end-to-end system that analyzes audio,
serves the results via a lightweight API, and powers a refreshed Infinite
Jukebox-style web UI with branching playback and multiple visualizations. It
also includes a native Android app for on-device playback. It replaces reliance
on the deprecated Spotify Audio Analysis engine by generating similar
beat/segment/section data locally.

## Credits

- The Echo Nest / Spotify Audio Analysis: foundational analysis schema and ideas.
- The Infinite Jukebox (Paul Lamere): original interactive concept and UX inspiration.
- EternalJukebox: continued inspiration for infinite playback experiences.
- madmom: beat/downbeat tracking models and utilities.
- Essentia: audio features and DSP toolkits.
- Remixatron: beat-aligned segmentation concepts and madmom usage.
- numpy, scipy: DSP and math.
- ffmpeg: audio decoding.
- yt-dlp: YouTube search metadata and audio.
- OpenAI Codex (GPT-5): implementation guidance and tooling.

## Structure

- `engine/` — The Forever Jukebox Audio Analysis (generator + calibration bundle).
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

- [`Debug Release APK`](https://github.com/creightonlinza/forever-jukebox/releases/tag/android-debug-latest)
- Must be pointed toward a running API and worker
- Full source available in `android/`

## Docker (production)

Copy the example environment file and add your API keys:

```bash
cp .env.example .env
# Edit .env with your Spotify credentials
```

Build and run:

```bash
export SPOTIFY_CLIENT_ID=...
export SPOTIFY_CLIENT_SECRET=...
export YOUTUBE_API_KEY=...
export ADMIN_KEY=...
export WORKER_COUNT=1
export ALLOW_USER_UPLOAD=false
export ALLOW_USER_YOUTUBE=false
export ALLOW_FAVORITES_SYNC=false
docker compose up --build
```

`ENGINE_CONFIG` is optional; set it only if you want a calibration bundle.

You can also put these values in a `.env` file (same directory as
`docker-compose.yml`) and Compose will load them automatically.

docker compose up --build
```

Open `http://localhost:8000/`.


### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SPOTIFY_CLIENT_ID` | Yes | Spotify API client ID |
| `SPOTIFY_CLIENT_SECRET` | Yes | Spotify API client secret |
| `YOUTUBE_API_KEY` | No | Speeds up YouTube search. If omitted, yt-dlp is used (slower but works) |
| `GPU_MODE` | No | `cpu` (default), `cuda` (NVIDIA), or `rocm` (AMD) |

### GPU Acceleration

GPU acceleration speeds up audio analysis (~5-15s vs ~30-60s per track).

**NVIDIA GPU:**

1. Install [nvidia-container-toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html)
2. Set `GPU_MODE=cuda` in `.env`
3. Uncomment the NVIDIA section in `docker-compose.yml`

**AMD GPU:**

1. Install [ROCm drivers](https://rocm.docs.amd.com/en/latest/deploy/linux/quick_start.html)
2. Add your user to video/render groups: `sudo usermod -a -G video,render $USER`
3. Set `GPU_MODE=rocm` in `.env`
4. Uncomment the AMD section in `docker-compose.yml`

For standalone setup, see:

- [`engine/README.md`](engine/README.md)
- [`api/README.md`](api/README.md)
- [`web/README.md`](web/README.md)
- [`android/README.md`](android/README.md)

