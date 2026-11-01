"""One-line JSON logs, no secrets, usable from Actions without a formatter."""
from __future__ import annotations

import json
import logging
import os
import sys
from typing import Any, Dict


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: Dict[str, Any] = {
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)


def configure(level: str | None = None) -> None:
    """Idempotent: safe to call from the CLI and from tests."""
    root = logging.getLogger("neon_agents")
    if getattr(root, "_neon_configured", False):
        return
    handler = logging.StreamHandler(sys.stderr)
    if os.getenv("LOG_FORMAT", "json") == "json":
        handler.setFormatter(JsonFormatter())
    else:
        handler.setFormatter(logging.Formatter("%(levelname)s %(name)s %(message)s"))
    root.addHandler(handler)
    root.setLevel(getattr(logging, (level or "INFO").upper(), logging.INFO))
    root._neon_configured = True  # type: ignore[attr-defined]
