import os
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from nsp.config import load_config  # noqa: E402

SECRET_NAMES = ["CLOSE_API_KEY", "CALENDLY_TOKEN", "NOTION_TOKEN", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET",
                "GOOGLE_REFRESH_TOKEN", "FIREFLIES_API_KEY", "ANTHROPIC_API_KEY"]


@pytest.fixture(autouse=True)
def isolated_env(tmp_path, monkeypatch):
    """Fake credentials and private state/log dirs for every test."""
    for n in SECRET_NAMES:
        monkeypatch.setenv(n, f"test-{n.lower()}")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setenv("NSP_STATE_DIR", str(tmp_path / "state"))
    monkeypatch.setenv("NSP_LOG_DIR", str(tmp_path / "logs"))
    yield


@pytest.fixture
def cfg():
    return load_config(ROOT / "config.toml")


PIPE_ID = "pipe_0Lvn5aQMMILogzbRSrQWHB"
STATUSES = [
    ("stat_booked", "Call Booked", "active"),
    ("stat_held", "Screening Call Held", "active"),
    ("stat_qual", "Qualified (Materials Requested)", "active"),
    ("stat_dil", "Soft Diligence", "active"),
    ("stat_senior", "Senior Team Call", "active"),
    ("stat_fee", "Fee and Engagement Review", "active"),
    ("stat_sent", "Engagement Sent", "active"),
    ("stat_won", "Engagement Signed", "won"),
    ("stat_nf", "Not a Fit", "lost"),
    ("stat_afford", "Can't Afford Work Fee", "lost"),
    ("stat_small", "Too Small", "lost"),
    ("stat_dup", "Duplicate", "lost"),
]


def pipelines_payload(include_ma=True):
    pipes = [{"id": "pipe_sdr", "name": "SDR Meetings", "statuses": [
        {"id": "stat_sdr", "label": "SDR Meeting Booked", "type": "active"}]}]
    if include_ma:
        pipes.append({"id": PIPE_ID, "name": "M&A Opportunities",
                      "statuses": [{"id": i, "label": l, "type": t} for i, l, t in STATUSES]})
    return {"data": pipes}
