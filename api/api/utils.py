"""Shared API utilities."""

from __future__ import annotations

import logging
from pathlib import Path


LOGGER_NAME = "foreverjukebox.api"


def get_logger(name: str = LOGGER_NAME) -> logging.Logger:
    logger = logging.getLogger(name)
    if not logger.handlers:
        handler = logging.StreamHandler()
        formatter = logging.Formatter("[%(levelname)s] %(message)s")
        handler.setFormatter(formatter)
        logger.addHandler(handler)
    logger.setLevel(logging.INFO)
    return logger


def abs_storage_path(storage_root: Path, path_str: str) -> Path:
    path = Path(path_str)
    if path.is_absolute():
        if path.exists():
            return path
        audio_candidate = storage_root / "audio" / path.name
        if audio_candidate.exists():
            return audio_candidate
        analysis_candidate = storage_root / "analysis" / path.name
        if analysis_candidate.exists():
            return analysis_candidate
        return path
    return (storage_root / path).resolve()
