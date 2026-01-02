"""Shared HTTP client."""

from __future__ import annotations

import httpx

from .settings import load_settings

_client: httpx.Client | None = None


def get_client() -> httpx.Client:
    global _client
    if _client is None:
        settings = load_settings()
        _client = httpx.Client(timeout=settings.http_timeout_s)
    return _client


def close_client() -> None:
    global _client
    if _client is not None:
        _client.close()
        _client = None
