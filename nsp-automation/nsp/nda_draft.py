"""Create a Gmail draft (never sent) with the NDA attached via the Gmail API.

Claude, or you, only supplies the text. The 20-300KB Word file goes straight
from Drive (cached) to Gmail and never passes through a model.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from .config import Config
from .google import Drive, Gmail, build_message, nda_bytes

DASHES = re.compile(r"\s*[—–]\s*")  # em dash, en dash


def house_style(text: str) -> str:
    """Enforce 'no em dashes': replace em/en dashes with a comma."""
    return DASHES.sub(", ", text)


@dataclass
class DraftResult:
    draft_id: str
    message_id: str
    thread_id: str
    link: str
    attached: str | None


def draft_link(message_id: str) -> str:
    return f"https://mail.google.com/mail/u/0/#drafts?compose={message_id}"


def find_thread_for(gmail: Gmail, email: str) -> dict | None:
    """Most recent thread with this person, so the draft lands as a reply."""
    threads = gmail.search_threads(f"from:{email} OR to:{email}", max_results=1)
    if not threads:
        return None
    t = gmail.get_thread(threads[0]["id"])
    last = t["messages"][-1]
    headers = {h["name"].lower(): h["value"] for h in last.get("payload", {}).get("headers", [])}
    return {"id": t["id"], "message_id": headers.get("message-id", ""),
            "references": headers.get("references", ""), "subject": headers.get("subject", "")}


def create_nda_draft(cfg: Config, *, to: str, subject: str, body: str, cc: str = "",
                     attach_nda: bool = True, reply_in_thread: bool = False,
                     gmail: Gmail | None = None, drive: Drive | None = None,
                     dry_run: bool = False) -> DraftResult | dict:
    gcfg = cfg["gmail"]
    body = house_style(body).strip() + "\n"
    subject = house_style(subject)
    attachment = None
    if attach_nda and not dry_run:
        attachment = nda_bytes(gcfg, drive)
    if dry_run:
        return {"to": to, "cc": cc, "subject": subject, "body": body,
                "attachment": gcfg.get("nda_attachment_name") if attach_nda else None}
    gmail = gmail or Gmail()
    thread = find_thread_for(gmail, to) if reply_in_thread else None
    msg = build_message(to=to, cc=cc, subject=subject, body=body, attachment=attachment,
                        in_reply_to=(thread or {}).get("message_id", ""),
                        references=(thread or {}).get("references", ""))
    d = gmail.create_draft(msg, thread_id=(thread or {}).get("id"))
    m = d.get("message", {})
    return DraftResult(d["id"], m.get("id", ""), m.get("threadId", ""), draft_link(m.get("id", "")),
                       attachment[0] if attachment else None)
