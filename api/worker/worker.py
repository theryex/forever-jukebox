"""Background worker that runs analysis jobs."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import threading
from pathlib import Path

from api.db import claim_next_job, delete_job, init_db, set_job_progress, set_job_status
from api.utils import abs_storage_path, get_logger

APP_ROOT = Path(__file__).resolve().parents[1]
STORAGE_ROOT = (APP_ROOT / "storage").resolve()
DB_PATH = STORAGE_ROOT / "jobs.db"

GENERATOR_REPO = Path(os.environ.get("GENERATOR_REPO", ""))
GENERATOR_CONFIG = Path(os.environ.get("GENERATOR_CONFIG", ""))

POLL_INTERVAL_S = float(os.environ.get("POLL_INTERVAL_S", "1.0"))

ENGINE_PROGRESS_START = 50
ENGINE_PROGRESS_WAIT = 75
ENGINE_PROGRESS_END = 100
API_PROGRESS_START = 26
API_PROGRESS_WAIT = int(round(API_PROGRESS_START + (ENGINE_PROGRESS_WAIT - ENGINE_PROGRESS_START) * 74 / 50))
API_PROGRESS_END = 100
BUMP_IDLE_S = 3.0
logger = get_logger("foreverjukebox.worker")


class JobFailure(Exception):
    def __init__(self, message: str, output_lines: list[str] | None = None) -> None:
        super().__init__(message)
        self.output_lines = output_lines or []


def run_job(job_id: str, input_path: str, output_path: str) -> None:
    if not GENERATOR_REPO.exists() or not GENERATOR_CONFIG.exists():
        raise RuntimeError("GENERATOR_REPO or GENERATOR_CONFIG is not set or missing")

    env = os.environ.copy()
    env["PYTHONPATH"] = str(GENERATOR_REPO)
    env["FJ_PROGRESS"] = "1"

    input_abs = abs_storage_path(STORAGE_ROOT, input_path)
    if not input_abs.exists():
        candidates = sorted((STORAGE_ROOT / "audio").glob(f"{job_id}.*"))
        if candidates:
            input_abs = candidates[0]
    output_abs = abs_storage_path(STORAGE_ROOT, output_path)
    output_abs.parent.mkdir(parents=True, exist_ok=True)

    progress_lock = threading.Lock()
    progress_state = {"value": API_PROGRESS_START, "last_update": time.time()}
    stop_event = threading.Event()

    set_job_progress(DB_PATH, job_id, API_PROGRESS_START)

    def map_engine_progress(value: int) -> int:
        if value <= ENGINE_PROGRESS_START:
            return API_PROGRESS_START
        if value >= ENGINE_PROGRESS_END:
            return API_PROGRESS_END
        scaled = API_PROGRESS_START + (value - ENGINE_PROGRESS_START) * (API_PROGRESS_END - API_PROGRESS_START) / (
            ENGINE_PROGRESS_END - ENGINE_PROGRESS_START
        )
        return int(round(scaled))

    def bump_progress() -> None:
        while not stop_event.is_set():
            with progress_lock:
                current = progress_state["value"]
                last_update = progress_state["last_update"]
            if current >= API_PROGRESS_WAIT:
                break
            if current >= API_PROGRESS_START and time.time() - last_update > BUMP_IDLE_S:
                next_value = min(API_PROGRESS_WAIT, current + 1)
                set_job_progress(DB_PATH, job_id, next_value)
                with progress_lock:
                    progress_state["value"] = next_value
                    progress_state["last_update"] = time.time()
            stop_event.wait(0.5)

    progress_thread = threading.Thread(target=bump_progress, daemon=True)
    progress_thread.start()

    cmd = [
        sys.executable,
        "-m",
        "app.main",
        str(input_abs),
        "-o",
        str(output_abs),
        "--config",
        str(GENERATOR_CONFIG),
    ]

    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        env=env,
        cwd=str(GENERATOR_REPO),
        bufsize=1,
    )
    assert proc.stdout is not None
    output_lines: list[str] = []
    try:
        for line in proc.stdout:
            if line.startswith("PROGRESS:"):
                parts = line.strip().split(":", 2)
                if len(parts) >= 2:
                    try:
                        progress = map_engine_progress(int(parts[1]))
                        set_job_progress(DB_PATH, job_id, progress)
                        with progress_lock:
                            progress_state["value"] = progress
                            progress_state["last_update"] = time.time()
                    except ValueError:
                        pass
                continue
            output_lines.append(line)
            logger.info("%s", line.rstrip())
        returncode = proc.wait()
    finally:
        stop_event.set()
        progress_thread.join(1.0)
    if returncode != 0:
        raise JobFailure(f"Engine exited with status {returncode}", output_lines)


def apply_track_metadata(output_path: str, title: str | None, artist: str | None) -> None:
    if not title and not artist:
        return
    result_path = abs_storage_path(STORAGE_ROOT, output_path)
    if not result_path.exists():
        return
    try:
        data = json.loads(result_path.read_text(encoding="utf-8"))
    except Exception:
        return
    track = data.get("track") if isinstance(data, dict) else None
    if not isinstance(track, dict):
        track = {}
        data["track"] = track
    if title:
        track["title"] = title
    if artist:
        track["artist"] = artist
    result_path.write_text(json.dumps(data), encoding="utf-8")


def cleanup_failed_job(job, error: Exception) -> None:
    log_dir = STORAGE_ROOT / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / f"{job.id}.log"
    output_lines: list[str] = []
    if isinstance(error, JobFailure):
        output_lines = error.output_lines
    with log_path.open("w", encoding="utf-8") as log_file:
        log_file.write(f"Job failed: {error}\n")
        if output_lines:
            log_file.write("\n--- Engine output ---\n")
            for line in output_lines:
                log_file.write(line)
    if job.input_path:
        input_path = abs_storage_path(STORAGE_ROOT, job.input_path)
        if input_path.is_file():
            input_path.unlink()
    if job.output_path:
        output_path = abs_storage_path(STORAGE_ROOT, job.output_path)
        if output_path.is_file():
            output_path.unlink()
    delete_job(DB_PATH, job.id)
    logger.info("Job %s failed: %s (log: %s)", job.id, error, log_path)


def main() -> None:
    init_db(DB_PATH)
    STORAGE_ROOT.mkdir(parents=True, exist_ok=True)
    (STORAGE_ROOT / "audio").mkdir(parents=True, exist_ok=True)
    (STORAGE_ROOT / "analysis").mkdir(parents=True, exist_ok=True)
    (STORAGE_ROOT / "logs").mkdir(parents=True, exist_ok=True)

    while True:
        job = claim_next_job(DB_PATH)
        if not job:
            time.sleep(POLL_INTERVAL_S)
            continue
        try:
            run_job(job.id, job.input_path, job.output_path)
            apply_track_metadata(job.output_path, job.track_title, job.track_artist)
            set_job_progress(DB_PATH, job.id, 100)
        except Exception as exc:
            cleanup_failed_job(job, exc)
            continue
        set_job_status(DB_PATH, job.id, "complete", None)


if __name__ == "__main__":
    main()
