"""Environment guards for third-party libraries."""

from __future__ import annotations

import os


def ensure_numba_disabled() -> None:
    os.environ.setdefault("NUMBA_DISABLE_JIT", "1")
    os.environ.setdefault("NUMBA_DISABLE_CACHING", "1")
    os.environ.setdefault("NUMBA_DISABLE_CACHE", "1")


ensure_numba_disabled()
