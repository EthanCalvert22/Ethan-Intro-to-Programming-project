"""Minimal Notion API client for the "Close changes" queue."""

from __future__ import annotations

from typing import Any

from .config import secret
from .http import Http

NOTION_BASE = "https://api.notion.com/v1"
NOTION_VERSION = "2025-09-03"  # data-source aware API version


def rich(text: str) -> list[dict]:
    """Notion caps one text object at 2000 characters."""
    text = text or ""
    return [{"type": "text", "text": {"content": text[i:i + 2000]}} for i in range(0, min(len(text), 6000), 2000)]


def plain(prop: dict | None) -> str:
    if not prop:
        return ""
    t = prop.get("type")
    if t in ("title", "rich_text"):
        return "".join(p.get("plain_text") or p.get("text", {}).get("content", "") for p in prop.get(t, []))
    if t == "select":
        return (prop.get("select") or {}).get("name", "")
    if t == "checkbox":
        return "yes" if prop.get("checkbox") else ""
    if t == "date":
        return (prop.get("date") or {}).get("start", "")
    return ""


class NotionClient:
    def __init__(self, token: str | None = None, http: Http | None = None):
        self.http = http or Http(
            "Notion", NOTION_BASE,
            headers={"Authorization": f"Bearer {token or secret('NOTION_TOKEN')}",
                     "Notion-Version": NOTION_VERSION, "Content-Type": "application/json"},
        )

    def query(self, data_source_id: str, filter_: dict | None = None, sorts: list | None = None) -> list[dict]:
        body: dict[str, Any] = {"page_size": 100}
        if filter_:
            body["filter"] = filter_
        if sorts:
            body["sorts"] = sorts
        out = []
        while True:
            resp = self.http.post(f"data_sources/{data_source_id}/query", json=body)
            out += resp.get("results", [])
            if not resp.get("has_more"):
                return out
            body["start_cursor"] = resp["next_cursor"]

    def update_page(self, page_id: str, properties: dict) -> dict:
        return self.http.patch(f"pages/{page_id}", json={"properties": properties})
