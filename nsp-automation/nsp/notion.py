"""Notion API client for the M&A Call Log and the To do / lead pages."""

from __future__ import annotations

from typing import Any

from .config import secret
from .http import Http

NOTION_BASE = "https://api.notion.com/v1"
NOTION_VERSION = "2025-09-03"  # data-source aware version


def rich(text: str) -> list[dict]:
    """Notion caps one text object at 2000 chars; split longer strings."""
    text = text or ""
    return [{"type": "text", "text": {"content": text[i:i + 2000]}} for i in range(0, len(text), 2000)] or []


def plain(prop: dict | None) -> str:
    if not prop:
        return ""
    t = prop.get("type")
    if t in ("title", "rich_text"):
        return "".join(p.get("plain_text") or p.get("text", {}).get("content", "") for p in prop.get(t, []))
    if t == "email":
        return prop.get("email") or ""
    if t == "url":
        return prop.get("url") or ""
    if t == "select":
        return (prop.get("select") or {}).get("name", "")
    if t == "number":
        v = prop.get("number")
        return "" if v is None else str(v)
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

    # ---- data sources -------------------------------------------------------
    def query(self, data_source_id: str, filter_: dict | None = None) -> list[dict]:
        body: dict[str, Any] = {"page_size": 100}
        if filter_:
            body["filter"] = filter_
        out = []
        while True:
            resp = self.http.post(f"data_sources/{data_source_id}/query", json=body)
            out += resp.get("results", [])
            if not resp.get("has_more"):
                return out
            body["start_cursor"] = resp["next_cursor"]

    def create_row(self, data_source_id: str, properties: dict, children: list | None = None) -> dict:
        body: dict[str, Any] = {"parent": {"type": "data_source_id", "data_source_id": data_source_id},
                                "properties": properties}
        if children:
            body["children"] = children
        return self.http.post("pages", json=body)

    def update_page(self, page_id: str, properties: dict) -> dict:
        return self.http.patch(f"pages/{page_id}", json={"properties": properties})

    # ---- blocks ------------------------------------------------------------
    def children(self, block_id: str) -> list[dict]:
        out, params = [], {"page_size": 100}
        while True:
            resp = self.http.get(f"blocks/{block_id}/children", params=params)
            out += resp.get("results", [])
            if not resp.get("has_more"):
                return out
            params["start_cursor"] = resp["next_cursor"]

    def append(self, block_id: str, blocks: list[dict], after: str | None = None) -> dict:
        body: dict[str, Any] = {"children": blocks}
        if after:
            body["after"] = after
        return self.http.patch(f"blocks/{block_id}/children", json=body)

    def delete_block(self, block_id: str) -> None:
        self.http.delete(f"blocks/{block_id}")

    def page_text(self, page_id: str) -> str:
        """Flatten a page's top-level blocks to text (used to sync prompts)."""
        lines = []
        for b in self.children(page_id):
            t = b.get("type")
            payload = b.get(t, {})
            txt = "".join(r.get("plain_text", "") for r in payload.get("rich_text", []))
            prefix = {"heading_1": "# ", "heading_2": "## ", "heading_3": "### ",
                      "bulleted_list_item": "- ", "numbered_list_item": "1. "}.get(t, "")
            lines.append(prefix + txt)
        return "\n".join(lines)

    def replace_section(self, page_id: str, heading: str, blocks: list[dict], level: int = 2) -> str:
        """Replace the contents of a toggle heading called `heading`.

        The section is a toggleable heading whose children hold the content, so it
        can be replaced in place without moving anything else on the page. If it
        does not exist yet it is added at the end of the page once; drag it to the
        top in Notion and it stays there on every later run.
        """
        htype = f"heading_{level}"
        section_id = None
        for b in self.children(page_id):
            if b.get("type") == htype and "".join(
                    r.get("plain_text", "") for r in b[htype].get("rich_text", [])).strip() == heading:
                section_id = b["id"]
                break
        if section_id is None:
            hb = heading_block(heading, level)
            hb[htype]["is_toggleable"] = True
            hb[htype]["children"] = blocks[:100]
            created = self.append(page_id, [hb])
            section_id = created["results"][0]["id"]
            rest = blocks[100:]
        else:
            for child in self.children(section_id):
                self.delete_block(child["id"])
            rest = blocks
        for i in range(0, len(rest), 100):  # API limit: 100 blocks per append
            self.append(section_id, rest[i:i + 100])
        return section_id


def heading_block(text: str, level: int = 2) -> dict:
    t = f"heading_{level}"
    return {"object": "block", "type": t, t: {"rich_text": rich(text)}}


def para(text: str) -> dict:
    return {"object": "block", "type": "paragraph", "paragraph": {"rich_text": rich(text)}}


def bullet(text: str) -> dict:
    return {"object": "block", "type": "bulleted_list_item", "bulleted_list_item": {"rich_text": rich(text)}}
