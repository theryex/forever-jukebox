from typing import Dict

import numpy as np

from .config import FeatureConfig


class FeatureExtractionError(RuntimeError):
    pass


def compute_frame_features(audio: np.ndarray, config: FeatureConfig) -> Dict[str, np.ndarray]:
    try:
        import essentia.standard as es
    except ImportError as exc:
        raise FeatureExtractionError("essentia is required for feature extraction") from exc

    frame_size = config.frame_size
    hop_size = config.hop_size
    sample_rate = config.sample_rate

    window = es.Windowing(type="hann")
    spectrum = es.Spectrum(size=frame_size)
    mfcc = es.MFCC(highFrequencyBound=11025, numberCoefficients=13, inputSize=frame_size // 2 + 1)
    spectral_peaks = es.SpectralPeaks(orderBy="magnitude", magnitudeThreshold=1e-6)
    hpcp = es.HPCP(size=12, sampleRate=sample_rate)
    rms = es.RMS()

    frames = []
    mfccs = []
    hpcps = []
    rms_db = []
    for start in range(0, max(len(audio) - frame_size, 0) + 1, hop_size):
        frame = audio[start : start + frame_size]
        if len(frame) < frame_size:
            frame = np.pad(frame, (0, frame_size - len(frame)), mode="constant")
        frames.append(frame)
        windowed = window(frame)
        spec = spectrum(windowed)
        _, mfcc_coeffs = mfcc(spec)
        freqs, mags = spectral_peaks(spec)
        hpcp_vec = hpcp(freqs, mags)
        rms_val = rms(frame)
        rms_db_val = 20.0 * np.log10(rms_val + 1e-9)
        mfccs.append(mfcc_coeffs)
        hpcps.append(hpcp_vec)
        rms_db.append(rms_db_val)

    mfccs = np.asarray(mfccs)
    hpcps = np.asarray(hpcps)
    rms_db = np.asarray(rms_db)
    frame_times = np.arange(len(mfccs)) * (hop_size / sample_rate)

    return {
        "frame_times": frame_times,
        "mfcc": mfccs,
        "hpcp": hpcps,
        "rms_db": rms_db,
    }


def summarize_segment_features(frame_features: Dict[str, np.ndarray],
                               start_time: float,
                               end_time: float) -> Dict[str, np.ndarray]:
    times = frame_features["frame_times"]
    idx = np.where((times >= start_time) & (times < end_time))[0]
    if len(idx) == 0:
        if times.size == 0:
            mfcc_dim = frame_features["mfcc"].shape[1] if frame_features["mfcc"].ndim == 2 else 13
            hpcp_dim = frame_features["hpcp"].shape[1] if frame_features["hpcp"].ndim == 2 else 12
            return {
                "mfcc": np.zeros(mfcc_dim, dtype=float),
                "hpcp": np.zeros(hpcp_dim, dtype=float),
                "rms_db": [0.0],
                "times": np.asarray([start_time], dtype=float),
            }
        candidate = np.searchsorted(times, start_time, side="left")
        candidate = min(max(int(candidate), 0), len(times) - 1)
        idx = np.array([candidate])
    mfcc = frame_features["mfcc"][idx]
    hpcp = frame_features["hpcp"][idx]
    rms_db = frame_features["rms_db"][idx]

    mfcc_mean = np.mean(mfcc, axis=0)
    hpcp_mean = np.mean(hpcp, axis=0)
    rms_seq = rms_db.tolist()

    return {
        "mfcc": mfcc_mean,
        "hpcp": hpcp_mean,
        "rms_db": rms_seq,
        "times": times[idx],
    }
