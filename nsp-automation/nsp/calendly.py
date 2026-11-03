"""Calendly API v2 client (personal access token)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from .config import secret
from .http import Http

CALENDLY_BASE = "https://api.calendly.com"


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def parse_iso(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


class CalendlyClient:
    def __init__(self, token: str | None = None, http: Http | None = None):
        self.http = http or Http(
            "Calendly", CALENDLY_BASE,
            headers={"Authorization": f"Bearer {token or secret('CALENDLY_TOKEN')}"},
        )

    def _paginate(self, path: str, params: dict) -> list[dict]:
        out, params = [], dict(params)
        while True:
            resp = self.http.get(path, params=params)
            out += resp.get("collection", [])
            token = (resp.get("pagination") or {}).get("next_page_token")
            if not token:
                return out
            params["page_token"] = token

    def scheduled_events(self, user_uri: str, start: datetime, end: datetime, status: str = "active") -> list[dict]:
        return self._paginate("scheduled_events", {
            "user": user_uri, "min_start_time": iso(start), "max_start_time": iso(end),
            "status": status, "count": 100, "sort": "start_time:asc",
        })

    def invitees(self, event_uri: str) -> list[dict]:
        path = event_uri.replace(CALENDLY_BASE, "") + "/invitees"
        return self._paginate(path, {"count": 100})

    def window_events(self, user_uri: str, lookback_hours: int, lookahead_days: int,
                      now: datetime | None = None) -> list[dict]:
        now = now or datetime.now(timezone.utc)
        return self.scheduled_events(user_uri, now - timedelta(hours=lookback_hours), now + timedelta(days=lookahead_days))
