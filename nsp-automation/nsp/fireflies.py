"""Fireflies GraphQL client plus helpers to load a transcript from a file."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from .config import secret
from .http import Http

FIREFLIES_URL = "https://api.fireflies.ai/graphql"

LIST_Q = """
query Transcripts($fromDate: DateTime, $toDate: DateTime, $limit: Int) {
  transcripts(fromDate: $fromDate, toDate: $toDate, limit: $limit, mine: true) {
    id title date duration organizer_email participants
  }
}"""

ONE_Q = """
query Transcript($id: String!) {
  transcript(id: $id) {
    id title date duration organizer_email participants
    sentences { speaker_name text start_time }
    summary { short_summary action_items }
  }
}"""


@dataclass
class Transcript:
    id: str
    title: str
    date: datetime | None
    participants: list[str]
    text: str
    summary: str = ""
    action_items: str = ""
    duration_min: float = 0.0
    extra: dict = field(default_factory=dict)

    def external_emails(self, own_domain: str = "nassaustreetpartners.com") -> list[str]:
        return [p.lower() for p in self.participants if p and not p.lower().endswith("@" + own_domain)]

    @property
    def has_content(self) -> bool:
        return len(self.text.strip()) > 200


def _ts(seconds: float) -> str:
    seconds = int(seconds or 0)
    return f"{seconds // 60:02d}:{seconds % 60:02d}"


def _from_api(t: dict) -> Transcript:
    sentences = t.get("sentences") or []
    text = "\n".join(f"[{_ts(s.get('start_time'))}] {s.get('speaker_name') or 'Speaker'}: {s.get('text', '')}"
                     for s in sentences)
    date = None
    if t.get("date"):
        date = datetime.fromtimestamp(int(t["date"]) / 1000, tz=timezone.utc)
    summary = t.get("summary") or {}
    participants = t.get("participants") or []
    flat = []
    for p in participants:  # Fireflies sometimes returns "a@x.com,b@y.com" in one string
        flat += [x.strip() for x in str(p).split(",") if x.strip()]
    return Transcript(id=t["id"], title=t.get("title", ""), date=date, participants=flat, text=text,
                      summary=summary.get("short_summary") or "", action_items=summary.get("action_items") or "",
                      duration_min=float(t.get("duration") or 0))


class FirefliesClient:
    def __init__(self, api_key: str | None = None, http: Http | None = None):
        self.http = http or Http("Fireflies", FIREFLIES_URL,
                                 headers={"Authorization": f"Bearer {api_key or secret('FIREFLIES_API_KEY')}"})

    def _gql(self, query: str, variables: dict) -> dict:
        resp = self.http.post("", json={"query": query, "variables": variables})
        if resp.get("errors"):
            raise RuntimeError(f"Fireflies error: {resp['errors']}")
        return resp["data"]

    def list(self, start: datetime, end: datetime, limit: int = 50) -> list[dict]:
        return self._gql(LIST_Q, {"fromDate": start.isoformat(), "toDate": end.isoformat(), "limit": limit})["transcripts"]

    def get(self, transcript_id: str) -> Transcript:
        return _from_api(self._gql(ONE_Q, {"id": transcript_id})["transcript"])

    def find_by_name(self, name: str, start: datetime, end: datetime) -> list[dict]:
        n = name.lower()
        return [t for t in self.list(start, end)
                if n in (t.get("title") or "").lower() or any(n in (p or "").lower() for p in t.get("participants") or [])]


def load_transcript_file(path: str | Path) -> Transcript:
    """Load a transcript saved as Fireflies JSON, or as text (the format the
    Fireflies connector prints: '[00:05 - 00:08] Name: text' plus header lines)."""
    p = Path(path)
    raw = p.read_text()
    if p.suffix == ".json":
        data = json.loads(raw)
        return _from_api(data.get("data", {}).get("transcript", data))
    participants = []
    m = re.search(r"^Participants:\s*(.+)$", raw, re.M)
    if m:
        participants = [x.strip() for x in m.group(1).split(",")]
    title = (re.search(r"^Title:\s*(.+)$", raw, re.M) or [None, p.stem])[1]
    tid = (re.search(r"^Id:\s*(.+)$", raw, re.M) or [None, p.stem])[1]
    lines = [l for l in raw.splitlines() if re.match(r"^\s*(Sentences:\s*)?\[\d", l)]
    text = "\n".join(l.replace("Sentences: ", "").strip() for l in lines) or raw
    return Transcript(id=tid.strip(), title=title.strip(), date=None, participants=participants, text=text)
