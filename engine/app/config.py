"""Configuration defaults for analysis."""

from __future__ import annotations

from dataclasses import dataclass, fields
from typing import Any, Optional


@dataclass(frozen=True)
class AnalysisConfig:
    sample_rate: int = 22050
    hop_length: int = 512
    percussive_beats_only: bool = False
    use_librosa_beats: bool = False
    use_laplacian_sections: bool = False
    use_laplacian_segments: bool = False
    use_madmom_downbeats: bool = False
    laplacian_cqt_bins_per_octave: int = 36
    laplacian_cqt_octaves: int = 7
    laplacian_max_clusters: int = 12
    time_signature: int = 4
    tatum_divisions: int = 2
    section_seconds: float = 30.0
    section_use_novelty: bool = True
    section_novelty_percentile: float = 90.0
    section_min_spacing_s: float = 8.0
    section_snap_bar_window_s: float = 0.2
    onset_percentile: float = 75.0
    onset_min_spacing_s: float = 0.05
    tempo_min_bpm: float = 60.0
    tempo_max_bpm: float = 200.0
    beat_snap_window_s: float = 0.07
    segment_min_duration_s: float = 0.05
    timbre_standardize: bool = True
    timbre_scale: float = 10.0
    segment_snap_bar_window_s: float = 0.12
    segment_snap_beat_window_s: float = 0.06
    novelty_smooth_frames: int = 3
    mfcc_window_ms: float = 25.0
    mfcc_hop_ms: float = 10.0
    mfcc_n_mels: int = 40
    mfcc_n_mfcc: int = 12
    mfcc_use_0th: bool = True
    timbre_calibration_matrix: Optional[list[list[float]]] = None
    timbre_calibration_bias: Optional[list[float]] = None
    timbre_mode: str = "mfcc"
    timbre_pca_components: Optional[list[list[float]]] = None
    timbre_pca_mean: Optional[list[float]] = None
    beat_novelty_percentile: float = 75.0
    beat_novelty_min_spacing: int = 1
    timbre_unit_norm: bool = False
    segment_selfsim_kernel_beats: int = 4
    segment_selfsim_percentile: float = 85.0
    segment_selfsim_min_spacing_beats: int = 2
    section_selfsim_kernel_beats: int = 16
    section_selfsim_percentile: float = 80.0
    section_selfsim_min_spacing_beats: int = 8
    section_merge_similarity: float = 0.0
    segment_scalar_scale: Optional[dict[str, float]] = None
    segment_scalar_bias: Optional[dict[str, float]] = None
    pitch_scale: Optional[list[float]] = None
    pitch_bias: Optional[list[float]] = None
    pitch_calibration_matrix: Optional[list[list[float]]] = None
    pitch_calibration_bias: Optional[list[float]] = None
    segment_quantile_maps: Optional[dict[str, dict[str, list[float]]]] = None
    segment_include_bounds: bool = True
    boundary_model_weights: Optional[list[float]] = None
    boundary_model_bias: Optional[float] = None
    boundary_percentile: float = 80.0
    boundary_min_spacing_s: float = 0.05
    start_offset_map_src: Optional[list[float]] = None
    start_offset_map_dst: Optional[list[float]] = None
    target_segment_rate: Optional[float] = None
    target_segment_rate_tolerance: float = 0.1
    target_section_rate: Optional[float] = None
    target_section_rate_tolerance: float = 0.2
    section_include_bounds: bool = True


def config_from_dict(data: dict[str, Any]) -> AnalysisConfig:
    defaults = AnalysisConfig()
    kwargs = {field.name: getattr(defaults, field.name) for field in fields(AnalysisConfig)}

    bool_fields = {
        "percussive_beats_only",
        "use_librosa_beats",
        "use_laplacian_sections",
        "use_laplacian_segments",
        "use_madmom_downbeats",
        "section_use_novelty",
        "timbre_standardize",
        "mfcc_use_0th",
        "timbre_unit_norm",
        "segment_include_bounds",
        "section_include_bounds",
    }
    int_fields = {
        "sample_rate",
        "hop_length",
        "laplacian_cqt_bins_per_octave",
        "laplacian_cqt_octaves",
        "laplacian_max_clusters",
        "time_signature",
        "tatum_divisions",
        "novelty_smooth_frames",
        "mfcc_n_mels",
        "mfcc_n_mfcc",
        "beat_novelty_min_spacing",
        "segment_selfsim_kernel_beats",
        "segment_selfsim_min_spacing_beats",
        "section_selfsim_kernel_beats",
        "section_selfsim_min_spacing_beats",
    }
    float_fields = {
        "section_seconds",
        "section_novelty_percentile",
        "section_min_spacing_s",
        "section_snap_bar_window_s",
        "onset_percentile",
        "onset_min_spacing_s",
        "tempo_min_bpm",
        "tempo_max_bpm",
        "beat_snap_window_s",
        "segment_min_duration_s",
        "timbre_scale",
        "segment_snap_bar_window_s",
        "segment_snap_beat_window_s",
        "mfcc_window_ms",
        "mfcc_hop_ms",
        "beat_novelty_percentile",
        "segment_selfsim_percentile",
        "section_selfsim_percentile",
        "section_merge_similarity",
        "boundary_percentile",
        "boundary_min_spacing_s",
        "target_segment_rate_tolerance",
        "target_section_rate_tolerance",
    }
    str_fields = {"timbre_mode"}
    passthrough_fields = {
        "timbre_calibration_matrix",
        "timbre_calibration_bias",
        "timbre_pca_components",
        "timbre_pca_mean",
        "segment_scalar_scale",
        "segment_scalar_bias",
        "pitch_scale",
        "pitch_bias",
        "pitch_calibration_matrix",
        "pitch_calibration_bias",
        "segment_quantile_maps",
        "boundary_model_weights",
        "boundary_model_bias",
        "start_offset_map_src",
        "start_offset_map_dst",
        "target_segment_rate",
        "target_section_rate",
    }

    for name in bool_fields:
        kwargs[name] = bool(data.get(name, kwargs[name]))
    for name in int_fields:
        kwargs[name] = int(data.get(name, kwargs[name]))
    for name in float_fields:
        kwargs[name] = float(data.get(name, kwargs[name]))
    for name in str_fields:
        kwargs[name] = str(data.get(name, kwargs[name]))
    for name in passthrough_fields:
        if name in data:
            kwargs[name] = data[name]

    return AnalysisConfig(**kwargs)
