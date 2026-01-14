# Training Calibration

`calibrate.py` calibrates feature transforms by comparing engine output to
baseline analyses. It matches files by stem between `audio/` and `analysis/`.

Usage:

```bash
python engine/training/calibrate.py \
  --audio-dir engine/training/audio \
  --analysis-dir engine/training/analysis \
  --output engine/calibration.json \
  --id-list engine/training/ids.txt
```

Options:
- `--audio-dir` and `--analysis-dir` point to matching audio/JSON folders.
- `--output` writes the calibration JSON.
- `--id-list` restricts to the ids listed in `ids.txt`.
- `--workers`, `--limit`, `--batch` match the existing CLI flags.
