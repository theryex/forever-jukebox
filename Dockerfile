# =============================================================================
# Forever Jukebox Dockerfile
# =============================================================================
# GPU Support: Set GPU_MODE build arg to "cuda" or "rocm" for GPU acceleration
# Default: CPU only
#
# Engine: Uses Essentia + GPU hybrid analysis pipeline
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
# Stage 2: Runtime
# =============================================================================
FROM python:3.11-slim AS runtime

ARG GPU_MODE=cpu
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    FOREVER_JUKEBOX_GPU=${GPU_MODE}

# Install system dependencies including Essentia requirements
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    gcc \
    g++ \
    gfortran \
    libsndfile1 \
    libsndfile1-dev \
    ffmpeg \
    # Essentia dependencies
    libyaml-dev \
    libfftw3-dev \
    libavcodec-dev \
    libavformat-dev \
    libavutil-dev \
    libavresample-dev \
    libsamplerate0-dev \
    libtag1-dev \
    libchromaprint-dev \
    # Cleanup
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY api/ ./api/
COPY engine/ ./engine/
COPY --from=web-build /app/web/dist ./web/dist
COPY docker/entrypoint.sh /app/entrypoint.sh

# Install Python packages including Essentia
RUN python -m venv /opt/venv \
    && /opt/venv/bin/pip install --upgrade pip setuptools wheel \
    && /opt/venv/bin/pip install Cython "numpy==1.26.4" \
    && /opt/venv/bin/pip install -r /app/api/requirements.txt \
    && /opt/venv/bin/pip install --no-build-isolation -r /app/engine/requirements.txt \
    && chmod +x /app/entrypoint.sh

# Optional: Install GPU packages based on GPU_MODE
# For CUDA: rebuild with --build-arg GPU_MODE=cuda
# For ROCm: rebuild with --build-arg GPU_MODE=rocm
RUN if [ "$GPU_MODE" = "cuda" ]; then \
    /opt/venv/bin/pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu121 && \
    /opt/venv/bin/pip install cupy-cuda12x; \
    elif [ "$GPU_MODE" = "rocm" ]; then \
    /opt/venv/bin/pip install torch torchaudio --index-url https://download.pytorch.org/whl/rocm5.7; \
    fi

ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONPATH="/app/api" \
    GENERATOR_REPO="/app/engine" \
    GENERATOR_CONFIG="/app/engine/tuned_config.json" \
    GENERATOR_CALIBRATION="/app/engine/calibration.json"

EXPOSE 8000
ENTRYPOINT ["/app/entrypoint.sh"]
