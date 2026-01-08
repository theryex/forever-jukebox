# =============================================================================
# Forever Jukebox Dockerfile with GPU Support
# =============================================================================
# This Dockerfile supports three GPU modes:
#   - CPU only (default)
#   - NVIDIA CUDA
#   - AMD ROCm
#
# Build arguments:
#   GPU_MODE: "cpu" | "cuda" | "rocm" (default: "cpu")
#   CUDA_VERSION: CUDA version for NVIDIA (default: "12.1")
#   ROCM_VERSION: ROCm version for AMD (default: "5.7")
#
# Examples:
#   docker build -t forever-jukebox .                           # CPU only
#   docker build --build-arg GPU_MODE=cuda -t forever-jukebox . # NVIDIA CUDA
#   docker build --build-arg GPU_MODE=rocm -t forever-jukebox . # AMD ROCm
# =============================================================================

# Build arguments
ARG GPU_MODE=cpu
ARG CUDA_VERSION=12.1
ARG ROCM_VERSION=5.7

# =============================================================================
# Stage 1: Web Build
# =============================================================================
FROM node:20-slim AS web-build
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# =============================================================================
# Stage 2: Runtime - CPU Only
# =============================================================================
FROM python:3.11-slim AS runtime-cpu

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    FOREVER_JUKEBOX_GPU=none

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    build-essential \
    gcc \
    g++ \
    gfortran \
    curl \
    ca-certificates \
    unzip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements first to improve Docker caching
COPY api/requirements.txt /app/api/requirements.txt
COPY engine/requirements.txt /app/engine/requirements.txt

RUN python -m venv /opt/venv \
    && /opt/venv/bin/pip install --upgrade pip setuptools wheel \
    && /opt/venv/bin/pip install Cython "numpy==1.26.4" \
    && /opt/venv/bin/pip install -r /app/api/requirements.txt \
    # Critical: ensure Essentia is installed from a wheel (never source)
    && /opt/venv/bin/pip install --no-build-isolation --only-binary=essentia -r /app/engine/requirements.txt

ARG DENO_VERSION=2.6.5
RUN curl -fsSL "https://github.com/denoland/deno/releases/download/v${DENO_VERSION}/deno-x86_64-unknown-linux-gnu.zip" \
    -o /tmp/deno.zip \
    && unzip /tmp/deno.zip -d /usr/local/bin \
    && rm /tmp/deno.zip \
    && deno --version

# Now copy the actual source
COPY api/ ./api/
COPY engine/ ./engine/
COPY --from=web-build /app/web/dist ./web/dist
COPY docker/entrypoint.sh /app/entrypoint.sh

RUN chmod +x /app/entrypoint.sh

ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONPATH="/app/api" \
    ENGINE_REPO="/app/engine"

EXPOSE 8000
ENTRYPOINT ["/app/entrypoint.sh"]

# =============================================================================
# Stage 2: Runtime - NVIDIA CUDA
# =============================================================================
FROM nvidia/cuda:12.1.0-runtime-ubuntu22.04 AS runtime-cuda

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    FOREVER_JUKEBOX_GPU=cuda \
    DEBIAN_FRONTEND=noninteractive

# Install Python and dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.11 \
    python3.11-venv \
    python3-pip \
    build-essential \
    gcc \
    g++ \
    gfortran \
    libsndfile1 \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && ln -s /usr/bin/python3.11 /usr/bin/python

WORKDIR /app
COPY api/ ./api/
COPY engine/ ./engine/
COPY --from=web-build /app/web/dist ./web/dist
COPY docker/entrypoint.sh /app/entrypoint.sh

# Install Python packages including GPU dependencies
RUN python -m venv /opt/venv \
    && /opt/venv/bin/pip install --upgrade pip setuptools wheel \
    && /opt/venv/bin/pip install Cython "numpy==1.26.4" \
    && /opt/venv/bin/pip install -r /app/api/requirements.txt \
    && /opt/venv/bin/pip install --no-build-isolation -r /app/engine/requirements.txt \
    && /opt/venv/bin/pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu121 \
    && /opt/venv/bin/pip install cupy-cuda12x \
    && chmod +x /app/entrypoint.sh

ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONPATH="/app/api" \
    GENERATOR_REPO="/app/engine" \
    GENERATOR_CONFIG="/app/engine/tuned_config.json"

EXPOSE 8000
ENTRYPOINT ["/app/entrypoint.sh"]

# =============================================================================
# Stage 2: Runtime - AMD ROCm
# =============================================================================
FROM rocm/pytorch:rocm5.7_ubuntu22.04_py3.10_pytorch_2.0.1 AS runtime-rocm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    FOREVER_JUKEBOX_GPU=rocm

# Install additional dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    gcc \
    g++ \
    gfortran \
    libsndfile1 \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY api/ ./api/
COPY engine/ ./engine/
COPY --from=web-build /app/web/dist ./web/dist
COPY docker/entrypoint.sh /app/entrypoint.sh

# Install Python packages (torch/torchaudio already in base image)
RUN python -m venv /opt/venv --system-site-packages \
    && /opt/venv/bin/pip install --upgrade pip setuptools wheel \
    && /opt/venv/bin/pip install Cython "numpy==1.26.4" \
    && /opt/venv/bin/pip install -r /app/api/requirements.txt \
    && /opt/venv/bin/pip install --no-build-isolation -r /app/engine/requirements.txt \
    && chmod +x /app/entrypoint.sh

ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONPATH="/app/api" \
    GENERATOR_REPO="/app/engine" \
    GENERATOR_CONFIG="/app/engine/tuned_config.json"

EXPOSE 8000
ENTRYPOINT ["/app/entrypoint.sh"]

# =============================================================================
# Stage 2: Runtime - NVIDIA CUDA
# =============================================================================
FROM nvidia/cuda:12.1.0-runtime-ubuntu22.04 AS runtime-cuda

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    FOREVER_JUKEBOX_GPU=cuda \
    DEBIAN_FRONTEND=noninteractive

# Install Python and dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.11 \
    python3.11-venv \
    python3-pip \
    build-essential \
    gcc \
    g++ \
    gfortran \
    libsndfile1 \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && ln -s /usr/bin/python3.11 /usr/bin/python

WORKDIR /app
COPY api/ ./api/
COPY engine/ ./engine/
COPY --from=web-build /app/web/dist ./web/dist
COPY docker/entrypoint.sh /app/entrypoint.sh

# Install Python packages including GPU dependencies
RUN python -m venv /opt/venv \
    && /opt/venv/bin/pip install --upgrade pip setuptools wheel \
    && /opt/venv/bin/pip install Cython "numpy==1.26.4" \
    && /opt/venv/bin/pip install -r /app/api/requirements.txt \
    && /opt/venv/bin/pip install --no-build-isolation -r /app/engine/requirements.txt \
    && /opt/venv/bin/pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu121 \
    && /opt/venv/bin/pip install cupy-cuda12x \
    && chmod +x /app/entrypoint.sh

ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONPATH="/app/api" \
    GENERATOR_REPO="/app/engine" \
    GENERATOR_CONFIG="/app/engine/tuned_config.json"

EXPOSE 8000
ENTRYPOINT ["/app/entrypoint.sh"]

# =============================================================================
# Stage 2: Runtime - AMD ROCm
# =============================================================================
FROM rocm/pytorch:rocm5.7_ubuntu22.04_py3.10_pytorch_2.0.1 AS runtime-rocm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    FOREVER_JUKEBOX_GPU=rocm

# Install additional dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    gcc \
    g++ \
    gfortran \
    libsndfile1 \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY api/ ./api/
COPY engine/ ./engine/
COPY --from=web-build /app/web/dist ./web/dist
COPY docker/entrypoint.sh /app/entrypoint.sh

# Install Python packages (torch/torchaudio already in base image)
RUN python -m venv /opt/venv --system-site-packages \
    && /opt/venv/bin/pip install --upgrade pip setuptools wheel \
    && /opt/venv/bin/pip install Cython "numpy==1.26.4" \
    && /opt/venv/bin/pip install -r /app/api/requirements.txt \
    && /opt/venv/bin/pip install --no-build-isolation -r /app/engine/requirements.txt \
    && chmod +x /app/entrypoint.sh

ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONPATH="/app/api" \
    GENERATOR_REPO="/app/engine" \
    GENERATOR_CONFIG="/app/engine/tuned_config.json"

EXPOSE 8000
ENTRYPOINT ["/app/entrypoint.sh"]

# =============================================================================
# Final Stage: Select Runtime Based on GPU_MODE
# =============================================================================
FROM runtime-${GPU_MODE} AS runtime
