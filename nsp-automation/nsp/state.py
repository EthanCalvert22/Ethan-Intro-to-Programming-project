"""Tiny JSON state store.

This is only a speed-up cache. Every job is also idempotent against the source
of truth (Close searched by email, Call Log searched by email, Gmail drafts
recorded in the Call Log), so a lost state file never creates duplicates.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from .config import state_dir


class State:
    def __init__(self, name: str, directory: Path | None = None):
        self.path = (directory or state_dir()) / f"{name}.json"
        self.data: dict = json.loads(self.path.read_text()) if self.path.exists() else {}

    def seen(self, key: str) -> bool:
        return key in self.data.get("seen", {})

    def mark(self, key: str, info: dict | None = None) -> None:
        self.data.setdefault("seen", {})[key] = {
            "at": datetime.now(timezone.utc).isoformat(timespec="seconds"), **(info or {})}

    def get(self, key: str, default=None):
        return self.data.get(key, default)

    def set(self, key: str, value) -> None:
        self.data[key] = value

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.data, indent=2, sort_keys=True))
        tmp.replace(self.path)
