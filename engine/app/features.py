from typing import Dict

import numpy as np
from scipy import fftpack, signal

from . import env
from .constants import EPS

# GPU acceleration - lazy import to avoid errors when torch not installed
_gpu_available = None

def _check_gpu_available() -> bool:
    """Check if GPU acceleration is available (cached)."""
    global _gpu_available
    if _gpu_available is None:
        try:
            from .gpu import is_gpu_available
            _gpu_available = is_gpu_available()
        except ImportError:
            _gpu_available = False
    return _gpu_available


DEFAULT_FRAME_LENGTH = 2048
DEFAULT_HOP_LENGTH = 512
DEFAULT_N_MELS = 24
DEFAULT_N_MFCC = 12
MIN_RMS = 1e-12
MIN_LOG_MEL = 1e-10


def load_audio(path: str, sr: int = 22050) -> tuple[np.ndarray, int]:
    """Load audio with a consistent sample rate and mono mix."""
    try:
        import soundfile as sf

        data, native_sr = sf.read(path, always_2d=False)
        if data.ndim > 1:
            data = np.mean(data, axis=1)
    except Exception:
        import audioread

        with audioread.audio_open(path) as source:
            native_sr = source.samplerate
            channels = source.channels
            frames = []
            for buf in source:
                pcm = np.frombuffer(buf, dtype=np.int16)
                if channels > 1:
                    pcm = pcm.reshape(-1, channels).mean(axis=1)
                frames.append(pcm.astype(np.float32) / 32768.0)
            data = np.concatenate(frames) if frames else np.array([], dtype=np.float32)

    if native_sr != sr:
        data = resample_audio(data, native_sr, sr)
        native_sr = sr

    return data.astype(np.float32), int(native_sr)


def percussive_component(
    y: np.ndarray,
    sr: int,
    n_fft: int = DEFAULT_FRAME_LENGTH,
    hop_length: int = DEFAULT_HOP_LENGTH,
    kernel_size: int = 31,
) -> np.ndarray:
    """Approximate percussive component via median filtering on STFT magnitude."""
    if y.size == 0:
        return y
    n_perseg = min(n_fft, y.size) if y.size else n_fft
    noverlap = max(0, n_perseg - hop_length)
    _, _, stft = signal.stft(y, fs=sr, nperseg=n_perseg, noverlap=noverlap)
    magnitude = np.abs(stft)
    if magnitude.size == 0:
        return y
    k = max(3, int(kernel_size))
    if k % 2 == 0:
        k += 1
    harm = signal.medfilt2d(magnitude, kernel_size=(1, k))
    perc = signal.medfilt2d(magnitude, kernel_size=(k, 1))
    denom = harm + perc + EPS
    perc_mask = perc / denom
    stft_perc = stft * perc_mask
    _, y_perc = signal.istft(stft_perc, fs=sr, nperseg=n_perseg, noverlap=noverlap)
    if y_perc.size < y.size:
        y_perc = np.pad(y_perc, (0, y.size - y_perc.size))
    return y_perc[: y.size].astype(np.float32)




def resample_audio(data: np.ndarray, orig_sr: int, target_sr: int) -> np.ndarray:
    if orig_sr == target_sr:
        return data
    g = math.gcd(orig_sr, target_sr)
    up = target_sr // g
    down = orig_sr // g
    return signal.resample_poly(data, up, down).astype(np.float32)


def file_hash(path: str, size: int = 22) -> str:
    """Return a stable short hash for a file."""
    digest = hashlib.sha1()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(8192), b""):
            digest.update(chunk)
    return digest.hexdigest()[:size]


def frame_signal(y: np.ndarray, frame_length: int, hop_length: int) -> np.ndarray:
    if y.size < frame_length:
        y = np.pad(y, (0, frame_length - y.size))
    n_frames = 1 + (y.size - frame_length) // hop_length
    strides = (y.strides[0], hop_length * y.strides[0])
    shape = (frame_length, n_frames)
    return np.lib.stride_tricks.as_strided(y, shape=shape, strides=strides)


def rms(y: np.ndarray, frame_length: int = DEFAULT_FRAME_LENGTH, hop_length: int = DEFAULT_HOP_LENGTH) -> np.ndarray:
    frames = frame_signal(y, frame_length, hop_length)
    return np.sqrt(np.mean(frames ** 2, axis=0) + MIN_RMS)


def rms_db(y: np.ndarray, frame_length: int = DEFAULT_FRAME_LENGTH, hop_length: int = DEFAULT_HOP_LENGTH) -> np.ndarray:
    rms_vals = rms(y, frame_length, hop_length)
    ref = np.max(rms_vals) if rms_vals.size else 1.0
    return 20.0 * np.log10(np.maximum(rms_vals, MIN_RMS) / max(ref, MIN_RMS))


def onset_envelope(y: np.ndarray, sr: int, hop_length: int = DEFAULT_HOP_LENGTH) -> np.ndarray:
    rms_vals = rms(y, DEFAULT_FRAME_LENGTH, hop_length)
    diff = np.maximum(0.0, np.diff(np.concatenate([[0.0], rms_vals])))
    return diff


def detect_onsets(
    onset_env: np.ndarray,
    sr: int,
    hop_length: int = DEFAULT_HOP_LENGTH,
    percentile: float = 75.0,
    min_spacing_s: float = 0.05,
) -> np.ndarray:
    return _find_peak_times(onset_env, sr, hop_length, percentile, min_spacing_s)


def beat_track(
    y: np.ndarray,
    sr: int,
    hop_length: int = DEFAULT_HOP_LENGTH,
    min_bpm: float = 60.0,
    max_bpm: float = 200.0,
) -> tuple[float, np.ndarray, np.ndarray]:
    onset_env = onset_envelope(y, sr, hop_length=hop_length)
    if onset_env.size < 2:
        tempo = 120.0
        duration = float(len(y) / sr) if sr else 0.0
        beat_times = np.arange(0.0, max(duration, 0.01), 60.0 / tempo)
        return tempo, beat_times, onset_env

    env = onset_env - np.mean(onset_env)
    autocorr = np.correlate(env, env, mode="full")[len(env) - 1 :]

    min_lag = int(sr / hop_length * 60.0 / max_bpm)
    max_lag = int(sr / hop_length * 60.0 / min_bpm)
    if max_lag <= min_lag:
        tempo = 120.0
    else:
        lag = min_lag + int(np.argmax(autocorr[min_lag:max_lag]))
        tempo = 60.0 * sr / (hop_length * max(lag, 1))

    duration = float(len(y) / sr) if sr else 0.0
    beat_times = np.arange(0.0, max(duration, 0.01), 60.0 / tempo)
    return float(tempo), beat_times, onset_env




def tempo_from_onset_env(
    onset_env: np.ndarray,
    sr: int,
    hop_length: int = DEFAULT_HOP_LENGTH,
    min_bpm: float = 60.0,
    max_bpm: float = 200.0,
) -> float:
    if onset_env.size < 2:
        return 120.0
    env = onset_env - np.mean(onset_env)
    autocorr = np.correlate(env, env, mode="full")[len(env) - 1 :]

    min_lag = int(sr / hop_length * 60.0 / max_bpm)
    max_lag = int(sr / hop_length * 60.0 / min_bpm)
    if max_lag <= min_lag:
        return 120.0

    lag = min_lag + int(np.argmax(autocorr[min_lag:max_lag]))
    tempo = 60.0 * sr / (hop_length * max(lag, 1))
    return float(tempo)


def snap_times_to_peaks(
    times: np.ndarray,
    peak_times: np.ndarray,
    window_s: float = 0.07,
) -> np.ndarray:
    if times.size == 0 or peak_times.size == 0:
        return times
    snapped = []
    for t in times:
        idx = np.argmin(np.abs(peak_times - t))
        if abs(peak_times[idx] - t) <= window_s:
            snapped.append(float(peak_times[idx]))
        else:
            snapped.append(float(t))
    return np.array(snapped)


def enforce_min_duration(times: np.ndarray, min_duration: float) -> np.ndarray:
    if times.size < 2:
        return times
    merged = [float(times[0])]
    for t in times[1:]:
        if t - merged[-1] >= min_duration:
            merged.append(float(t))
    return np.array(merged)


def hz_to_mel(freq: float) -> float:
    return 2595.0 * math.log10(1.0 + freq / 700.0)


def mel_to_hz(mel: float) -> float:
    return 700.0 * (10 ** (mel / 2595.0) - 1.0)


def mel_filter_bank(sr: int, n_fft: int, n_mels: int = 24) -> np.ndarray:
    mel_min = hz_to_mel(0.0)
    mel_max = hz_to_mel(sr / 2.0)
    mel_points = np.linspace(mel_min, mel_max, n_mels + 2)
    hz_points = np.array([mel_to_hz(mel) for mel in mel_points])
    bin_points = np.floor((n_fft + 1) * hz_points / sr).astype(int)

    filters = np.zeros((n_mels, n_fft // 2 + 1))
    for idx in range(1, n_mels + 1):
        left, center, right = bin_points[idx - 1], bin_points[idx], bin_points[idx + 1]
        if right <= left:
            continue
        for bin_idx in range(left, center):
            if 0 <= bin_idx < filters.shape[1]:
                filters[idx - 1, bin_idx] = (bin_idx - left) / max(center - left, 1)
        for bin_idx in range(center, right):
            if 0 <= bin_idx < filters.shape[1]:
                filters[idx - 1, bin_idx] = (right - bin_idx) / max(right - center, 1)
    return filters


def stft_magnitude(
    y: np.ndarray,
    sr: int,
    n_fft: int = DEFAULT_FRAME_LENGTH,
    hop_length: int = DEFAULT_HOP_LENGTH,
) -> tuple[np.ndarray, np.ndarray]:
    # Try GPU acceleration if available
    if _check_gpu_available():
        try:
            from .features_gpu import stft_magnitude_gpu
            return stft_magnitude_gpu(y, sr, n_fft, hop_length)
        except Exception:
            pass  # Fall through to CPU implementation
    
    n_perseg = min(n_fft, y.size) if y.size else n_fft
    noverlap = max(0, n_perseg - hop_length)
    freqs, times, stft = signal.stft(y, fs=sr, nperseg=n_perseg, noverlap=noverlap)
    return freqs, np.abs(stft)


def cqt_like(
    y: np.ndarray,
    sr: int,
    hop_length: int,
    bins_per_octave: int,
    n_bins: int,
    fmin: float = 32.703,
) -> np.ndarray:
    """Approximate CQT magnitude using log-spaced STFT bin sampling."""
    if y.size == 0:
        return np.zeros((n_bins, 0))
    freqs, mag = stft_magnitude(y, sr, DEFAULT_FRAME_LENGTH, hop_length)
    if mag.size == 0:
        return np.zeros((n_bins, 0))
    target_freqs = fmin * (2.0 ** (np.arange(n_bins) / float(bins_per_octave)))
    target_freqs = np.clip(target_freqs, freqs[0], freqs[-1])
    indices = np.array([int(np.argmin(np.abs(freqs - f))) for f in target_freqs], dtype=int)
    cqt_mag = mag[indices, :]
    cqt_db = 20.0 * np.log10(np.maximum(cqt_mag, EPS))
    return cqt_db


def chroma_frames(y: np.ndarray, sr: int, hop_length: int = DEFAULT_HOP_LENGTH) -> np.ndarray:
    if y.size == 0:
        return np.zeros((12, 0))
    freqs, mag = stft_magnitude(y, sr, DEFAULT_FRAME_LENGTH, hop_length)
    power = mag ** 2
    chroma = np.zeros((12, power.shape[1]))
    for idx, freq in enumerate(freqs):
        if freq <= 0:
            continue
        midi = 69.0 + 12.0 * math.log2(freq / 440.0)
        pitch_class = int(round(midi)) % 12
        chroma[pitch_class] += power[idx]
    return chroma


def chroma_mean(y: np.ndarray, sr: int, hop_length: int = DEFAULT_HOP_LENGTH) -> np.ndarray:
    chroma = chroma_frames(y, sr, hop_length)
    return np.mean(chroma, axis=1) if chroma.size else np.zeros(12)


def mfcc_frames(
    y: np.ndarray,
    sr: int,
    hop_length: int = DEFAULT_HOP_LENGTH,
    frame_length: int = DEFAULT_FRAME_LENGTH,
    n_mfcc: int = DEFAULT_N_MFCC,
    n_mels: int = DEFAULT_N_MELS,
    include_0th: bool = True,
) -> np.ndarray:
    if y.size == 0:
        return np.zeros((n_mfcc, 0))
    freqs, mag = stft_magnitude(y, sr, frame_length, hop_length)
    power = mag ** 2
    n_fft = (mag.shape[0] - 1) * 2 if mag.shape[0] > 1 else frame_length
    filters = mel_filter_bank(sr, n_fft, n_mels=n_mels)
    mel_energy = np.dot(filters, power)
    log_mel = np.log10(np.maximum(mel_energy, MIN_LOG_MEL))
    mfcc = fftpack.dct(log_mel, axis=0, type=2, norm="ortho")
    if include_0th:
        mfcc = mfcc[:n_mfcc, :]
    else:
        mfcc = mfcc[1 : n_mfcc + 1, :]
    return np.nan_to_num(mfcc)


def log_mel_frames(
    y: np.ndarray,
    sr: int,
    hop_length: int = DEFAULT_HOP_LENGTH,
    frame_length: int = DEFAULT_FRAME_LENGTH,
    n_mels: int = DEFAULT_N_MELS,
) -> np.ndarray:
    if y.size == 0:
        return np.zeros((n_mels, 0))
    freqs, mag = stft_magnitude(y, sr, frame_length, hop_length)
    power = mag ** 2
    n_fft = (mag.shape[0] - 1) * 2 if mag.shape[0] > 1 else frame_length
    filters = mel_filter_bank(sr, n_fft, n_mels=n_mels)
    mel_energy = np.dot(filters, power)
    log_mel = np.log10(np.maximum(mel_energy, 1e-10))
    return np.nan_to_num(log_mel)


def mfcc_mean(
    y: np.ndarray,
    sr: int,
    hop_length: int = DEFAULT_HOP_LENGTH,
    frame_length: int = DEFAULT_FRAME_LENGTH,
    n_mfcc: int = 12,
    n_mels: int = DEFAULT_N_MELS,
    include_0th: bool = True,
) -> np.ndarray:
    mfcc = mfcc_frames(
        y,
        sr,
        hop_length=hop_length,
        frame_length=frame_length,
        n_mfcc=n_mfcc,
        n_mels=n_mels,
        include_0th=include_0th,
    )
    return np.mean(mfcc, axis=1) if mfcc.size else np.zeros(n_mfcc)


def key_mode_from_chroma(chroma: np.ndarray) -> tuple[int, float, int, float]:
    """Return (key, key_confidence, mode, mode_confidence)."""
    major_profile = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
    minor_profile = np.array([6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])

    chroma = chroma / (np.sum(chroma) + 1e-9)
    scores_major = []
    scores_minor = []
    for shift in range(12):
        scores_major.append(np.corrcoef(chroma, np.roll(major_profile, shift))[0, 1])
        scores_minor.append(np.corrcoef(chroma, np.roll(minor_profile, shift))[0, 1])

    scores_major = np.nan_to_num(np.array(scores_major), nan=0.0)
    scores_minor = np.nan_to_num(np.array(scores_minor), nan=0.0)

    key_major = int(np.argmax(scores_major))
    key_minor = int(np.argmax(scores_minor))
    major_score = float(scores_major[key_major])
    minor_score = float(scores_minor[key_minor])

    if major_score >= minor_score:
        key = key_major
        mode = 1
        key_confidence = min(1.0, max(0.0, (major_score + 1) / 2))
        mode_confidence = min(1.0, max(0.0, (major_score - minor_score + 1) / 2))
    else:
        key = key_minor
        mode = 0
        key_confidence = min(1.0, max(0.0, (minor_score + 1) / 2))
        mode_confidence = min(1.0, max(0.0, (minor_score - major_score + 1) / 2))

    return key, key_confidence, mode, mode_confidence


def normalize_vector(vec: np.ndarray) -> list[float]:
    max_val = float(np.max(vec)) if vec.size else 0.0
    if max_val <= 0:
        return [0.0 for _ in range(int(vec.size))]
    return [float(v / max_val) for v in vec]


def time_to_frames(times: Iterable[float], sr: int, hop_length: int = DEFAULT_HOP_LENGTH) -> np.ndarray:
    times = np.array(list(times), dtype=float)
    return np.round(times * sr / hop_length).astype(int)


def frames_to_time(frames: Iterable[int], sr: int, hop_length: int = DEFAULT_HOP_LENGTH) -> np.ndarray:
    frames = np.array(list(frames), dtype=float)
    return frames * hop_length / sr


def sample_confidence(times: Iterable[float], onset_env: np.ndarray, sr: int, hop_length: int = DEFAULT_HOP_LENGTH) -> list[float]:
    frames = time_to_frames(times, sr, hop_length)
    if onset_env.size == 0:
        return [0.0 for _ in frames]
    env = onset_env / (np.max(onset_env) + 1e-9)
    return [float(env[min(len(env) - 1, max(0, int(frame)))]) for frame in frames]


def detect_peaks(
    values: np.ndarray,
    sr: int,
    hop_length: int = DEFAULT_HOP_LENGTH,
    percentile: float = 75.0,
    min_spacing_s: float = 0.05,
) -> np.ndarray:
    return _find_peak_times(values, sr, hop_length, percentile, min_spacing_s)


def _find_peak_times(
    values: np.ndarray,
    sr: int,
    hop_length: int,
    percentile: float,
    min_spacing_s: float,
) -> np.ndarray:
    if values.size == 0:
        return np.array([], dtype=float)
    threshold = np.percentile(values, percentile)
    min_distance = max(1, int(min_spacing_s * sr / hop_length))
    peaks, _ = signal.find_peaks(values, height=threshold, distance=min_distance)
    return frames_to_time(peaks, sr, hop_length)


def detect_peaks_series(
    values: np.ndarray,
    percentile: float = 75.0,
    min_distance: int = 1,
) -> np.ndarray:
    if values.size == 0:
        return np.array([], dtype=int)
    threshold = np.percentile(values, percentile)
    peaks, _ = signal.find_peaks(values, height=threshold, distance=max(1, min_distance))
    return peaks.astype(int)


def beat_sync_mean(feature: np.ndarray, beat_frames: np.ndarray) -> np.ndarray:
    if feature.size == 0 or beat_frames.size < 2:
        return np.zeros((feature.shape[0], 0), dtype=float)
    beat_frames = np.clip(beat_frames, 0, max(feature.shape[1] - 1, 0))
    beat_frames = np.unique(beat_frames)
    if beat_frames.size < 2:
        return np.zeros((feature.shape[0], 0), dtype=float)
    synced = []
    for idx in range(len(beat_frames) - 1):
        start = int(beat_frames[idx])
        end = int(beat_frames[idx + 1])
        if end <= start:
            continue
        synced.append(np.mean(feature[:, start:end], axis=1))
    return np.array(synced, dtype=float).T if synced else np.zeros((feature.shape[0], 0), dtype=float)


def cosine_similarity_matrix(feature: np.ndarray) -> np.ndarray:
    # Try GPU acceleration if available
    if _check_gpu_available():
        try:
            from .features_gpu import cosine_similarity_matrix_gpu
            return cosine_similarity_matrix_gpu(feature)
        except Exception:
            pass  # Fall through to CPU implementation
    
    if feature.size == 0:
        return np.zeros((0, 0), dtype=float)
    norms = np.linalg.norm(feature, axis=0, keepdims=True) + EPS
    normalized = feature / norms
    return normalized.T @ normalized


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    if a.size == 0 or b.size == 0:
        return 0.0
    denom = float(np.linalg.norm(a) * np.linalg.norm(b)) + EPS
    return float(np.dot(a, b) / denom)


def novelty_from_ssm(ssm: np.ndarray, kernel_size: int) -> np.ndarray:
    if ssm.size == 0 or kernel_size < 1:
        return np.zeros(0, dtype=float)
    size = ssm.shape[0]
    k = min(kernel_size, size // 2)
    if k < 1:
        return np.zeros(size, dtype=float)
    novelty = np.zeros(size, dtype=float)
    for idx in range(k, size - k):
        a = ssm[idx - k : idx, idx - k : idx]
        b = ssm[idx - k : idx, idx : idx + k]
        c = ssm[idx : idx + k, idx - k : idx]
        d = ssm[idx : idx + k, idx : idx + k]
        novelty[idx] = float(np.sum(a) + np.sum(d) - np.sum(b) - np.sum(c))
    if novelty.size:
        novelty = novelty - np.min(novelty)
        denom = np.max(novelty) + EPS
        novelty = novelty / denom
    return novelty
