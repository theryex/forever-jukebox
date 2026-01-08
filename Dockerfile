# =============================================================================
# Forever Jukebox Dockerfile
# =============================================================================
# GPU Support: Set GPU_MODE build arg to "cuda" or "rocm" for GPU acceleration
# Default: CPU only
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
# Stage 2: Runtime (CPU)
# =============================================================================
FROM python:3.11-slim AS runtime

ARG GPU_MODE=cpu
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    FOREVER_JUKEBOX_GPU=${GPU_MODE}

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

# Install base Python packages
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

# Optional: Install GPU packages based on GPU_MODE
# For CUDA: rebuild with --build-arg GPU_MODE=cuda
# For ROCm: rebuild with --build-arg GPU_MODE=rocm
RUN if [ "$GPU_MODE" = "cuda" ]; then \
    /opt/venv/bin/pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu121 && \
    /opt/venv/bin/pip install cupy-cuda12x; \
    elif [ "$GPU_MODE" = "rocm" ]; then \
    /opt/venv/bin/pip install torch torchaudio --index-url https://download.pytorch.org/whl/rocm5.7; \
    fi

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
    GENERATOR_CONFIG="/app/engine/tuned_config.json"

EXPOSE 8000
ENTRYPOINT ["/app/entrypoint.sh"]
