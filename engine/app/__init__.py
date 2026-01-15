"""Forever Jukebox analysis engine.

Combines upstream's Essentia-based analysis with GPU acceleration.
"""

from . import env  # noqa: F401
from .analysis import analyze_audio

__all__ = [
    "analyze_audio",
    "analysis",
    "audio",
    "beats",
    "config",
    "features_essentia",
    "features",
    "features_gpu",
    "gpu",
    "segmentation",
    "main",
]
