# The Forever Jukebox

![The Forever Jukebox logo](./tfj-logo.png)

The Forever Jukebox is a self-hosted, end-to-end system that analyzes audio,
serves the results via a lightweight API, and powers a refreshed Infinite
Jukebox-style web UI with branching playback and multiple visualizations. It
also includes a native Android app for on-device playback. It replaces reliance
on the deprecated Spotify Audio Analysis engine by generating similar
beat/segment/section data locally.

## Features

- 🎵 **Infinite playback** — Songs loop forever with intelligent beat-matching transitions
- 🎹 **Canonizer mode** — Play the song as a musical canon against itself
- 🎨 **Retro mode** — Classic Infinite Jukebox teal/black aesthetic
- 🚀 **GPU acceleration** — CUDA and ROCm support for faster analysis
- 📱 **Native Android app** — On-device playback with background audio
- 🔧 **Self-hosted** — No external API dependencies for analysis

## Credits

- The Echo Nest / Spotify Audio Analysis: foundational analysis schema and ideas.
- The Infinite Jukebox (Paul Lamere): original interactive concept and UX inspiration.
- EternalJukebox: continued inspiration for infinite playback experiences.
- madmom: beat/downbeat tracking models and utilities.
- Essentia: audio features and DSP toolkits.
- Remixatron: beat-aligned segmentation concepts and madmom usage.
- madmom: beat/downbeat tracking models and utilities.
- Essentia: audio feature extraction (MFCC, HPCP, spectral analysis).
- librosa, numpy, scipy, soundfile, audioread: DSP and audio I/O.
- yt-dlp: YouTube search metadata and audio.
- OpenAI Codex (GPT-5): implementation guidance and tooling.

## Structure

- `engine/` — Audio analysis engine (Essentia + GPU hybrid pipeline)
- `api/` — REST API + worker that calls the engine
- `web/` — Web UI (see `web/README.md` for details)
- `android/` — Native Android app (see `android/README.md` for details)
- `schema.json` — JSON schema reference for analysis output

## Quick Start

Prereqs: Python 3.10+, npm (Node.js), ffmpeg.

All-in-one (dev):

```bash
./dev.sh
```

Then open the web UI at `http://localhost:5173`.

---

## Docker (Production)

### Basic Setup

```bash
# Copy environment file and add your API keys
cp .env.example .env
# Edit .env with your Spotify credentials

# Build and run
docker compose up --build -d

# View logs
docker compose logs -f
```

Open `http://localhost:8000/`.

### GPU Acceleration

GPU acceleration speeds up audio analysis (~5-15s vs ~30-60s per track).

**NVIDIA GPU:**

```bash
# Install nvidia-container-toolkit first
# See: https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html

# Run with NVIDIA profile
docker compose --profile nvidia up -d --build
```

**AMD GPU:**

```bash
# Install ROCm drivers first
# See: https://rocm.docs.amd.com/en/latest/deploy/linux/quick_start.html
sudo usermod -a -G video,render $USER

# Run with AMD profile
docker compose --profile amd up -d --build
```

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SPOTIFY_CLIENT_ID` | Yes | — | Spotify API client ID |
| `SPOTIFY_CLIENT_SECRET` | Yes | — | Spotify API client secret |
| `YOUTUBE_API_KEY` | No | — | Speeds up YouTube search (yt-dlp fallback) |
| `GPU_MODE` | No | `cpu` | `cpu`, `cuda` (NVIDIA), or `rocm` (AMD) |
| `CALIBRATION_MODE` | No | `legacy` | `legacy` (tuned_config.json) or `upstream` (calibration.json) |
| `PORT` | No | `8000` | Server port |
| `FJ_PROGRESS` | No | `0` | Enable analysis progress output (`1` = enabled) |

### Calibration Modes

The analysis engine supports two calibration formats:

- **Legacy** (`tuned_config.json`) — PCA calibration matrices, more parameters
- **Upstream** (`calibration.json`) — Simpler affine calibration (a*x + b)

Set `CALIBRATION_MODE=upstream` to use the simpler format.

---

## Android App

1. Open `android/` in Android Studio.
2. Ensure the API + worker are running.
3. Set the API base URL in the app (e.g. `http://10.0.2.2:8000` for emulator).

Build debug APK:

```bash
cd android
./gradlew assembleDebug
```

---

## Analysis Engine

The engine uses a hybrid Essentia + GPU pipeline:

- **Beat detection** — madmom with parabolic refinement for sub-frame accuracy
- **Feature extraction** — Essentia (MFCC, HPCP) with GPU fallback via torchaudio
- **Segmentation** — Novelty-based with beat snapping
- **Section detection** — Bar-based feature vectors with z-score normalization

See [`engine/README.md`](engine/README.md) for standalone usage.

---

## Development

For component-specific setup:

- [`engine/README.md`](engine/README.md) — Analysis engine
- [`api/README.md`](api/README.md) — REST API
- [`web/README.md`](web/README.md) — Web UI
- [`android/README.md`](android/README.md) — Android app
