"""GPU acceleration utilities.

This module provides automatic GPU detection for NVIDIA CUDA and AMD ROCm,
with graceful fallback to CPU when no GPU is available.
"""

from __future__ import annotations

import os
from enum import Enum
from typing import Optional, TYPE_CHECKING

if TYPE_CHECKING:
    import torch


class GPUBackend(Enum):
    """Supported GPU backends."""
    NONE = "cpu"
    CUDA = "cuda"   # NVIDIA
    ROCM = "rocm"   # AMD (uses CUDA API via HIP)


_active_backend: Optional[GPUBackend] = None
_device: Optional["torch.device"] = None


def detect_gpu() -> GPUBackend:
    """Detect available GPU backend.
    
    Returns:
        GPUBackend: The detected GPU backend, or NONE if no GPU is available.
    """
    global _active_backend
    
    if _active_backend is not None:
        return _active_backend
    
    # Check environment variable for manual override
    gpu_env = os.environ.get("FOREVER_JUKEBOX_GPU", "").lower()
    if gpu_env == "none" or gpu_env == "cpu":
        _active_backend = GPUBackend.NONE
        return _active_backend
    elif gpu_env == "cuda":
        _active_backend = GPUBackend.CUDA
        return _active_backend
    elif gpu_env == "rocm":
        _active_backend = GPUBackend.ROCM
        return _active_backend
    
    # Auto-detect GPU
    try:
        import torch
        
        if torch.cuda.is_available():
            # Check if this is ROCm (AMD) or CUDA (NVIDIA)
            try:
                # ROCm builds include 'hip' in version string or have hip module
                version_info = torch.version.cuda or ""
                if hasattr(torch.version, 'hip') and torch.version.hip:
                    _active_backend = GPUBackend.ROCM
                elif 'rocm' in version_info.lower():
                    _active_backend = GPUBackend.ROCM
                else:
                    _active_backend = GPUBackend.CUDA
            except Exception:
                _active_backend = GPUBackend.CUDA
            return _active_backend
    except ImportError:
        pass
    
    # Check for CuPy as fallback for CUDA
    try:
        import cupy
        cupy.cuda.Device(0).compute_capability
        _active_backend = GPUBackend.CUDA
        return _active_backend
    except Exception:
        pass
    
    _active_backend = GPUBackend.NONE
    return _active_backend


def get_device() -> Optional["torch.device"]:
    """Get the active compute device.
    
    Returns:
        torch.device or None: The GPU device if available, None otherwise.
    """
    global _device
    
    if _device is not None:
        return _device
    
    backend = detect_gpu()
    if backend in (GPUBackend.CUDA, GPUBackend.ROCM):
        try:
            import torch
            _device = torch.device('cuda')
            return _device
        except ImportError:
            pass
    
    return None


def is_gpu_available() -> bool:
    """Check if any GPU acceleration is available.
    
    Returns:
        bool: True if GPU acceleration is available.
    """
    return detect_gpu() != GPUBackend.NONE


def get_gpu_info() -> dict:
    """Get information about the available GPU.
    
    Returns:
        dict: GPU information including name, memory, and backend.
    """
    backend = detect_gpu()
    info = {
        "backend": backend.value,
        "available": backend != GPUBackend.NONE,
        "name": None,
        "memory_total": None,
        "memory_free": None,
    }
    
    if backend in (GPUBackend.CUDA, GPUBackend.ROCM):
        try:
            import torch
            if torch.cuda.is_available():
                info["name"] = torch.cuda.get_device_name(0)
                info["memory_total"] = torch.cuda.get_device_properties(0).total_memory
                memory_allocated = torch.cuda.memory_allocated(0)
                info["memory_free"] = info["memory_total"] - memory_allocated
        except Exception:
            pass
    
    return info


def clear_gpu_cache() -> None:
    """Clear GPU memory cache."""
    backend = detect_gpu()
    if backend in (GPUBackend.CUDA, GPUBackend.ROCM):
        try:
            import torch
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:
            pass
        
        try:
            import cupy
            cupy.get_default_memory_pool().free_all_blocks()
        except Exception:
            pass
