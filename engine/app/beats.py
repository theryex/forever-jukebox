from typing import List, Tuple

import collections
import collections.abc
import math
import warnings

import numpy as np
from scipy import signal as scipy_signal

_CACHED = {}


def _madmom_downbeats(proc, activations: np.ndarray) -> np.ndarray:
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


def _get_downbeat_processors():
    proc = _CACHED.get("downbeat_proc")
    tracker = _CACHED.get("downbeat_tracker")
    if proc is None or tracker is None:
        from madmom.features.downbeats import DBNDownBeatTrackingProcessor, RNNDownBeatProcessor
        proc = RNNDownBeatProcessor(fps=100)
        tracker = DBNDownBeatTrackingProcessor(beats_per_bar=[3, 4], fps=100)
        _CACHED["downbeat_proc"] = proc
        _CACHED["downbeat_tracker"] = tracker
    return proc, tracker


def extract_beats(audio: np.ndarray, sample_rate: int, batch: bool = False) -> Tuple[List[float], List[int]]:
    """Return beat times and beat numbers (1-based within bar)."""
    if not hasattr(collections, "MutableSequence"):
        collections.MutableSequence = collections.abc.MutableSequence
    if not hasattr(collections, "MutableMapping"):
        collections.MutableMapping = collections.abc.MutableMapping
    if not hasattr(collections, "MutableSet"):
        collections.MutableSet = collections.abc.MutableSet
    # Avoid NumPy deprecation warnings by checking the module dict directly.
    if "float" not in np.__dict__:
        np.float = float
    if "int" not in np.__dict__:
        np.int = int
    if "bool" not in np.__dict__:
        np.bool = bool
    if "complex" not in np.__dict__:
        np.complex = complex
    warnings.filterwarnings(
        "ignore",
        message="pkg_resources is deprecated as an API.*",
        category=UserWarning,
        module="madmom",
    )
    madmom_sr = 44100
    signal = np.asarray(audio, dtype=np.float32)
    if sample_rate != madmom_sr and signal.size:
        g = math.gcd(int(sample_rate), madmom_sr)
        up = madmom_sr // g
        down = int(sample_rate) // g
        signal = scipy_signal.resample_poly(signal, up, down).astype(np.float32)
    if batch:
        proc, tracker = _get_downbeat_processors()
    else:
        from madmom.features.downbeats import DBNDownBeatTrackingProcessor, RNNDownBeatProcessor
        proc = RNNDownBeatProcessor(fps=100)
        tracker = DBNDownBeatTrackingProcessor(beats_per_bar=[3, 4], fps=100)
    act = proc(signal)
    try:
        downbeats = _madmom_downbeats(tracker, act)
        times = downbeats[:, 0].tolist()
        beat_numbers = downbeats[:, 1].astype(int).tolist()
        if times:
            return times, beat_numbers
    except Exception as exc:
        raise RuntimeError("madmom downbeats failed") from exc
    raise RuntimeError("madmom downbeats empty")
