"""Settings loader.

Non-secret IDs live in config.toml. Every secret is read from an environment
variable at the moment it is needed and is never written to disk or logs.
"""

from __future__ import annotations

import os
import tomllib
from dataclasses import dataclass
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CONFIG = ROOT / "config.toml"

# Every credential the project uses, with what it unlocks. CHECKLIST.md mirrors this.
SECRETS = {
    "CLOSE_API_KEY": "Close REST API key (Nassau Street Partners org only)",
    "NOTION_TOKEN": "Notion internal integration secret, connected to the Close changes database",
}


class MissingSecret(RuntimeError):
    pass


def secret(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise MissingSecret(
            f"{name} is not set ({SECRETS.get(name, 'credential')}). "
            f"Export it or add it to .env; see CHECKLIST.md."
        )
    return value


def has_secret(name: str) -> bool:
    return bool(os.environ.get(name, "").strip())


def load_dotenv(path: Path | None = None) -> None:
    """Minimal .env loader (KEY=VALUE lines). Existing env vars win."""
    path = path or ROOT / ".env"
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


@dataclass
class Config:
    data: dict[str, Any]

    def __getitem__(self, key: str) -> Any:
        return self.data[key]

    def get(self, key: str, default: Any = None) -> Any:
        return self.data.get(key, default)

    @property
    def tz(self) -> str:
        return self.data.get("timezone", "Europe/Lisbon")


def load_config(path: Path | str | None = None) -> Config:
    path = Path(path or os.environ.get("NSP_CONFIG") or DEFAULT_CONFIG)
    with open(path, "rb") as fh:
        return Config(tomllib.load(fh))
