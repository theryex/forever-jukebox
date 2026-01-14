# Engine Test Utilities

## Compare analysis outputs

`compare.py` compares two analysis JSON outputs using the same graph/branching
metrics as the app. It can also run the engine to generate the comparison file.

Run with engine generation:

```bash
python engine/test/compare.py \
  --benchmark /path/to/benchmark.json \
  --audio /path/to/track.m4a \
  --calibration engine/calibration.json
```

Run with two analysis JSON files:

```bash
python engine/test/compare.py \
  --benchmark /path/to/benchmark.json \
  --compare /path/to/analysis.json
```

Notes:
- `--benchmark` is required.
- Pass exactly one of `--audio` or `--compare`.
- Output prints similarity and component scores to stdout.
