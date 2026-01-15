#!/usr/bin/env bash
set -euo pipefail

cd /app/api

# Determine which calibration file to use
if [ "${CALIBRATION_MODE:-legacy}" = "upstream" ]; then
    export GENERATOR_CALIBRATION="${GENERATOR_CALIBRATION:-/app/engine/calibration.json}"
    echo "Using upstream calibration: $GENERATOR_CALIBRATION"
else
    export GENERATOR_CONFIG="${GENERATOR_CONFIG:-/app/engine/tuned_config.json}"
    echo "Using legacy config: $GENERATOR_CONFIG"
fi

# Log GPU mode
echo "GPU mode: ${FOREVER_JUKEBOX_GPU:-cpu}"

# Start background worker
python worker/worker.py &
worker_pid=$!

# Start API server
uvicorn api.main:app --host 0.0.0.0 --port "${PORT:-8000}" &
api_pid=$!

# Handle shutdown signals
trap 'kill "$worker_pid" "$api_pid" 2>/dev/null || true' SIGTERM SIGINT

# Wait for either process to exit
wait -n "$worker_pid" "$api_pid"
kill "$worker_pid" "$api_pid" 2>/dev/null || true
wait
