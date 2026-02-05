"""Feature extraction utilities using Essentia with GPU acceleration support.

This module combines Essentia-based feature extraction (from upstream) with
GPU-accelerated paths for computationally intensive operations.
"""

from __future__ import annotations

from typing import Dict, Optional

import numpy as np

from .config import FeatureConfig

# GPU acceleration - lazy import to avoid errors when torch not installed
_gpu_available: Optional[bool] = None


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


class FeatureExtractionError(RuntimeError):
    """Raised when feature extraction fails."""
    pass


def compute_frame_features(audio: np.ndarray, config: FeatureConfig) -> Dict[str, np.ndarray]:
    """Compute frame-level features from audio.
    
    Uses Essentia for robust audio analysis. Falls back to scipy-based
    implementation if Essentia is not available.
    
    Args:
        audio: Mono audio signal as float32 array.
        config: Feature extraction configuration.
        
    Returns:
        Dictionary containing:
        - frame_times: Time of each frame center
        - mfcc: MFCC coefficients (n_frames, 13)
        - hpcp: Harmonic pitch class profile (n_frames, 12)
        - rms_db: RMS energy in dB (n_frames,)
    """
    # Try GPU-accelerated path first for applicable features
    if _check_gpu_available():
        return _compute_features_gpu(audio, config)
    
    # Try Essentia (preferred)
    try:
        return _compute_features_essentia(audio, config)
    except ImportError:
        pass
    
    # Fallback to scipy-based implementation
    return _compute_features_scipy(audio, config)


def _compute_features_essentia(audio: np.ndarray, config: FeatureConfig) -> Dict[str, np.ndarray]:
    """Essentia-based feature extraction (from upstream)."""
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


def _compute_features_gpu(audio: np.ndarray, config: FeatureConfig) -> Dict[str, np.ndarray]:
    """GPU-accelerated feature extraction.
    
    Uses torchaudio for MFCC and mel spectrogram computation,
    but still requires Essentia for HPCP (harmonic pitch class profile).
    """
    try:
        import torch
        import torchaudio
        from .gpu import get_device
    except ImportError:
        return _compute_features_essentia(audio, config)
    
    device = get_device()
    if device is None:
        return _compute_features_essentia(audio, config)
    
    frame_size = config.frame_size
    hop_size = config.hop_size
    sample_rate = config.sample_rate
    
    # Convert to tensor
    try:
        y_tensor = torch.from_numpy(audio.astype(np.float32)).unsqueeze(0).to(device)
    except RuntimeError as e:
        if "Found no NVIDIA driver" in str(e):
            print("WARNING: GPU mode is enabled (FOREVER_JUKEBOX_GPU=cuda), but no NVIDIA driver was found.")
            print("         Falling back to CPU. To use GPU, make sure to run with: docker compose --profile nvidia up")
            print("         For more info, see DEPLOYMENT.md.")
            return _compute_features_essentia(audio, config)
        raise e

    
    # GPU: Compute MFCCs
    mfcc_transform = torchaudio.transforms.MFCC(
        sample_rate=sample_rate,
        n_mfcc=13,
        melkwargs={
            'n_fft': frame_size,
            'hop_length': hop_size,
            'n_mels': 40,
        }
    ).to(device)
    
    mfccs = mfcc_transform(y_tensor).squeeze(0).T.cpu().numpy()  # (n_frames, 13)
    
    # GPU: Compute RMS energy
    n_frames = mfccs.shape[0]
    frame_times = np.arange(n_frames) * (hop_size / sample_rate)
    
    # RMS per frame (simple GPU implementation)
    rms_values = []
    audio_tensor = torch.from_numpy(audio.astype(np.float32)).to(device)
    for i in range(n_frames):
        start = i * hop_size
        end = min(start + frame_size, len(audio))
        if end > start:
            frame_tensor = audio_tensor[start:end]
            rms_val = torch.sqrt(torch.mean(frame_tensor ** 2)).item()
        else:
            rms_val = 1e-9
        rms_values.append(20.0 * np.log10(rms_val + 1e-9))
    rms_db = np.asarray(rms_values)
    
    # HPCP still needs Essentia (no good GPU alternative)
    try:
        import essentia.standard as es
        spectral_peaks = es.SpectralPeaks(orderBy="magnitude", magnitudeThreshold=1e-6)
        hpcp_algo = es.HPCP(size=12, sampleRate=sample_rate)
        window = es.Windowing(type="hann")
        spectrum = es.Spectrum(size=frame_size)
        
        hpcps = []
        for i in range(n_frames):
            start = i * hop_size
            end = min(start + frame_size, len(audio))
            frame = audio[start:end]
            if len(frame) < frame_size:
                frame = np.pad(frame, (0, frame_size - len(frame)), mode="constant")
            windowed = window(frame)
            spec = spectrum(windowed)
            freqs, mags = spectral_peaks(spec)
            hpcp_vec = hpcp_algo(freqs, mags)
            hpcps.append(hpcp_vec)
        hpcps = np.asarray(hpcps)
    except ImportError:
        # Fallback: approximate HPCP using chroma from mel spectrogram
        hpcps = np.zeros((n_frames, 12), dtype=np.float32)
    
    return {
        "frame_times": frame_times,
        "mfcc": mfccs,
        "hpcp": hpcps,
        "rms_db": rms_db,
    }


def _compute_features_scipy(audio: np.ndarray, config: FeatureConfig) -> Dict[str, np.ndarray]:
    """Scipy-based fallback feature extraction."""
    from scipy import fftpack, signal
    
    frame_size = config.frame_size
    hop_size = config.hop_size
    sample_rate = config.sample_rate
    
    # Frame the signal
    n_frames = max(1, (len(audio) - frame_size) // hop_size + 1)
    frame_times = np.arange(n_frames) * (hop_size / sample_rate)
    
    # Window function
    window = signal.windows.hann(frame_size)
    
    mfccs = []
    hpcps = []
    rms_db = []
    
    # Mel filter bank
    n_mels = 40
    mel_fb = _mel_filter_bank(sample_rate, frame_size, n_mels)
    
    for i in range(n_frames):
        start = i * hop_size
        frame = audio[start:start + frame_size]
        if len(frame) < frame_size:
            frame = np.pad(frame, (0, frame_size - len(frame)), mode="constant")
        
        # Apply window
        windowed = frame * window
        
        # FFT
        spectrum = np.abs(fftpack.fft(windowed)[:frame_size // 2 + 1])
        
        # Mel spectrogram
        mel_spec = np.dot(mel_fb, spectrum ** 2)
        log_mel = np.log10(mel_spec + 1e-10)
        
        # DCT for MFCCs
        mfcc_coeffs = fftpack.dct(log_mel, type=2, norm='ortho')[:13]
        mfccs.append(mfcc_coeffs)
        
        # Simple chroma approximation for HPCP
        chroma = np.zeros(12)
        freqs = np.fft.rfftfreq(frame_size, 1.0 / sample_rate)
        for j, freq in enumerate(freqs):
            if freq > 20 and freq < 5000:
                pitch_class = int(np.round(12 * np.log2(freq / 440.0 + 1e-9))) % 12
                chroma[pitch_class] += spectrum[j] ** 2
        chroma = chroma / (np.max(chroma) + 1e-9)
        hpcps.append(chroma)
        
        # RMS
        rms_val = np.sqrt(np.mean(frame ** 2))
        rms_db.append(20.0 * np.log10(rms_val + 1e-9))
    
    return {
        "frame_times": np.asarray(frame_times),
        "mfcc": np.asarray(mfccs),
        "hpcp": np.asarray(hpcps),
        "rms_db": np.asarray(rms_db),
    }


def _mel_filter_bank(sr: int, n_fft: int, n_mels: int) -> np.ndarray:
    """Create a mel filter bank."""
    def hz_to_mel(freq: float) -> float:
        return 2595.0 * np.log10(1.0 + freq / 700.0)
    
    def mel_to_hz(mel: float) -> float:
        return 700.0 * (10.0 ** (mel / 2595.0) - 1.0)
    
    low_hz = 0.0
    high_hz = sr / 2.0
    low_mel = hz_to_mel(low_hz)
    high_mel = hz_to_mel(high_hz)
    mel_points = np.linspace(low_mel, high_mel, n_mels + 2)
    hz_points = np.array([mel_to_hz(m) for m in mel_points])
    
    bin_points = np.floor((n_fft + 1) * hz_points / sr).astype(int)
    
    n_bins = n_fft // 2 + 1
    fb = np.zeros((n_mels, n_bins))
    
    for i in range(n_mels):
        left = bin_points[i]
        center = bin_points[i + 1]
        right = bin_points[i + 2]
        
        for j in range(left, center):
            if center > left:
                fb[i, j] = (j - left) / (center - left)
        for j in range(center, right):
            if right > center:
                fb[i, j] = (right - j) / (right - center)
    
    return fb


def summarize_segment_features(frame_features: Dict[str, np.ndarray],
                               start_time: float,
                               end_time: float) -> Dict[str, np.ndarray]:
    """Summarize frame-level features for a time segment.
    
    Args:
        frame_features: Frame-level features from compute_frame_features.
        start_time: Segment start time in seconds.
        end_time: Segment end time in seconds.
        
    Returns:
        Dictionary with summarized features for the segment.
    """
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
