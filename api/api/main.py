"""REST API for analysis requests."""

from __future__ import annotations

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv

from .db import init_db
from .http_client import close_client
from .paths import DB_PATH, STORAGE_ROOT, WEB_DIST

load_dotenv()

from .routes.config import router as config_router
from .routes.jobs import router as jobs_router
from .routes.media import router as media_router
from .routes.search import router as search_router

app = FastAPI(title="The Forever Jukebox Analysis API")
app.include_router(config_router)
app.include_router(jobs_router)
app.include_router(media_router)
app.include_router(search_router)


@app.on_event("startup")
def _startup() -> None:
    init_db(DB_PATH)
    STORAGE_ROOT.mkdir(parents=True, exist_ok=True)
    (STORAGE_ROOT / "audio").mkdir(parents=True, exist_ok=True)
    (STORAGE_ROOT / "analysis").mkdir(parents=True, exist_ok=True)
    (STORAGE_ROOT / "logs").mkdir(parents=True, exist_ok=True)


@app.on_event("shutdown")
def _shutdown() -> None:
    close_client()


if WEB_DIST.exists():
    assets_dir = WEB_DIST / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/{full_path:path}")
    def spa_fallback(full_path: str):
        if full_path.startswith("api"):
            raise HTTPException(status_code=404, detail="Not found")
        candidate = (WEB_DIST / full_path).resolve()
        if candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(WEB_DIST / "index.html")
