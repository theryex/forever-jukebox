# The Forever Jukebox Audio Analysis

Generate audio analysis JSON from audio files using a local Python pipeline.

## Setup

This engine stack expects Python 3.11 or 3.12. Python 3.13 does not have compatible wheels for SciPy/Numba yet and will attempt a source build.

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Usage

```bash
PYTHONPATH=. python -m app.main /path/to/audio.m4a -o /path/to/output.json --config tuned_config.json
```

## Training / Calibration

```bash
PYTHONPATH=. python scripts/train_calibration.py --audio-dir /path/to/audio --json-dir /path/to/analysis \
  --config tuned_config.json --output-config tuned_config.json
```

## What This Adds

This project builds on Remixatron and madmom, and extends them with:
Spotify-style analysis JSON synthesis (segments, sections, beats, bars, tatums, track/meta).

- Calibration and fitting layers to align features with reference analyses.
- Repeatable parameter tuning for reproducible improvements.

## Included

- `app/` core analysis pipeline and CLI.
- `scripts/` calibration utilities only.
- `tuned_config.json` default configuration.

## Sources and Credits

- Remixatron (beat-aligned segmentation concepts and madmom usage): https://github.com/beefoo/remixatron
- madmom (beat/downbeat tracking): https://github.com/CPJKU/madmom
- librosa (feature extraction reference): https://github.com/librosa/librosa
- numpy/scipy/soundfile (core DSP + I/O dependencies)
- Implementation, integration, and tuning guidance by OpenAI Codex (GPT-5).
