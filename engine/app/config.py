import json
from dataclasses import dataclass, field
from typing import Dict, Any


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
    sample_rate: int = 22050
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

    @staticmethod
    def from_dict(data: Dict[str, Any]) -> "AnalysisConfig":
        seg = data.get("segmentation", {})
        feat = data.get("features", {})
        return AnalysisConfig(
            segmentation=SegmentationConfig(**seg),
            features=FeatureConfig(**feat),
            tatums_per_beat=data.get("tatums_per_beat", 2),
            time_signature=data.get("time_signature", 4),
        )


def load_calibration(path: str) -> Dict[str, Any]:
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)
