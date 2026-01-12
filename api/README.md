# The Forever Jukebox Analysis API

REST API wrapper for the analysis generator. This codebase is intentionally separate from the analysis engine in `engine/`.

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Configure the generator

Set environment variables to point at the generator repo and calibration bundle:

```bash
export GENERATOR_REPO=../engine
export GENERATOR_CONFIG=../engine/calibration.json
```

Set API keys:

```bash
export SPOTIFY_CLIENT_ID=...
export SPOTIFY_CLIENT_SECRET=...
export YOUTUBE_API_KEY=...
```

## Run the API

```bash
uvicorn api.main:app --host 0.0.0.0 --port 8000
```

## Run the worker

```bash
python worker/worker.py
```

## Usage

Poll for analysis:

```bash
curl /api/analysis/<id>
```

Responses:

- `202` for `downloading`, `queued`, or `processing` (includes `progress`)
- `200` with `complete` + `result` JSON
- `200` with `failed` + `error` (failed jobs are cleaned up for retry)

Search Spotify:

```bash
curl "/api/search/spotify?q=daft%20punk"
```

Search YouTube (closest matches by duration):

```bash
curl "/api/search/youtube?q=daft%20punk&target_duration=210"
```

Create analysis from YouTube:

```bash
curl -X POST "/api/analysis/youtube" -H "Content-Type: application/json" -d '{"youtube_id":"dQw4w9WgXcQ"}'
```

Fetch audio for a job:

```bash
curl "/api/audio/<id>"
```

Repair missing audio or analysis for a job:

```bash
curl -X POST "/api/repair/<id>"
```

Lookup by YouTube ID:

```bash
curl "/api/jobs/by-youtube/dQw4w9WgXcQ"
```

Increment play count:

```bash
curl -X POST "/api/plays/<id>"
```

Fetch top tracks (defaults to 20):

```bash
curl "/api/top?limit=20"
```

## Storage

Jobs and analysis outputs are stored under `storage/` in this repo:

- `storage/audio/`
- `storage/analysis/`
- `storage/logs/` - failure logs (engine output or download errors)
- `storage/jobs.db`
