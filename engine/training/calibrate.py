import argparse
import json
import os
import sys
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, List, Tuple

import numpy as np

ENGINE_ROOT = Path(__file__).resolve().parents[1]
if str(ENGINE_ROOT) not in sys.path:
    sys.path.insert(0, str(ENGINE_ROOT))

from app.analysis import analyze_audio  # noqa: E402


@dataclass
class SegmentationConfig:
    min_segment_duration: float = 0.25
    novelty_smoothing: int = 8
    peak_threshold: float = 0.3
    peak_prominence: float = 0.2
    max_segments_per_second: float = 2.5
    beat_snap_tolerance: float = 0.12


@dataclass
class FeatureConfig:
    sample_rate: int = 44100
    frame_size: int = 2048
    hop_size: int = 512


@dataclass
class AnalysisConfig:
    segmentation: SegmentationConfig = field(default_factory=SegmentationConfig)
    features: FeatureConfig = field(default_factory=FeatureConfig)
    tatums_per_beat: int = 2
    time_signature: int = 4

    def to_dict(self) -> Dict[str, Any]:
        return {
            "segmentation": self.segmentation.__dict__.copy(),
            "features": self.features.__dict__.copy(),
            "tatums_per_beat": self.tatums_per_beat,
            "time_signature": self.time_signature,
        }


def load_analysis(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    return data.get("analysis", data)


def segment_stats(analysis: dict) -> Dict[str, Any]:
    segments = analysis.get("segments", [])
    if not segments:
        return {}
    timbre = np.asarray([s.get("timbre", []) for s in segments], dtype=float)
    loud_start = np.asarray([s.get("loudness_start", 0.0) for s in segments], dtype=float)
    loud_max = np.asarray([s.get("loudness_max", 0.0) for s in segments], dtype=float)
    confidence = np.asarray([s.get("confidence", 0.0) for s in segments], dtype=float)
    pitches = np.asarray([s.get("pitches", []) for s in segments], dtype=float)
    durations = np.asarray([s.get("duration", 0.0) for s in segments], dtype=float)
    if timbre.size == 0 or timbre.shape[1] == 0 or pitches.size == 0 or pitches.shape[1] == 0:
        return {}
    if confidence.size == 0 or durations.size == 0:
        return {}
    return {
        "timbre_mean": timbre.mean(axis=0),
        "timbre_std": timbre.std(axis=0) + 1e-6,
        "loud_start_mean": loud_start.mean(),
        "loud_start_std": loud_start.std() + 1e-6,
        "loud_max_mean": loud_max.mean(),
        "loud_max_std": loud_max.std() + 1e-6,
        "confidence": confidence,
        "pitch_mean": pitches.mean(axis=0),
        "durations": durations,
    }


def _set_batch_env() -> None:
    os.environ.setdefault("OMP_NUM_THREADS", "1")
    os.environ.setdefault("MKL_NUM_THREADS", "1")
    os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
    os.environ.setdefault("NUMEXPR_NUM_THREADS", "1")


def worker(task: Tuple[str, str], batch: bool) -> Dict[str, Any]:
    audio_path, analysis_path = task
    if batch:
        _set_batch_env()
    generated = analyze_audio(audio_path, batch=batch)
    gold = load_analysis(Path(analysis_path))
    return {
        "generated": segment_stats(generated),
        "gold": segment_stats(gold),
        "duration": gold.get("track", {}).get("duration", 0.0),
        "segment_count": len(gold.get("segments", [])),
    }


def worker_batch(task: Tuple[str, str]) -> Dict[str, Any]:
    return worker(task, True)


def load_id_list(path: Path | None) -> set[str] | None:
    if not path:
        return None
    ids = set()
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            value = line.strip()
            if value:
                ids.add(value)
    return ids


def build_tasks(
    audio_dir: Path,
    analysis_dir: Path,
    limit: int | None,
    id_filter: set[str] | None,
) -> List[Tuple[str, str]]:
    tasks = []
    for analysis_path in analysis_dir.glob("*.json"):
        stem = analysis_path.stem
        if id_filter is not None and stem not in id_filter:
            continue
        matches = list(audio_dir.glob(stem + ".*"))
        if not matches:
            continue
        tasks.append((str(matches[0]), str(analysis_path)))
        if limit and len(tasks) >= limit:
            break
    return tasks


def compute_affine(source_mean: np.ndarray, source_std: np.ndarray,
                    target_mean: np.ndarray, target_std: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
    a = target_std / source_std
    b = target_mean - a * source_mean
    return a, b


def main() -> None:
    parser = argparse.ArgumentParser(description="Calibrate analysis parameters from training data")
    parser.add_argument("--audio-dir", required=True)
    parser.add_argument("--analysis-dir", required=True)
    parser.add_argument("-o", "--output", required=True)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--id-list", type=Path, default=None)
    parser.add_argument("--batch", action=argparse.BooleanOptionalAction, default=True)
    args = parser.parse_args()

    audio_dir = Path(args.audio_dir)
    analysis_dir = Path(args.analysis_dir)

    id_filter = load_id_list(args.id_list)
    tasks = build_tasks(audio_dir, analysis_dir, args.limit, id_filter)
    if not tasks:
        raise RuntimeError("No matching audio/analysis pairs found")
    if id_filter is not None:
        print(
            f"Loaded {len(id_filter)} ids; matched {len(tasks)} audio/analysis pairs.",
            flush=True,
        )

    gen_timbre_mean = []
    gen_timbre_std = []
    gold_timbre_mean = []
    gold_timbre_std = []
    gen_loud_start_mean = []
    gen_loud_start_std = []
    gold_loud_start_mean = []
    gold_loud_start_std = []
    gen_loud_max_mean = []
    gen_loud_max_std = []
    gold_loud_max_mean = []
    gold_loud_max_std = []
    gen_conf = []
    gold_conf = []
    gen_pitch_mean = []
    gold_pitch_mean = []

    if args.batch:
        _set_batch_env()
    with ProcessPoolExecutor(max_workers=args.workers) as executor:
        if args.batch:
            futures = [executor.submit(worker_batch, task) for task in tasks]
            result_iter = (future.result() for future in as_completed(futures))
        else:
            futures = [executor.submit(worker, task, False) for task in tasks]
            result_iter = (future.result() for future in as_completed(futures))
        completed = 0
        total = len(tasks)
        start_time = time.monotonic()
        avg_seconds = None
        for result in result_iter:
            completed += 1
            elapsed = time.monotonic() - start_time
            avg_seconds = elapsed / completed if completed > 0 else None
            remaining = (total - completed) * avg_seconds if avg_seconds is not None else 0.0
            eta_hours = int(remaining // 3600)
            eta_minutes = int((remaining % 3600) // 60)
            eta_seconds = int(remaining % 60)
            eta = f"{eta_hours:02d}:{eta_minutes:02d}:{eta_seconds:02d}"
            print(f"\r[{completed}/{total}] ETA {eta}", end="", flush=True)
            gen = result.get("generated")
            gold = result.get("gold")
            if not gen or not gold:
                continue
            gen_timbre_mean.append(gen["timbre_mean"])
            gen_timbre_std.append(gen["timbre_std"])
            gold_timbre_mean.append(gold["timbre_mean"])
            gold_timbre_std.append(gold["timbre_std"])

            gen_loud_start_mean.append(gen["loud_start_mean"])
            gen_loud_start_std.append(gen["loud_start_std"])
            gold_loud_start_mean.append(gold["loud_start_mean"])
            gold_loud_start_std.append(gold["loud_start_std"])

            gen_loud_max_mean.append(gen["loud_max_mean"])
            gen_loud_max_std.append(gen["loud_max_std"])
            gold_loud_max_mean.append(gold["loud_max_mean"])
            gold_loud_max_std.append(gold["loud_max_std"])

            gen_conf.extend(gen["confidence"].tolist())
            gold_conf.extend(gold["confidence"].tolist())
            gen_pitch_mean.append(gen["pitch_mean"])
            gold_pitch_mean.append(gold["pitch_mean"])

    print()
    gen_timbre_mean = np.mean(np.asarray(gen_timbre_mean), axis=0)
    gen_timbre_std = np.mean(np.asarray(gen_timbre_std), axis=0)
    gold_timbre_mean = np.mean(np.asarray(gold_timbre_mean), axis=0)
    gold_timbre_std = np.mean(np.asarray(gold_timbre_std), axis=0)

    gen_loud_start_mean = float(np.mean(gen_loud_start_mean))
    gen_loud_start_std = float(np.mean(gen_loud_start_std))
    gold_loud_start_mean = float(np.mean(gold_loud_start_mean))
    gold_loud_start_std = float(np.mean(gold_loud_start_std))

    gen_loud_max_mean = float(np.mean(gen_loud_max_mean))
    gen_loud_max_std = float(np.mean(gen_loud_max_std))
    gold_loud_max_mean = float(np.mean(gold_loud_max_mean))
    gold_loud_max_std = float(np.mean(gold_loud_max_std))

    timbre_a, timbre_b = compute_affine(
        gen_timbre_mean, gen_timbre_std, gold_timbre_mean, gold_timbre_std
    )

    loud_start_a, loud_start_b = compute_affine(
        np.asarray([gen_loud_start_mean]), np.asarray([gen_loud_start_std]),
        np.asarray([gold_loud_start_mean]), np.asarray([gold_loud_start_std]),
    )
    loud_max_a, loud_max_b = compute_affine(
        np.asarray([gen_loud_max_mean]), np.asarray([gen_loud_max_std]),
        np.asarray([gold_loud_max_mean]), np.asarray([gold_loud_max_std]),
    )

    gen_conf = np.asarray(gen_conf, dtype=float)
    gold_conf = np.asarray(gold_conf, dtype=float)
    quantiles = np.linspace(0, 1, 101)
    gen_q = np.quantile(gen_conf, quantiles) if gen_conf.size else np.zeros_like(quantiles)
    gold_q = np.quantile(gold_conf, quantiles) if gold_conf.size else np.zeros_like(quantiles)

    config = AnalysisConfig()

    eps = 1e-6
    if gen_pitch_mean and gold_pitch_mean:
        gen_pitch = np.asarray(gen_pitch_mean, dtype=float)
        gold_pitch = np.asarray(gold_pitch_mean, dtype=float)
        g = np.maximum(gen_pitch, eps)
        t = np.maximum(gold_pitch, eps)
        g = g / np.sum(g, axis=1, keepdims=True)
        t = t / np.sum(t, axis=1, keepdims=True)
        log_w = np.mean(np.log(t) - np.log(g), axis=0)
        weights = np.exp(log_w)
        weights = weights / float(np.mean(weights))
        best_p = 1.0
        best_loss = float("inf")
        for p in np.linspace(0.70, 1.30, 61):
            pred = (g ** p) * weights
            pred = pred / np.sum(pred, axis=1, keepdims=True)
            loss = float(np.mean((pred - t) ** 2))
            if loss < best_loss:
                best_loss = loss
                best_p = float(p)
    else:
        weights = np.ones(12, dtype=float)
        best_p = 1.0

    calibration = {
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "python": sys.version,
        "sampleCount": len(tasks),
        "timbre": {
            "a": timbre_a.tolist(),
            "b": timbre_b.tolist(),
        },
        "loudness": {
            "start": {
                "a": float(loud_start_a[0]),
                "b": float(loud_start_b[0]),
            },
            "max": {
                "a": float(loud_max_a[0]),
                "b": float(loud_max_b[0]),
            },
        },
        "confidence": {
            "source": gen_q.tolist(),
            "target": gold_q.tolist(),
        },
        "pitch": {
            "power": best_p,
            "weights": weights.tolist(),
            "normalize": "l1",
        },
        "config": config.to_dict(),
    }

    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as handle:
        json.dump(calibration, handle, indent=2)


if __name__ == "__main__":
    main()
