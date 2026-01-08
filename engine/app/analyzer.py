"""Core analysis pipeline."""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Callable

import numpy as np
import scipy
from scipy.cluster.vq import kmeans2

from . import env
from . import features
from .config import AnalysisConfig
from .constants import EPS, MIN_DURATION_S, MIN_TEMPO_WINDOW_S
from .analyzer_utils import (
    _segment_times,
    _events_from_times,
    _fix_event_end,
    _apply_segment_calibration,
    _madmom_downbeats,
)
from .io_utils import _read_track_metadata, _round_floats, _sanitize_small_values
from .progress import ProgressReporter
from .time_utils import frame_slice, frames_to_time, time_to_frames


@dataclass
class FeatureBundle:
    full_mfcc_seg: np.ndarray
    full_timbre: np.ndarray
    full_chroma: np.ndarray
    beat_mfcc: np.ndarray
    beat_chroma: np.ndarray
    beat_novelty: np.ndarray
    section_novelty: np.ndarray
    onset_peaks: np.ndarray
    novelty_norm: np.ndarray
    onset_norm: np.ndarray
    combined: np.ndarray
    mfcc_frame_length: int
    mfcc_hop_length: int


def _compute_beats(
    cfg: AnalysisConfig,
    y_beats: np.ndarray,
    sr: int,
    duration: float,
    reporter: ProgressReporter,
) -> tuple[float, np.ndarray, np.ndarray, list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], list[float]]:
    tempo = 120.0
    ramp = reporter.ramp(50, 75, "beats_wait", duration)

    if cfg.use_madmom_downbeats:
        import warnings

        warnings.filterwarnings(
            "ignore",
            message="pkg_resources is deprecated as an API.*",
            category=UserWarning,
        )
        if np.lib.NumpyVersion(np.__version__) >= "1.24.0":
            for name, alias in (("float", float), ("int", int), ("complex", complex)):
                if not hasattr(np, name):
                    setattr(np, name, alias)
        import collections
        from collections import abc as collections_abc

        if not hasattr(collections, "MutableSequence"):
            collections.MutableSequence = collections_abc.MutableSequence
            collections.MutableMapping = collections_abc.MutableMapping
            collections.MutableSet = collections_abc.MutableSet
        import madmom

        fps = 100
        madmom_sr = 44100
        y_madmom = y_beats
        if sr != madmom_sr:
            y_madmom = features.resample_audio(y_beats, sr, madmom_sr)
        proc = madmom.features.DBNDownBeatTrackingProcessor(beats_per_bar=[3, 4], fps=fps)
        act = madmom.features.RNNDownBeatProcessor(fps=fps)(y_madmom)
        downbeats = _madmom_downbeats(proc, act)
        if not downbeats.size:
            raise RuntimeError("madmom downbeats empty")
        beat_times = downbeats[:, 0].astype(float)
        beat_times = beat_times[beat_times <= duration]
        onset_env = features.onset_envelope(y_beats, sr, hop_length=cfg.hop_length)
        tempo = 60.0 * (len(beat_times) / max(duration, MIN_TEMPO_WINDOW_S)) if beat_times.size else tempo
    elif cfg.use_librosa_beats:
        import librosa

        onset_env = features.onset_envelope(y_beats, sr, hop_length=cfg.hop_length)
        tempo, beat_frames = librosa.beat.beat_track(
            onset_envelope=onset_env,
            sr=sr,
            hop_length=cfg.hop_length,
            trim=False,
        )
        beat_times = librosa.frames_to_time(beat_frames, sr=sr, hop_length=cfg.hop_length)
    else:
        tempo, beat_times, onset_env = features.beat_track(
            y_beats,
            sr,
            hop_length=cfg.hop_length,
            min_bpm=cfg.tempo_min_bpm,
            max_bpm=cfg.tempo_max_bpm,
        )

    reporter.report(60, "beats_track")
    if beat_times.size == 0:
        tempo = 120.0
        beat_times = np.arange(0.0, max(duration, MIN_DURATION_S), 60.0 / tempo)
        onset_env = np.ones(int(math.ceil(duration * sr / cfg.hop_length)))

    onset_peaks = features.detect_peaks(
        onset_env,
        sr,
        hop_length=cfg.hop_length,
        percentile=cfg.onset_percentile,
        min_spacing_s=cfg.onset_min_spacing_s,
    )
    beat_times = features.snap_times_to_peaks(beat_times, onset_peaks, window_s=cfg.beat_snap_window_s)
    beat_conf = features.sample_confidence(beat_times, onset_env, sr, hop_length=cfg.hop_length)
    reporter.report(65, "beats_snap")

    beats = _events_from_times(beat_times, beat_conf, duration)
    reporter.stop_ramp(ramp)
    reporter.report(75, "beats")

    bars = []
    if beats:
        bar_starts = beat_times[:: cfg.time_signature]
        bar_conf = beat_conf[:: cfg.time_signature]
        bars = _events_from_times(bar_starts, bar_conf, duration)
        _fix_event_end(bars, duration)

    tatums = []
    if beats:
        tatum_times = []
        tatum_conf = []
        for idx in range(len(beat_times)):
            start = beat_times[idx]
            end = beat_times[idx + 1] if idx + 1 < len(beat_times) else duration
            if end <= start:
                continue
            step = (end - start) / cfg.tatum_divisions
            for t in range(cfg.tatum_divisions):
                tatum_times.append(start + t * step)
                tatum_conf.append(beat_conf[idx])
        if tatum_times:
            tatums = _events_from_times(np.array(tatum_times), tatum_conf, duration)
            _fix_event_end(tatums, duration)

    return tempo, beat_times, onset_env, beats, bars, tatums, beat_conf


def _compute_feature_bundle(
    cfg: AnalysisConfig,
    y: np.ndarray,
    sr: int,
    beat_times: np.ndarray,
    onset_env: np.ndarray,
    reporter: ProgressReporter,
) -> FeatureBundle:
    mfcc_frame_length = max(256, int(round(sr * cfg.mfcc_window_ms / 1000.0)))
    mfcc_hop_length = max(1, int(round(sr * cfg.mfcc_hop_ms / 1000.0)))

    full_mfcc_seg = features.mfcc_frames(
        y,
        sr,
        hop_length=cfg.hop_length,
        frame_length=features.DEFAULT_FRAME_LENGTH,
        n_mfcc=cfg.mfcc_n_mfcc,
        n_mels=cfg.mfcc_n_mels,
        include_0th=cfg.mfcc_use_0th,
    )
    if cfg.timbre_mode == "pca":
        full_timbre = features.log_mel_frames(
            y,
            sr,
            hop_length=mfcc_hop_length,
            frame_length=mfcc_frame_length,
            n_mels=cfg.mfcc_n_mels,
        )
    else:
        full_timbre = features.mfcc_frames(
            y,
            sr,
            hop_length=mfcc_hop_length,
            frame_length=mfcc_frame_length,
            n_mfcc=cfg.mfcc_n_mfcc,
            n_mels=cfg.mfcc_n_mels,
            include_0th=cfg.mfcc_use_0th,
        )
    full_chroma = features.chroma_frames(y, sr, hop_length=cfg.hop_length)
    reporter.report(80, "features")

    beat_frames = time_to_frames(beat_times, sr, cfg.hop_length) if beat_times.size > 0 else np.array([])
    beat_mfcc = features.beat_sync_mean(full_mfcc_seg, beat_frames)
    beat_chroma = features.beat_sync_mean(full_chroma, beat_frames)
    beat_novelty = features.novelty_from_ssm(
        features.cosine_similarity_matrix(beat_mfcc), cfg.segment_selfsim_kernel_beats
    )
    section_novelty = features.novelty_from_ssm(
        features.cosine_similarity_matrix(beat_chroma), cfg.section_selfsim_kernel_beats
    )

    novelty = np.zeros(full_mfcc_seg.shape[1])
    for i in range(1, full_mfcc_seg.shape[1]):
        prev = full_mfcc_seg[:, i - 1]
        curr = full_mfcc_seg[:, i]
        denom = (np.linalg.norm(prev) * np.linalg.norm(curr)) + EPS
        novelty[i] = 1.0 - float(np.dot(prev, curr) / denom)

    min_len = min(len(novelty), len(onset_env))
    novelty_norm = novelty[:min_len]
    onset_norm = onset_env[:min_len]
    if novelty_norm.size:
        novelty_norm = novelty_norm / (np.max(novelty_norm) + EPS)
    if onset_norm.size:
        onset_norm = onset_norm / (np.max(onset_norm) + EPS)
    combined = novelty_norm + onset_norm
    if cfg.novelty_smooth_frames > 1:
        kernel = np.ones(cfg.novelty_smooth_frames) / float(cfg.novelty_smooth_frames)
        combined = np.convolve(combined, kernel, mode="same")

    onset_peaks = features.detect_peaks(
        onset_env,
        sr,
        hop_length=cfg.hop_length,
        percentile=cfg.onset_percentile,
        min_spacing_s=cfg.onset_min_spacing_s,
    )

    return FeatureBundle(
        full_mfcc_seg=full_mfcc_seg,
        full_timbre=full_timbre,
        full_chroma=full_chroma,
        beat_mfcc=beat_mfcc,
        beat_chroma=beat_chroma,
        beat_novelty=beat_novelty,
        section_novelty=section_novelty,
        onset_peaks=onset_peaks,
        novelty_norm=novelty_norm,
        onset_norm=onset_norm,
        combined=combined,
        mfcc_frame_length=mfcc_frame_length,
        mfcc_hop_length=mfcc_hop_length,
    )


def _compute_segments(
    cfg: AnalysisConfig,
    y: np.ndarray,
    sr: int,
    duration: float,
    beat_times: np.ndarray,
    bars: list[dict[str, Any]],
    onset_env: np.ndarray,
    bundle: FeatureBundle,
    laplacian_seg_ids: np.ndarray | None,
    reporter: ProgressReporter,
) -> tuple[list[dict[str, Any]], np.ndarray, np.ndarray]:
    onset_times = bundle.onset_peaks
    novelty_times = features.detect_peaks(
        bundle.combined,
        sr,
        hop_length=cfg.hop_length,
        percentile=cfg.onset_percentile,
        min_spacing_s=cfg.onset_min_spacing_s,
    )

    seg_seed = np.unique(np.concatenate([onset_times, novelty_times]))
    if beat_times.size > 0 and bundle.beat_novelty.size > 0:
        beat_peaks = features.detect_peaks_series(
            bundle.beat_novelty,
            percentile=cfg.segment_selfsim_percentile,
            min_distance=cfg.segment_selfsim_min_spacing_beats,
        )
        if beat_peaks.size:
            seg_seed = np.unique(np.concatenate([seg_seed, beat_times[beat_peaks]]))

    min_len = min(len(onset_env), len(bundle.novelty_norm))
    if min_len:
        onset_feat = bundle.onset_norm[:min_len]
        novelty_feat = bundle.novelty_norm[:min_len]
        beat_feat = np.zeros(min_len, dtype=float)
        if beat_times.size >= 2:
            beat_frames = time_to_frames(beat_times, sr, cfg.hop_length)
            beat_frames = np.clip(beat_frames, 0, max(min_len - 1, 0))
            beat_frames = np.unique(beat_frames)
            for idx in range(len(beat_frames) - 1):
                start = int(beat_frames[idx])
                end = int(beat_frames[idx + 1])
                if end <= start:
                    continue
                beat_feat[start:end] = float(np.mean(onset_feat[start:end])) if onset_feat.size else 0.0

        score = None
        if cfg.boundary_model_weights and cfg.boundary_model_bias is not None:
            weights = np.array(cfg.boundary_model_weights, dtype=float)
            if weights.shape[0] == 3:
                score = (
                    weights[0] * onset_feat
                    + weights[1] * novelty_feat
                    + weights[2] * beat_feat
                    + float(cfg.boundary_model_bias)
                )

        if score is not None:
            boundary_times = features.detect_peaks(
                score,
                sr,
                hop_length=cfg.hop_length,
                percentile=cfg.boundary_percentile,
                min_spacing_s=cfg.boundary_min_spacing_s,
            )
            seg_seed = np.unique(np.concatenate([seg_seed, boundary_times]))

    seg_times = _segment_times(
        seg_seed, duration, include_start=cfg.segment_include_bounds, include_end=cfg.segment_include_bounds
    )
    if cfg.use_laplacian_segments and laplacian_seg_ids is not None:
        changes = np.flatnonzero(np.diff(laplacian_seg_ids)) + 1
        seg_seed = beat_times[changes] if beat_times.size > 0 else np.array([], dtype=float)
        seg_times = _segment_times(
            seg_seed, duration, include_start=cfg.segment_include_bounds, include_end=cfg.segment_include_bounds
        )

    beat_novelty_times = np.array([], dtype=float)
    if beat_times.size >= 2 and bundle.combined.size > 0:
        beat_frames = time_to_frames(beat_times, sr, cfg.hop_length)
        beat_frames = np.clip(beat_frames, 0, max(len(bundle.combined) - 1, 0))
        beat_frames = np.unique(beat_frames)
        if beat_frames.size >= 2:
            beat_vals = []
            for idx in range(len(beat_frames) - 1):
                start = int(beat_frames[idx])
                end = int(beat_frames[idx + 1])
                if end <= start:
                    continue
                beat_vals.append(float(np.mean(bundle.combined[start:end])))
            beat_vals = np.array(beat_vals, dtype=float)
            peaks = features.detect_peaks_series(
                beat_vals,
                percentile=cfg.beat_novelty_percentile,
                min_distance=cfg.beat_novelty_min_spacing,
            )
            if peaks.size:
                beat_novelty_times = beat_times[peaks]
                seg_times = _segment_times(
                    np.unique(np.concatenate([seg_times, beat_novelty_times])),
                    duration,
                    include_start=cfg.segment_include_bounds,
                    include_end=cfg.segment_include_bounds,
                )

    seg_times = features.enforce_min_duration(seg_times, cfg.segment_min_duration_s)
    if cfg.target_segment_rate and duration > 0:
        target_count = max(1, int(round(duration * float(cfg.target_segment_rate))))
        current_count = max(1, len(seg_times) - 1)
        tolerance = float(cfg.target_segment_rate_tolerance)
        if current_count > target_count * (1.0 + tolerance):
            min_duration = max(cfg.segment_min_duration_s, duration / target_count)
            seg_times = features.enforce_min_duration(seg_times, min_duration)

    if bars:
        bar_starts = np.array([b["start"] for b in bars], dtype=float)
        seg_times = features.snap_times_to_peaks(seg_times, bar_starts, window_s=cfg.segment_snap_bar_window_s)
    if beat_times.size > 0:
        seg_times = features.snap_times_to_peaks(seg_times, beat_times, window_s=cfg.segment_snap_beat_window_s)
    seg_times = np.unique(seg_times)
    seg_times = features.enforce_min_duration(seg_times, cfg.segment_min_duration_s)
    if cfg.target_segment_rate and duration > 0:
        target_count = max(1, int(round(duration * float(cfg.target_segment_rate))))
        current_count = max(1, len(seg_times) - 1)
        tolerance = float(cfg.target_segment_rate_tolerance)
        if current_count > target_count * (1.0 + tolerance):
            min_duration = max(cfg.segment_min_duration_s, duration / target_count)
            seg_times = features.enforce_min_duration(seg_times, min_duration)

    seg_conf = features.sample_confidence(
        seg_times[:-1], bundle.combined if bundle.combined.size else onset_env, sr, hop_length=cfg.hop_length
    )
    reporter.report(85, "segments_seed")

    db = features.rms_db(y, hop_length=cfg.hop_length)
    times = frames_to_time(np.arange(len(db)), sr, hop_length=cfg.hop_length)

    if cfg.timbre_mode == "pca":
        if cfg.timbre_pca_components and cfg.timbre_pca_mean:
            components = np.array(cfg.timbre_pca_components, dtype=float)
            mean = np.array(cfg.timbre_pca_mean, dtype=float)
            if components.shape[1] == bundle.full_timbre.shape[0] and mean.shape[0] == bundle.full_timbre.shape[0]:
                centered = bundle.full_timbre.T - mean
                bundle.full_timbre = (centered @ components.T).T
    elif cfg.timbre_standardize and bundle.full_timbre.size:
        mean = np.mean(bundle.full_timbre, axis=1, keepdims=True)
        std = np.std(bundle.full_timbre, axis=1, keepdims=True) + EPS
        bundle.full_timbre = (bundle.full_timbre - mean) / std
        bundle.full_timbre *= float(cfg.timbre_scale)

    segments: list[dict[str, Any]] = []
    seg_total = max(1, len(seg_times) - 1)
    seg_step = max(1, seg_total // 20)
    for idx in range(len(seg_times) - 1):
        start = float(seg_times[idx])
        end = float(seg_times[idx + 1])
        if end <= start:
            continue
        start_frame, end_frame = frame_slice(start, end, sr, cfg.hop_length)
        frame_slice_view = slice(start_frame, min(end_frame, len(db)))
        seg_db = db[frame_slice_view]
        seg_times_local = times[frame_slice_view] - start

        if seg_db.size == 0:
            loud_start = -60.0
            loud_max = -60.0
            loud_max_time = 0.0
        else:
            loud_start = float(seg_db[0])
            max_idx = int(np.argmax(seg_db))
            loud_max = float(seg_db[max_idx])
            loud_max_time = float(seg_times_local[max_idx]) if max_idx < len(seg_times_local) else 0.0

        start_frame, end_frame = frame_slice(start, end, sr, cfg.hop_length)
        chroma_slice = bundle.full_chroma[:, start_frame:end_frame] if bundle.full_chroma.size else np.zeros((12, 0))
        mfcc_start, mfcc_end = frame_slice(start, end, sr, bundle.mfcc_hop_length)
        timbre_slice = (
            bundle.full_timbre[:, mfcc_start:mfcc_end]
            if bundle.full_timbre.size
            else np.zeros((cfg.mfcc_n_mfcc, 0))
        )

        chroma = np.mean(chroma_slice, axis=1) if chroma_slice.size else np.zeros(12)
        mfcc = np.mean(timbre_slice, axis=1) if timbre_slice.size else np.zeros(cfg.mfcc_n_mfcc)

        if cfg.timbre_unit_norm:
            norm = float(np.linalg.norm(mfcc)) if mfcc.size else 0.0
            if norm > 0:
                mfcc = mfcc / norm

        if cfg.timbre_calibration_matrix and cfg.timbre_calibration_bias:
            matrix = np.array(cfg.timbre_calibration_matrix, dtype=float)
            bias = np.array(cfg.timbre_calibration_bias, dtype=float)
            if matrix.shape == (cfg.mfcc_n_mfcc, cfg.mfcc_n_mfcc) and bias.shape == (cfg.mfcc_n_mfcc,):
                mfcc = mfcc @ matrix + bias

        loud_end = float(seg_db[-1]) if seg_db.size else loud_start

        segments.append(
            {
                "start": start,
                "duration": end - start,
                "confidence": float(seg_conf[idx]) if idx < len(seg_conf) else 0.0,
                "loudness_start": loud_start,
                "loudness_max_time": loud_max_time,
                "loudness_max": loud_max,
                "loudness_end": loud_end,
                "pitches": features.normalize_vector(chroma),
                "timbre": [float(v) for v in mfcc.tolist()],
            }
        )
        if reporter.callback and (idx + 1) % seg_step == 0:
            ratio = (idx + 1) / seg_total
            reporter.report(85 + int(round(5 * ratio)), "segments_build")

    if cfg.pitch_scale and cfg.pitch_bias:
        if len(cfg.pitch_scale) == 12 and len(cfg.pitch_bias) == 12:
            for segment in segments:
                pitches = segment.get("pitches", [])
                if len(pitches) != 12:
                    continue
                adjusted = []
                for idx, val in enumerate(pitches):
                    new_val = float(val) * float(cfg.pitch_scale[idx]) + float(cfg.pitch_bias[idx])
                    adjusted.append(min(1.0, max(0.0, new_val)))
                max_val = max(adjusted) if adjusted else 0.0
                if max_val > 0:
                    adjusted = [val / max_val for val in adjusted]
                segment["pitches"] = adjusted
    if cfg.pitch_calibration_matrix and cfg.pitch_calibration_bias:
        matrix = np.array(cfg.pitch_calibration_matrix, dtype=float)
        bias = np.array(cfg.pitch_calibration_bias, dtype=float)
        if matrix.shape == (12, 12) and bias.shape == (12,):
            for segment in segments:
                pitches = segment.get("pitches", [])
                if len(pitches) != 12:
                    continue
                vec = np.array([float(v) for v in pitches], dtype=float)
                vec = vec @ matrix + bias
                vec = np.clip(vec, 0.0, 1.0)
                max_val = float(np.max(vec)) if vec.size else 0.0
                if max_val > 0:
                    vec = vec / max_val
                segment["pitches"] = [float(v) for v in vec.tolist()]

    for segment in segments:
        _apply_segment_calibration(segment, cfg)
    reporter.report(90, "segments_final")

    if cfg.start_offset_map_src and cfg.start_offset_map_dst:
        src = np.array(cfg.start_offset_map_src, dtype=float)
        dst = np.array(cfg.start_offset_map_dst, dtype=float)
        if src.size >= 2 and src.size == dst.size and duration > 0:
            for segment in segments:
                start = float(segment.get("start", 0.0))
                norm = min(1.0, max(0.0, start / duration))
                offset = float(np.interp(norm, src, dst))
                segment["start"] = min(duration, max(0.0, start + offset))

    for idx in range(len(segments) - 1):
        segments[idx]["loudness_end"] = segments[idx + 1]["loudness_start"]
    if segments:
        segments[-1]["loudness_end"] = segments[-1]["loudness_start"]
        if cfg.segment_include_bounds:
            _fix_event_end(segments, duration)

    return segments, seg_times, beat_novelty_times


def _compute_sections(
    cfg: AnalysisConfig,
    y: np.ndarray,
    sr: int,
    duration: float,
    beat_times: np.ndarray,
    bars: list[dict[str, Any]],
    onset_env: np.ndarray,
    bundle: FeatureBundle,
    tempo: float,
    reporter: ProgressReporter,
) -> list[dict[str, Any]]:
    section_times = np.array([])
    if cfg.use_laplacian_sections and beat_times.size >= 2:
        beat_frames = time_to_frames(beat_times, sr, cfg.hop_length)
        beat_frames = np.unique(np.clip(beat_frames, 0, max(bundle.full_chroma.shape[1] - 1, 0)))
        bins_per_octave = int(cfg.laplacian_cqt_bins_per_octave)
        n_octaves = int(cfg.laplacian_cqt_octaves)
        n_bins = bins_per_octave * n_octaves
        cqt_db = features.cqt_like(
            y,
            sr,
            hop_length=cfg.hop_length,
            bins_per_octave=bins_per_octave,
            n_bins=n_bins,
        )
        cqt_sync = features.beat_sync_mean(cqt_db, beat_frames)

        R = features.cosine_similarity_matrix(cqt_sync)
        Rf = scipy.ndimage.median_filter(R, size=(1, 7))

        mfcc_sync = bundle.beat_mfcc if bundle.beat_mfcc.size else np.zeros((cfg.mfcc_n_mfcc, 0))
        path_distance = np.sum(np.diff(mfcc_sync, axis=1) ** 2, axis=0)
        sigma = float(np.median(path_distance)) if path_distance.size else 1.0
        sigma = max(sigma, EPS)
        path_sim = np.exp(-path_distance / sigma)
        R_path = np.diag(path_sim, k=1) + np.diag(path_sim, k=-1)

        deg_path = np.sum(R_path, axis=1)
        deg_rec = np.sum(Rf, axis=1)
        denom = np.sum((deg_path + deg_rec) ** 2)
        mu = float(deg_path.dot(deg_path + deg_rec) / denom) if denom > 0 else 0.5
        A = mu * Rf + (1.0 - mu) * R_path

        L = scipy.sparse.csgraph.laplacian(A, normed=True)
        _, evecs = scipy.linalg.eigh(L)
        evecs = scipy.ndimage.median_filter(evecs, size=(9, 1))
        Cnorm = np.cumsum(evecs ** 2, axis=1) ** 0.5

        if cfg.target_section_rate and duration > 0:
            k = max(2, int(round(duration * float(cfg.target_section_rate))))
        else:
            k = max(2, int(round(len(beat_times) / 8)))
        k = min(k, cfg.laplacian_max_clusters, evecs.shape[1], max(2, len(beat_times) - 1))

        if k >= 2:
            X = evecs[:, :k] / (Cnorm[:, k - 1 : k] + EPS)
            np.random.seed(0)
            _, seg_ids = kmeans2(X, k, minit="points", iter=20)
            changes = np.flatnonzero(np.diff(seg_ids)) + 1
            section_peaks = beat_times[changes]
            section_times = _segment_times(
                section_peaks,
                duration,
                include_start=cfg.section_include_bounds,
                include_end=cfg.section_include_bounds,
            )
            section_times = features.enforce_min_duration(section_times, cfg.section_min_spacing_s)
    else:
        if cfg.section_use_novelty and bundle.combined.size > 0:
            section_peaks = features.detect_peaks(
                bundle.combined,
                sr,
                hop_length=cfg.hop_length,
                percentile=cfg.section_novelty_percentile,
                min_spacing_s=cfg.section_min_spacing_s,
            )
            section_times = _segment_times(
                section_peaks, duration, include_start=cfg.section_include_bounds, include_end=cfg.section_include_bounds
            )
            if bars:
                bar_starts = np.array([b["start"] for b in bars], dtype=float)
                section_times = features.snap_times_to_peaks(
                    section_times, bar_starts, window_s=cfg.section_snap_bar_window_s
                )
            section_times = np.unique(section_times)
            section_times = features.enforce_min_duration(section_times, cfg.section_min_spacing_s)
        if beat_times.size > 0 and bundle.section_novelty.size > 0:
            section_peaks = features.detect_peaks_series(
                bundle.section_novelty,
                percentile=cfg.section_selfsim_percentile,
                min_distance=cfg.section_selfsim_min_spacing_beats,
            )
            if section_peaks.size:
                section_times = np.unique(
                    np.concatenate([section_times, beat_times[section_peaks]])
                )

    if section_times.size < 2:
        section_times = np.arange(0.0, max(duration, cfg.section_seconds), cfg.section_seconds)
        if section_times[-1] < duration:
            section_times = np.concatenate([section_times, [duration]])
    if cfg.target_section_rate and duration > 0:
        target_count = max(1, int(round(duration * float(cfg.target_section_rate))))
        current_count = max(1, len(section_times) - 1)
        tolerance = float(cfg.target_section_rate_tolerance)
        if current_count > target_count * (1.0 + tolerance):
            min_duration = max(cfg.section_min_spacing_s, duration / target_count)
            section_times = features.enforce_min_duration(section_times, min_duration)

    sections = []
    section_chroma = []
    db = features.rms_db(y, hop_length=cfg.hop_length)
    section_total = max(1, len(section_times) - 1)
    section_step = max(1, section_total // 20)
    for idx in range(len(section_times) - 1):
        start = float(section_times[idx])
        end = float(section_times[idx + 1])
        if end <= start:
            continue
        start_frame, end_frame = frame_slice(start, end, sr, cfg.hop_length)
        section_env = onset_env[start_frame:end_frame]
        if section_env.size:
            section_tempo = features.tempo_from_onset_env(
                section_env,
                sr,
                hop_length=cfg.hop_length,
                min_bpm=cfg.tempo_min_bpm,
                max_bpm=cfg.tempo_max_bpm,
            )
            tempo_conf = float(np.mean(section_env / (np.max(section_env) + EPS)))
        else:
            section_tempo = float(tempo)
            tempo_conf = 0.0
        chroma_section = (
            np.mean(bundle.full_chroma[:, start_frame:end_frame], axis=1) if bundle.full_chroma.size else np.zeros(12)
        )
        key, key_conf, mode, mode_conf = features.key_mode_from_chroma(chroma_section)

        start_frame, end_frame = frame_slice(start, end, sr, cfg.hop_length)
        frame_slice_view = slice(start_frame, min(end_frame, len(db)))
        loudness = float(np.mean(db[frame_slice_view])) if db.size else -60.0

        section_chroma.append(chroma_section)
        sections.append(
            {
                "start": start,
                "duration": end - start,
                "confidence": 0.5,
                "loudness": loudness,
                "tempo": float(section_tempo),
                "tempo_confidence": tempo_conf,
                "key": int(key),
                "key_confidence": float(key_conf),
                "mode": int(mode),
                "mode_confidence": float(mode_conf),
                "time_signature": int(cfg.time_signature),
                "time_signature_confidence": 0.8,
            }
        )
        if reporter.callback and (idx + 1) % section_step == 0:
            ratio = (idx + 1) / section_total
            reporter.report(90 + int(round(5 * ratio)), "sections_build")

    if cfg.section_merge_similarity > 0 and len(sections) > 1:
        merged_sections = []
        merged_chroma = []
        for section, chroma in zip(sections, section_chroma):
            if not merged_sections:
                merged_sections.append(section)
                merged_chroma.append(chroma)
                continue
            prev = merged_sections[-1]
            prev_chroma = merged_chroma[-1]
            similarity = features.cosine_similarity(prev_chroma, chroma)
            if similarity >= cfg.section_merge_similarity:
                prev_duration = float(prev["duration"])
                curr_duration = float(section["duration"])
                total = prev_duration + curr_duration
                if total > 0:
                    merged_chroma[-1] = (prev_chroma * prev_duration + chroma * curr_duration) / total
                prev_end = max(prev["start"] + prev["duration"], section["start"] + section["duration"])
                prev["duration"] = prev_end - prev["start"]
                if total > 0:
                    prev["loudness"] = (prev["loudness"] * prev_duration + section["loudness"] * curr_duration) / total
                    prev["tempo"] = (prev["tempo"] * prev_duration + section["tempo"] * curr_duration) / total
                    prev["tempo_confidence"] = (
                        (prev["tempo_confidence"] * prev_duration + section["tempo_confidence"] * curr_duration)
                        / total
                    )
                key, key_conf, mode, mode_conf = features.key_mode_from_chroma(merged_chroma[-1])
                prev["key"] = int(key)
                prev["key_confidence"] = float(key_conf)
                prev["mode"] = int(mode)
                prev["mode_confidence"] = float(mode_conf)
                prev["confidence"] = max(float(prev["confidence"]), float(section["confidence"]))
            else:
                merged_sections.append(section)
                merged_chroma.append(chroma)
        sections = merged_sections
    if cfg.section_include_bounds:
        _fix_event_end(sections, duration)
    reporter.report(95, "sections")

    return sections


def _build_track(path: str, duration: float, tempo: float, cfg: AnalysisConfig) -> dict[str, Any]:
    track = {
        "duration": round(duration, 5),
        "tempo": float(tempo),
        "time_signature": int(cfg.time_signature),
    }
    track.update(_read_track_metadata(path))
    return track

def analyze_audio(
    path: str,
    config: AnalysisConfig | None = None,
    progress_cb: Callable[[int, str], None] | None = None,
) -> dict[str, Any]:
    cfg = config or AnalysisConfig()
    reporter = ProgressReporter(progress_cb)
    
    # Initialize GPU if enabled and available
    if cfg.use_gpu:
        try:
            from .gpu import detect_gpu, GPUBackend, get_gpu_info
            backend = detect_gpu()
            if backend != GPUBackend.NONE:
                info = get_gpu_info()
                gpu_name = info.get("name", "Unknown")
                reporter.report(1, f"gpu_{backend.value}_{gpu_name}")
        except ImportError:
            pass  # GPU module not available
    
    reporter.report(50, "load_audio")
    y, sr = features.load_audio(path, sr=cfg.sample_rate)
    y_beats = y
    if cfg.percussive_beats_only:
        y_beats = features.percussive_component(y, sr, hop_length=cfg.hop_length)
        reporter.report(55, "percussive")
    duration = float(len(y) / sr) if sr else 0.0
    tempo, beat_times, onset_env, beats, bars, tatums, beat_conf = _compute_beats(
        cfg, y_beats, sr, duration, reporter
    )
    bundle = _compute_feature_bundle(cfg, y, sr, beat_times, onset_env, reporter)
    segments, seg_times, beat_novelty_times = _compute_segments(
        cfg,
        y,
        sr,
        duration,
        beat_times,
        bars,
        onset_env,
        bundle,
        None,
        reporter,
    )
    sections = _compute_sections(
        cfg,
        y,
        sr,
        duration,
        beat_times,
        bars,
        onset_env,
        bundle,
        tempo,
        reporter,
    )
    track = _build_track(path, duration, tempo, cfg)

    result = {
        "track": track,
        "bars": bars,
        "beats": beats,
        "sections": sections,
        "segments": segments,
        "tatums": tatums,
    }

    reporter.report(100, "finalize")
    return _round_floats(_sanitize_small_values(result))
