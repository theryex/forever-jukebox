# =============================================================================
# Forever Jukebox Dockerfile
# =============================================================================
# GPU Support: Set GPU_MODE build arg to "cuda" or "rocm" for GPU acceleration
# Default: CPU only
#
# Multi-stage build for optimized image sizes:
#   - Stage 1 (web-build): Builds the frontend
#   - Stage 2 (builder): Compiles Python dependencies with build tools
#   - Stage 3 (runtime): Minimal runtime with only necessary libraries
#
# Expected image sizes:
#   - CPU:  ~1.5-2 GB (vs ~3-4 GB single-stage)
#   - CUDA: ~6-8 GB
#   - ROCm: ~6-8 GB
# =============================================================================

ARG GPU_MODE=cpu

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
# Stage 2: Python Builder (Build environment with compilers)
# =============================================================================
FROM python:3.11-slim-bookworm AS builder

ARG GPU_MODE=cpu
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

# Install build-time dependencies ONLY (compilers, dev headers)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential gcc g++ gfortran \
    libyaml-dev \
    libfftw3-dev \
    libavcodec-dev \
    libavformat-dev \
    libavutil-dev \
    libswresample-dev \
    libsamplerate0-dev \
    libtag1-dev \
    libchromaprint-dev \
    libsndfile1-dev \
    curl unzip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Create virtual environment
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Copy only requirements first for better layer caching
COPY api/requirements.txt ./api/
COPY engine/requirements.txt ./engine/

# Install base python packages
RUN pip install --no-cache-dir --upgrade pip setuptools wheel && \
    pip install --no-cache-dir Cython "numpy==1.26.4" && \
    pip install --no-cache-dir -r ./api/requirements.txt && \
    # Ensure latest yt-dlp at build time even if cached requirements layer
    pip install --no-cache-dir --upgrade "yt-dlp[default]" && \
    # Install yt-dlp-ejs plugin for PO Token support (YouTube anti-bot bypass)
    pip install --no-cache-dir yt-dlp-ejs && \
    # Critical: ensure Essentia is installed from a wheel (never source)
    pip install --no-cache-dir --no-build-isolation --only-binary=essentia -r ./engine/requirements.txt

# Conditional GPU package installation
# Using --no-cache-dir is CRITICAL for keeping image size down
RUN if [ "$GPU_MODE" = "cuda" ]; then \
    pip install --no-cache-dir torch torchaudio --index-url https://download.pytorch.org/whl/cu121 && \
    pip install --no-cache-dir cupy-cuda12x; \
    elif [ "$GPU_MODE" = "rocm" ]; then \
    pip install --no-cache-dir torch torchaudio --index-url https://download.pytorch.org/whl/rocm5.7; \
    else \
    # CPU-only torch wheels are much smaller than the default
    pip install --no-cache-dir torch torchaudio --index-url https://download.pytorch.org/whl/cpu; \
    fi

# =============================================================================
# Stage 3: Final Runtime (Minimal environment)
# =============================================================================
FROM python:3.11-slim-bookworm AS runtime

ARG GPU_MODE=cpu

# Environment configuration
ENV FOREVER_JUKEBOX_GPU=${GPU_MODE} \
    PATH="/opt/venv/bin:$PATH" \
    PYTHONPATH="/app/api" \
    GENERATOR_REPO="/app/engine" \
    GENERATOR_CONFIG="/app/engine/tuned_config.json" \
    GENERATOR_CALIBRATION="/app/engine/calibration.json" \
    ENGINE_REPO="/app/engine" \
    ENGINE_CONFIG="/app/engine/tuned_config.json"

# Install only RUNTIME shared libraries (NO compilers, NO -dev packages)
# Note: In Bookworm, libfftw3 was split by precision type
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    libsamplerate0 \
    libfftw3-double3 \
    libyaml-0-2 \
    libtag1v5 \
    libchromaprint1 \
    curl \
    wget \
    unzip \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Deno for the tuning engine
ARG DENO_VERSION=2.6.5
RUN curl -fsSL "https://github.com/denoland/deno/releases/download/v${DENO_VERSION}/deno-x86_64-unknown-linux-gnu.zip" \
    -o /tmp/deno.zip && unzip /tmp/deno.zip -d /usr/local/bin && rm /tmp/deno.zip && \
    deno --version

# Install yt-dlp binary for best compatibility
RUN wget https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -O /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app

# Copy ONLY the virtual environment from the builder (no compilers!)
COPY --from=builder /opt/venv /opt/venv

# Copy ONLY the virtual environment from the builder (no compilers!)
COPY --from=builder /opt/venv /opt/venv

# Upstream runtime dependencies (Deno, upgraded pip/yt-dlp)
ARG DENO_VERSION=2.6.5
RUN curl -fsSL "https://github.com/denoland/deno/releases/download/v${DENO_VERSION}/deno-x86_64-unknown-linux-gnu.zip" \
    -o /tmp/deno.zip \
    && unzip /tmp/deno.zip -d /usr/local/bin \
    && rm /tmp/deno.zip \
    && deno --version \
    # Ensure latest runtime dependencies
    && /opt/venv/bin/pip install --upgrade pip setuptools wheel \
    && /opt/venv/bin/pip install Cython "numpy==1.26.4" \
    && /opt/venv/bin/pip install -r /app/api/requirements.txt \
    && /opt/venv/bin/pip install --upgrade "yt-dlp[default]" \
    && /opt/venv/bin/pip install --no-build-isolation --only-binary=essentia -r /app/engine/requirements.txt

# Copy source code
COPY api/ ./api/
COPY engine/ ./engine/
COPY --from=web-build /app/web/dist ./web/dist
COPY docker/entrypoint.sh /app/entrypoint.sh

RUN chmod +x /app/entrypoint.sh

ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONPATH="/app/api" \
    ENGINE_REPO="/app/engine" \
    NTFY_TOPIC_KEY=""

EXPOSE 8000
ENTRYPOINT ["/app/entrypoint.sh"]
