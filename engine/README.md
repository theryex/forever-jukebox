# The Forever Jukebox Audio Analysis Engine
# The Forever Jukebox Audio Analysis Engine

Generate audio analysis JSON from audio files using a local Python pipeline with GPU acceleration.

## Features

- **Essentia-based feature extraction** - MFCC, HPCP, and RMS energy using Essentia library
- **GPU acceleration** - PyTorch/torchaudio for accelerated MFCC and spectrogram computation
- **madmom beat detection** - Accurate downbeat tracking with beat confidence
- **Calibration support** - Affine transformation and curve mapping for feature alignment
- **Backward compatible** - Supports both `tuned_config.json` and `calibration.json` formats

## Setup

This engine expects Python 3.10-3.12. Python 3.13 may have compatibility issues.

```bash
python3 -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### GPU Support (Optional)

For GPU acceleration, install PyTorch with CUDA or ROCm:

```bash
# NVIDIA CUDA
pip install -r requirements-gpu-cuda.txt

# AMD ROCm
pip install -r requirements-gpu-rocm.txt
```

### Essentia Installation

If Essentia fails to build, install it system-wide:

- **macOS**: `brew install essentia`
- **Ubuntu**: `apt install python3-essentia`

Then recreate venv with `--system-site-packages`:

```bash
python3 -m venv .venv --system-site-packages
```

If Essentia fails to build locally, install it system-wide and use `--system-site-packages` for the venv:

```bash
# With config file (legacy format)
python -m app.main /path/to/audio.m4a -o /path/to/output.json --config tuned_config.json

# With calibration file (upstream format)
python -m app.main /path/to/audio.m4a -o /path/to/output.json --calibration calibration.json
```

Enable progress output:
```bash
FJ_PROGRESS=1 python -m app.main audio.m4a -o output.json
```

## Configuration Files

### tuned_config.json (Legacy)

Full analysis configuration with PCA calibration matrices:

```json
{
  "sample_rate": 22050,
  "hop_length": 512,
  "use_madmom_downbeats": true,
  "timbre_calibration_matrix": [[...]],
  ...
}
```

### calibration.json (Upstream)

Simpler affine calibration format:

```json
{
  "timbre": {"a": [...], "b": [...]},
  "loudness": {"start": {"a": 0.75, "b": -9.0}, "max": {...}},
  "confidence": {"source": [...], "target": [...]},
  "pitch": {"power": 0.7, "weights": [...]}
}
```

## Architecture

```
app/
├── analysis.py        # Main analysis pipeline (merged upstream + GPU)
├── audio.py           # FFmpeg-based audio decoding
├── beats.py           # madmom beat/downbeat detection
├── config.py          # Configuration (supports both formats)
├── features.py        # Legacy scipy-based features
├── features_essentia.py  # Essentia + GPU hybrid features
├── features_gpu.py    # GPU-accelerated operations
├── gpu.py             # GPU detection and utilities
├── main.py            # CLI entry point
└── segmentation.py    # Novelty-based segmentation
```

## Credits

- [madmom](https://github.com/CPJKU/madmom) - Beat/downbeat tracking
- [Essentia](https://essentia.upf.edu/) - Audio feature extraction
- [Remixatron](https://github.com/beefoo/remixatron) - Segmentation concepts
- Original Forever Jukebox by [UnderMybrella](https://github.com/UnderMybrella/EternalJukebox)
