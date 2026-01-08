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

Build debug APK:

```bash
cd android
./gradlew assembleDebug
```

## Docker (production)

Copy the example environment file and add your API keys:

```bash
cp .env.example .env
# Edit .env with your Spotify credentials
```

Build and run:

```bash
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

