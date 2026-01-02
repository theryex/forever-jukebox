"""Small analysis helpers shared by the analyzer pipeline."""

from __future__ import annotations

import math
from typing import Any

import numpy as np

from .config import AnalysisConfig


def _round_floats(obj: Any, ndigits: int = 5) -> Any:
    if isinstance(obj, float):
        return round(obj, ndigits)
    if isinstance(obj, list):
        return [_round_floats(item, ndigits) for item in obj]
    if isinstance(obj, dict):
        return {key: _round_floats(value, ndigits) for key, value in obj.items()}
    return obj


def _read_track_metadata(path: str) -> dict[str, str]:
    try:
        from mutagen import File as MutagenFile
    except Exception:
        return {}

    try:
        audio = MutagenFile(path, easy=True)
    except Exception:
        return {}

    if not audio or not getattr(audio, "tags", None):
        return {}

    def first_tag_value(key: str) -> str | None:
        value = audio.tags.get(key)
        if not value:
            return None
        if isinstance(value, list):
            return str(value[0]) if value else None
        return str(value)

    metadata: dict[str, str] = {}
    title = first_tag_value("title")
    artist = first_tag_value("artist")
    if title:
        metadata["title"] = title
    if artist:
        metadata["artist"] = artist
    return metadata


def _sanitize_small_values(obj: Any, parent_key: str | None = None, threshold: float = 1e-4) -> Any:
    if isinstance(obj, float):
        if parent_key not in {"pitches", "timbre"} and abs(obj) < threshold:
            return 0.0
        return obj
    if isinstance(obj, list):
        return [_sanitize_small_values(item, parent_key, threshold) for item in obj]
    if isinstance(obj, dict):
        return {key: _sanitize_small_values(value, key, threshold) for key, value in obj.items()}
    return obj


def _segment_times(
    onset_times: np.ndarray, duration: float, include_start: bool = True, include_end: bool = True
) -> np.ndarray:
    parts = [onset_times]
    if include_start:
        parts.insert(0, np.array([0.0], dtype=float))
    if include_end:
        parts.append(np.array([duration], dtype=float))
    times = np.unique(np.concatenate(parts))
    times = times[(times >= 0) & (times <= duration)]
    if len(times) < 2:
        return np.array([0.0, duration])
    return times


def _frame_slice(time_start: float, time_end: float, sr: int, hop_length: int) -> tuple[int, int]:
    start = int(math.floor(time_start * sr / hop_length))
    end = int(math.ceil(time_end * sr / hop_length))
    return max(0, start), max(start + 1, end)


def _events_from_times(times: np.ndarray, confidences: list[float], duration: float) -> list[dict[str, float]]:
    events = []
    for idx, start in enumerate(times):
        end = times[idx + 1] if idx + 1 < len(times) else duration
        if end <= start:
            continue
        events.append(
            {
                "start": float(start),
                "duration": float(end - start),
                "confidence": float(confidences[idx]) if idx < len(confidences) else 0.0,
            }
        )
    return events


def _fix_event_end(events: list[dict[str, Any]], duration: float) -> None:
    if not events:
        return
    last = events[-1]
    start = float(last.get("start", 0.0))
    if start < 0:
        start = 0.0
        last["start"] = 0.0
    new_duration = max(0.0, duration - start)
    last["duration"] = new_duration


def _normalize_event_durations(events: list[dict[str, Any]], duration: float) -> None:
    if not events:
        return
    events.sort(key=lambda item: float(item.get("start", 0.0)))
    for idx in range(len(events) - 1):
        start = float(events[idx].get("start", 0.0))
        next_start = float(events[idx + 1].get("start", start))
        events[idx]["duration"] = max(0.0, next_start - start)
    _fix_event_end(events, duration)


def _apply_segment_calibration(segment: dict[str, Any], cfg: AnalysisConfig) -> None:
    if cfg.segment_quantile_maps:
        for field, mapping in cfg.segment_quantile_maps.items():
            if field not in segment:
                continue
            src = mapping.get("src", [])
            dst = mapping.get("dst", [])
            if len(src) >= 2 and len(src) == len(dst):
                value = float(segment[field])
                segment[field] = float(np.interp(value, src, dst))

    if cfg.segment_scalar_scale and cfg.segment_scalar_bias:
        for field, scale in cfg.segment_scalar_scale.items():
            if field not in segment:
                continue
            bias = float(cfg.segment_scalar_bias.get(field, 0.0))
            value = float(segment[field])
            segment[field] = value * float(scale) + bias

    if "confidence" in segment:
        segment["confidence"] = min(1.0, max(0.0, float(segment["confidence"])))
    if "loudness_max_time" in segment:
        max_time = float(segment.get("duration", 0.0))
        segment["loudness_max_time"] = min(max_time, max(0.0, float(segment["loudness_max_time"])))


def _madmom_downbeats(proc: Any, activations: np.ndarray) -> np.ndarray:
    first = 0
    if proc.threshold:
        idx = np.nonzero(activations >= proc.threshold)[0]
        if idx.any():
            first = max(first, int(np.min(idx)))
            last = min(len(activations), int(np.max(idx)) + 1)
        else:
            last = first
        activations = activations[first:last]
    if not activations.any():
        return np.empty((0, 2))

    results = [hmm.viterbi(activations) for hmm in proc.hmms]
    best = int(np.argmax([float(r[1]) for r in results]))
    path, _ = results[best]
    st = proc.hmms[best].transition_model.state_space
    om = proc.hmms[best].observation_model
    positions = st.state_positions[path]
    beat_numbers = positions.astype(int) + 1
    if proc.correct:
        beats = np.empty(0, dtype=int)
        beat_range = om.pointers[path] >= 1
        idx = np.nonzero(np.diff(beat_range.astype(int)))[0] + 1
        if beat_range[0]:
            idx = np.r_[0, idx]
        if beat_range[-1]:
            idx = np.r_[idx, beat_range.size]
        if idx.any():
            for left, right in idx.reshape((-1, 2)):
                peak = np.argmax(activations[left:right]) // 2 + left
                beats = np.hstack((beats, peak))
    else:
        beats = np.nonzero(np.diff(beat_numbers))[0] + 1
    return np.vstack(((beats + first) / float(proc.fps), beat_numbers[beats])).T
