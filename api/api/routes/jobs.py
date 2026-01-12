"""Job-related routes and helpers."""

from __future__ import annotations

import json
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Body, HTTPException, Query
from fastapi.responses import JSONResponse

from ..db import (
    create_job,
    delete_job,
    get_job,
    get_job_by_track,
    get_job_by_youtube_id,
    get_top_tracks,
    increment_job_plays,
    set_job_progress,
    set_job_status,
    update_job_input_path,
)
from ..models import AnalysisStartResponse, JobComplete, JobError, JobProgress, PlayCountResponse, TopSongsResponse
from ..paths import DB_PATH, STORAGE_ROOT
from ..utils import abs_storage_path, get_logger

router = APIRouter()
logger = get_logger()


def _parse_timestamp(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def _should_recycle_job(job) -> bool:
    if job.status != "downloading":
        return False
    log_path = STORAGE_ROOT / "logs" / f"{job.id}.log"
    if log_path.exists():
        return True
    updated_at = _parse_timestamp(job.updated_at)
    if updated_at is None:
        return False
    if updated_at.tzinfo is None:
        updated_at = updated_at.replace(tzinfo=timezone.utc)
    age_s = (datetime.now(timezone.utc) - updated_at).total_seconds()
    return job.progress >= 25 and age_s > 30


def _recycle_job(job) -> None:
    delete_job(DB_PATH, job.id)
    logger.info("Recycling stale job %s (%s)", job.id, job.status)


def _message_for_progress(status: str, progress: int | None) -> str | None:
    if status == "downloading":
        return "Fetching audio..."
    if status == "queued":
        return "Queued..."
    if status != "processing":
        return None
    if progress is None:
        return "Processing..."
    if progress < 10:
        return "Processing audio..."
    if progress < 80:
        return "Analyzing audio..."
    return "Building analysis..."


def _job_response(job) -> JSONResponse:
    base_payload = {"id": job.id, "youtube_id": job.youtube_id}
    if job.status in {"queued", "processing", "downloading"}:
        progress = job.progress if job.status == "processing" else None
        message = _message_for_progress(job.status, progress)
        payload = JobProgress(
            status=job.status,
            progress=progress,
            message=message,
            **base_payload,
        )
        return JSONResponse(payload.model_dump(), status_code=202)

    if job.status == "failed":
        payload = JobError(status="failed", error=job.error, **base_payload)
        return JSONResponse(payload.model_dump(), status_code=200)

    result_path = abs_storage_path(STORAGE_ROOT, job.output_path)
    if not result_path.exists():
        payload = JobError(status="failed", error="Analysis missing", **base_payload)
        return JSONResponse(payload.model_dump(), status_code=200)

    data = json.loads(result_path.read_text(encoding="utf-8"))
    if isinstance(data, dict) and (job.track_title or job.track_artist):
        track = data.get("track")
        if not isinstance(track, dict):
            track = {}
            data["track"] = track
        if job.track_title and not track.get("title"):
            track["title"] = job.track_title
        if job.track_artist and not track.get("artist"):
            track["artist"] = job.track_artist
    payload = JobComplete(status="complete", result=data, progress=job.progress, **base_payload)
    return JSONResponse(payload.model_dump(), status_code=200)


def _write_failure_log(job_id: str, message: str) -> None:
    log_dir = STORAGE_ROOT / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / f"{job_id}.log"
    log_path.write_text(f"Job failed: {message}\n", encoding="utf-8")


def _cleanup_failure(job_id: str, message: str) -> None:
    _write_failure_log(job_id, message)
    for candidate in (STORAGE_ROOT / "audio").glob(f"{job_id}.*"):
        if candidate.is_file():
            candidate.unlink()
    result_path = STORAGE_ROOT / "analysis" / f"{job_id}.json"
    if result_path.is_file():
        result_path.unlink()
    delete_job(DB_PATH, job_id)
    logger.info("Job %s failed: %s", job_id, message)


def _download_youtube_audio(job_id: str, youtube_id: str) -> None:
    try:
        from yt_dlp import YoutubeDL
    except Exception:
        _cleanup_failure(job_id, "yt-dlp is not available")
        return

    audio_dir = STORAGE_ROOT / "audio"
    audio_dir.mkdir(parents=True, exist_ok=True)
    outtmpl = str(audio_dir / f"{job_id}.%(ext)s")

    last_progress = {"value": -1}

    def progress_hook(status: dict) -> None:
        if status.get("status") != "downloading":
            return
        total = status.get("total_bytes") or status.get("total_bytes_estimate")
        downloaded = status.get("downloaded_bytes") or 0
        if not total:
            return
        ratio = max(0.0, min(1.0, downloaded / total))
        progress = int(round(ratio * 25))
        if progress != last_progress["value"]:
            last_progress["value"] = progress
            set_job_progress(DB_PATH, job_id, progress)

    ydl_opts = {
        "quiet": True,
        "skip_download": False,
        "format": "bestaudio/best",
        "noplaylist": True,
        "max_filesize": 100 * 1024 * 1024,
        "outtmpl": outtmpl,
        "progress_hooks": [progress_hook],
        "extractaudio": True,
        "audioformat": "m4a",
    }
    url = f"https://www.youtube.com/watch?v={youtube_id}"
    try:
        with YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
    except Exception as exc:  # pragma: no cover - network call
        _cleanup_failure(job_id, str(exc))
        return

    input_path = None
    if isinstance(info, dict):
        downloads = info.get("requested_downloads") or []
        if downloads and downloads[0].get("filepath"):
            input_path = downloads[0]["filepath"]
        elif info.get("_filename"):
            input_path = info.get("_filename")

    if input_path and not Path(input_path).is_file():
        input_path = None

    if not input_path:
        for candidate in audio_dir.glob(f"{job_id}.*"):
            if candidate.is_file():
                input_path = str(candidate)
                break

    if not input_path:
        _cleanup_failure(job_id, "Download failed")
        return

    input_path_obj = Path(input_path)
    suffix = input_path_obj.suffix or ".audio"
    relative_path = Path("audio") / f"{job_id}{suffix}"
    target_path = (STORAGE_ROOT / relative_path).resolve()
    if input_path_obj.resolve() != target_path:
        target_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(input_path_obj), str(target_path))
    update_job_input_path(DB_PATH, job_id, str(relative_path))
    set_job_progress(DB_PATH, job_id, 25)
    set_job_status(DB_PATH, job_id, "queued", None)


@router.get("/api/analysis/{job_id}")
def get_analysis(job_id: str) -> JSONResponse:
    job = get_job(DB_PATH, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return _job_response(job)


@router.post("/api/repair/{job_id}")
def repair_job(job_id: str, background_tasks: BackgroundTasks) -> JSONResponse:
    job = get_job(DB_PATH, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status in {"downloading", "queued", "processing"}:
        return _job_response(job)
    if not job.youtube_id:
        raise HTTPException(status_code=404, detail="Job is missing youtube_id")

    audio_path = None
    if job.input_path:
        audio_path = abs_storage_path(STORAGE_ROOT, job.input_path)
    if not audio_path or not audio_path.exists():
        candidates = sorted((STORAGE_ROOT / "audio").glob(f"{job_id}.*"))
        if candidates:
            candidate = candidates[0]
            relative_path = Path("audio") / candidate.name
            update_job_input_path(DB_PATH, job_id, str(relative_path))
            audio_path = candidate

    analysis_path = abs_storage_path(STORAGE_ROOT, job.output_path)
    audio_missing = not audio_path or not audio_path.exists()
    analysis_missing = not analysis_path.exists()

    if audio_missing:
        set_job_progress(DB_PATH, job_id, 0)
        set_job_status(DB_PATH, job_id, "downloading", None)
        background_tasks.add_task(_download_youtube_audio, job_id, job.youtube_id)
        job = get_job(DB_PATH, job_id)
        return _job_response(job) if job else JSONResponse(
            JobError(status="failed", error="Job not found", id=job_id, youtube_id=None).model_dump(),
            status_code=404,
        )

    if analysis_missing:
        set_job_progress(DB_PATH, job_id, 25)
        set_job_status(DB_PATH, job_id, "queued", None)
        job = get_job(DB_PATH, job_id)
        return _job_response(job) if job else JSONResponse(
            JobError(status="failed", error="Job not found", id=job_id, youtube_id=None).model_dump(),
            status_code=404,
        )

    return _job_response(job)


@router.post("/api/analysis/youtube")
def create_analysis_youtube(
    background_tasks: BackgroundTasks, payload: dict = Body(...)
) -> JSONResponse:
    youtube_id = payload.get("youtube_id")
    if not youtube_id or not isinstance(youtube_id, str):
        raise HTTPException(status_code=400, detail="youtube_id is required")
    track_title = payload.get("title")
    track_artist = payload.get("artist")
    if track_title is not None and not isinstance(track_title, str):
        raise HTTPException(status_code=400, detail="title must be a string")
    if track_artist is not None and not isinstance(track_artist, str):
        raise HTTPException(status_code=400, detail="artist must be a string")

    if track_title and track_artist:
        existing_by_track = get_job_by_track(DB_PATH, track_title, track_artist)
        if existing_by_track and _should_recycle_job(existing_by_track):
            _recycle_job(existing_by_track)
            existing_by_track = None
        if existing_by_track and existing_by_track.status != "failed":
            return _job_response(existing_by_track)

    existing = get_job_by_youtube_id(DB_PATH, youtube_id)
    if existing and _should_recycle_job(existing):
        _recycle_job(existing)
        existing = None
    if existing and existing.status != "failed":
        return _job_response(existing)

    job_id = uuid.uuid4().hex
    output_path = Path("analysis") / f"{job_id}.json"

    create_job(
        DB_PATH,
        job_id,
        "",
        str(output_path),
        status="downloading",
        track_title=track_title,
        track_artist=track_artist,
        youtube_id=youtube_id,
        progress=0,
    )
    background_tasks.add_task(_download_youtube_audio, job_id, youtube_id)
    payload = AnalysisStartResponse(
        id=job_id,
        status="downloading",
        progress=None,
        message=_message_for_progress("downloading", None),
    )
    return JSONResponse(payload.model_dump(), status_code=202)


@router.post("/api/plays/{job_id}")
def increment_play_count(job_id: str) -> JSONResponse:
    play_count = increment_job_plays(DB_PATH, job_id)
    if play_count is None:
        raise HTTPException(status_code=404, detail="Job not found")
    payload = PlayCountResponse(id=job_id, play_count=play_count)
    return JSONResponse(payload.model_dump(), status_code=200)


@router.get("/api/top")
def get_top_songs(limit: int = Query(20, ge=1, le=50)) -> JSONResponse:
    items = get_top_tracks(DB_PATH, limit=limit)
    payload = TopSongsResponse(items=items)
    return JSONResponse(payload.model_dump(), status_code=200)


@router.get("/api/jobs/by-youtube/{youtube_id}")
def get_job_by_youtube(youtube_id: str) -> JSONResponse:
    job = get_job_by_youtube_id(DB_PATH, youtube_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if _should_recycle_job(job):
        _recycle_job(job)
        raise HTTPException(status_code=404, detail="Job not found")
    return _job_response(job)


@router.get("/api/jobs/by-track")
def get_job_by_track_match(
    title: str = Query(..., min_length=1), artist: str = Query(..., min_length=1)
) -> JSONResponse:
    job = get_job_by_track(DB_PATH, title, artist)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if _should_recycle_job(job):
        _recycle_job(job)
        raise HTTPException(status_code=404, detail="Job not found")
    return _job_response(job)
