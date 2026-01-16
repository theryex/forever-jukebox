"""Config endpoint."""

from __future__ import annotations

import os

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from ..models import AppConfigResponse
from .jobs import MAX_UPLOAD_BYTES

router = APIRouter()


def _is_enabled(env_key: str) -> bool:
    value = os.environ.get(env_key, "")
    return value.lower() in {"1", "true", "yes", "on"}


@router.get("/app-config")
def get_app_config() -> JSONResponse:
    allow_user_upload = _is_enabled("ALLOW_USER_UPLOAD")
    max_upload_size = MAX_UPLOAD_BYTES if allow_user_upload else None
    allowed_upload_exts = sorted(ALLOWED_UPLOAD_EXTS) if allow_user_upload else None
    payload = AppConfigResponse(
        allow_user_upload=allow_user_upload,
        allow_user_youtube=_is_enabled("ALLOW_USER_YOUTUBE"),
        max_upload_size=max_upload_size,
        allowed_upload_exts=allowed_upload_exts,
    )
    return JSONResponse(payload.model_dump(), status_code=200)
