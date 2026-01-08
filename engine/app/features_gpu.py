"""GPU-accelerated feature extraction.

This module provides GPU-accelerated versions of computationally intensive
feature extraction functions. All functions gracefully fall back to CPU
implementations when no GPU is available.
"""

from __future__ import annotations

import numpy as np
from typing import Tuple, Optional

from .gpu import is_gpu_available, get_device, GPUBackend, detect_gpu


def stft_magnitude_gpu(
    y: np.ndarray,
    sr: int,
    n_fft: int,
    hop_length: int,
) -> Tuple[np.ndarray, np.ndarray]:
    """GPU-accelerated STFT magnitude computation.
    
    Args:
        y: Audio signal.
        sr: Sample rate.
        n_fft: FFT size.
        hop_length: Hop length.
        
    Returns:
        Tuple of (frequencies, magnitude spectrogram).
    """
    if not is_gpu_available() or y.size == 0:
        from .features import stft_magnitude
        return stft_magnitude(y, sr, n_fft, hop_length)
    
    try:
        import torch
        device = get_device()
        
        # Convert to tensor and move to GPU
        y_tensor = torch.from_numpy(y.astype(np.float32)).to(device)
        
        # Compute STFT
        window = torch.hann_window(n_fft).to(device)
        stft = torch.stft(
            y_tensor,
            n_fft=n_fft,
            hop_length=hop_length,
            win_length=n_fft,
            window=window,
            return_complex=True,
            center=True,
            pad_mode='reflect'
        )
        
        # Get magnitude and move back to CPU
        magnitude = torch.abs(stft).cpu().numpy()
        
        # Compute frequencies
        freqs = np.fft.rfftfreq(n_fft, 1.0 / sr)
        
        return freqs, magnitude
        
    except Exception as e:
        # Fallback to CPU on any error
        from .features import stft_magnitude
        return stft_magnitude(y, sr, n_fft, hop_length)


def cosine_similarity_matrix_gpu(feature: np.ndarray) -> np.ndarray:
    """GPU-accelerated cosine similarity matrix computation.
    
    Args:
        feature: Feature matrix of shape (n_features, n_frames).
        
    Returns:
        Cosine similarity matrix of shape (n_frames, n_frames).
    """
    if not is_gpu_available() or feature.size == 0:
        from .features import cosine_similarity_matrix
        return cosine_similarity_matrix(feature)
    
    try:
        import torch
        device = get_device()
        
        # Convert to tensor
        f = torch.from_numpy(feature.astype(np.float32)).to(device)
        
        # Normalize columns
        norms = torch.linalg.norm(f, dim=0, keepdim=True) + 1e-9
        normalized = f / norms
        
        # Compute similarity matrix
        result = torch.mm(normalized.T, normalized)
        
        return result.cpu().numpy()
        
    except Exception:
        from .features import cosine_similarity_matrix
        return cosine_similarity_matrix(feature)


def mfcc_frames_gpu(
    y: np.ndarray,
    sr: int,
    hop_length: int,
    frame_length: int,
    n_mfcc: int,
    n_mels: int,
    include_0th: bool,
) -> np.ndarray:
    """GPU-accelerated MFCC computation using torchaudio.
    
    Args:
        y: Audio signal.
        sr: Sample rate.
        hop_length: Hop length.
        frame_length: Frame length for FFT.
        n_mfcc: Number of MFCCs to compute.
        n_mels: Number of mel bands.
        include_0th: Whether to include 0th coefficient.
        
    Returns:
        MFCC matrix of shape (n_mfcc, n_frames).
    """
    if not is_gpu_available() or y.size == 0:
        from .features import mfcc_frames
        return mfcc_frames(y, sr, hop_length, frame_length, n_mfcc, n_mels, include_0th)
    
    try:
        import torch
        import torchaudio
        device = get_device()
        
        # Convert to tensor
        y_tensor = torch.from_numpy(y.astype(np.float32)).unsqueeze(0).to(device)
        
        # Create MFCC transform
        n_mfcc_compute = n_mfcc if include_0th else n_mfcc + 1
        mfcc_transform = torchaudio.transforms.MFCC(
            sample_rate=sr,
            n_mfcc=n_mfcc_compute,
            melkwargs={
                'n_fft': frame_length,
                'hop_length': hop_length,
                'n_mels': n_mels,
            }
        ).to(device)
        
        # Compute MFCCs
        mfcc = mfcc_transform(y_tensor).squeeze(0)
        
        # Handle 0th coefficient
        if not include_0th:
            mfcc = mfcc[1:n_mfcc + 1]
        else:
            mfcc = mfcc[:n_mfcc]
        
        return mfcc.cpu().numpy()
        
    except Exception:
        from .features import mfcc_frames
        return mfcc_frames(y, sr, hop_length, frame_length, n_mfcc, n_mels, include_0th)


def mel_spectrogram_gpu(
    y: np.ndarray,
    sr: int,
    hop_length: int,
    n_fft: int,
    n_mels: int,
) -> np.ndarray:
    """GPU-accelerated mel spectrogram computation.
    
    Args:
        y: Audio signal.
        sr: Sample rate.
        hop_length: Hop length.
        n_fft: FFT size.
        n_mels: Number of mel bands.
        
    Returns:
        Log mel spectrogram of shape (n_mels, n_frames).
    """
    if not is_gpu_available() or y.size == 0:
        from .features import log_mel_frames
        return log_mel_frames(y, sr, hop_length, n_fft, n_mels)
    
    try:
        import torch
        import torchaudio
        device = get_device()
        
        y_tensor = torch.from_numpy(y.astype(np.float32)).unsqueeze(0).to(device)
        
        mel_transform = torchaudio.transforms.MelSpectrogram(
            sample_rate=sr,
            n_fft=n_fft,
            hop_length=hop_length,
            n_mels=n_mels,
        ).to(device)
        
        mel_spec = mel_transform(y_tensor).squeeze(0)
        log_mel = torch.log10(mel_spec + 1e-10)
        
        return log_mel.cpu().numpy()
        
    except Exception:
        from .features import log_mel_frames
        return log_mel_frames(y, sr, hop_length, n_fft, n_mels)


def median_filter_2d_gpu(
    data: np.ndarray,
    kernel_size: Tuple[int, int],
) -> np.ndarray:
    """GPU-accelerated 2D median filter using CuPy.
    
    Args:
        data: 2D array to filter.
        kernel_size: Tuple of (height, width) for the filter kernel.
        
    Returns:
        Filtered array.
    """
    if not is_gpu_available() or data.size == 0:
        from scipy import signal
        return signal.medfilt2d(data.astype(np.float64), kernel_size=kernel_size)
    
    # Try CuPy first (more efficient for median filter)
    try:
        import cupy as cp
        from cupyx.scipy.ndimage import median_filter
        
        data_gpu = cp.asarray(data.astype(np.float32))
        result = median_filter(data_gpu, size=kernel_size)
        return cp.asnumpy(result)
        
    except ImportError:
        pass
    
    # Fallback to scipy on CPU
    from scipy import signal
    return signal.medfilt2d(data.astype(np.float64), kernel_size=kernel_size)


def batch_cosine_distance_gpu(
    features: np.ndarray,
    max_threshold: float,
) -> np.ndarray:
    """GPU-accelerated pairwise cosine distance for beat similarity.
    
    This is useful for computing nearest neighbors in the jukebox algorithm.
    
    Args:
        features: Feature matrix of shape (n_beats, n_features).
        max_threshold: Maximum distance threshold to consider.
        
    Returns:
        Distance matrix of shape (n_beats, n_beats).
    """
    if not is_gpu_available() or features.size == 0:
        # CPU fallback
        from .features import cosine_similarity_matrix
        sim = cosine_similarity_matrix(features.T)
        return 1.0 - sim
    
    try:
        import torch
        device = get_device()
        
        f = torch.from_numpy(features.astype(np.float32)).to(device)
        
        # Normalize
        norms = torch.linalg.norm(f, dim=1, keepdim=True) + 1e-9
        normalized = f / norms
        
        # Compute similarity and convert to distance
        similarity = torch.mm(normalized, normalized.T)
        distance = 1.0 - similarity
        
        return distance.cpu().numpy()
        
    except Exception:
        from .features import cosine_similarity_matrix
        sim = cosine_similarity_matrix(features.T)
        return 1.0 - sim


def resample_audio_gpu(
    data: np.ndarray,
    orig_sr: int,
    target_sr: int,
) -> np.ndarray:
    """GPU-accelerated audio resampling using torchaudio.
    
    Args:
        data: Audio signal.
        orig_sr: Original sample rate.
        target_sr: Target sample rate.
        
    Returns:
        Resampled audio signal.
    """
    if orig_sr == target_sr:
        return data
    
    if not is_gpu_available() or data.size == 0:
        from .features import resample_audio
        return resample_audio(data, orig_sr, target_sr)
    
    try:
        import torch
        import torchaudio
        device = get_device()
        
        data_tensor = torch.from_numpy(data.astype(np.float32)).unsqueeze(0).to(device)
        
        resampler = torchaudio.transforms.Resample(
            orig_freq=orig_sr,
            new_freq=target_sr,
        ).to(device)
        
        resampled = resampler(data_tensor).squeeze(0)
        
        return resampled.cpu().numpy()
        
    except Exception:
        from .features import resample_audio
        return resample_audio(data, orig_sr, target_sr)
