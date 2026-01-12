import subprocess
from typing import Tuple

import numpy as np


class FFmpegNotFound(RuntimeError):
    pass


def decode_audio(path: str, sample_rate: int = 44100) -> Tuple[np.ndarray, int]:
    """Decode audio to mono float32 PCM using ffmpeg."""
    command = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        path,
        "-f",
        "f32le",
        "-ac",
        "1",
        "-ar",
        str(sample_rate),
        "-",
    ]
    try:
        proc = subprocess.run(command, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    except FileNotFoundError as exc:
        raise FFmpegNotFound(
            "ffmpeg is required for decoding. Install ffmpeg and ensure it is in PATH."
        ) from exc
    except subprocess.CalledProcessError as exc:
        raise RuntimeError(f"ffmpeg failed: {exc.stderr.decode('utf-8', 'ignore')}") from exc

    audio = np.frombuffer(proc.stdout, dtype=np.float32)
    return audio, sample_rate
