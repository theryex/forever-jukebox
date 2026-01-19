"""yt-dlp configuration helpers."""

from __future__ import annotations

from typing import Any, Dict


def apply_ejs_config(options: Dict[str, Any]) -> Dict[str, Any]:
    """Ensure yt-dlp has JS runtime and EJS component configuration."""
    options.setdefault("js_runtimes", {"deno": {}})
    options.setdefault("remote_components", ["ejs:github"])
    return options
