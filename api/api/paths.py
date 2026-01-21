"""Shared filesystem paths for the API."""

from __future__ import annotations

from pathlib import Path


APP_ROOT = Path(__file__).resolve().parents[1]
STORAGE_ROOT = (APP_ROOT / "storage").resolve()
DB_PATH = STORAGE_ROOT / "jobs.db"
FAVORITES_DB_PATH = STORAGE_ROOT / "favorites.db"
WORDLIST_PATH = (APP_ROOT / "data" / "wordlist.ts").resolve()
WEB_DIST = (APP_ROOT.parent / "web" / "dist").resolve()
