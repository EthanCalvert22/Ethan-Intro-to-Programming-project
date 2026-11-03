"""Morning brief: top 5 live deals, today's call preps, slipping items -> Notion "Today"."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from ..booking_sync import to_booking
from ..config import Config
from ..notion import bullet, heading_block, para, plain
from .llm import LLM, system_blocks

BRIEF_INSTRUCTIONS = """Write Ethan's morning brief from the data below. Plain text, using exactly these sections:

## Top 5 live deals
One line each: name (company), why it ranks (size against the $10M threshold, momentum such as NDA,
materials or senior team involvement, urgency such as competing buyers, deadlines, or Ethan owing a reply).

## Today's calls
For each call: time (Lisbon), who they are, the business, likely size, and three sharp questions as "- " lines.

## Slipping
Every flagged item, one "- " line each, most urgent first.

Use only the data given. If a section has nothing, write "Nothing today." No em dashes."""


def collect(cfg: Config, *, notion, calendly, now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    tz = ZoneInfo(cfg.tz)
    rows = notion.query(cfg["notion"]["call_log_data_source_id"])
    live, flags = [], []
    for r in rows:
        p = r["properties"]
        row = {k: plain(p.get(k)) for k in ("Lead", "Company", "Email", "Stage", "Score", "Summary", "Next step",
                                            "Chase date", "Draft ready", "Sent", "Dead?")}
        edited = r.get("last_edited_time", "")
        if row["Stage"] in ("Dead", "DQ"):
            continue
        live.append(row)
        if row["Draft ready"] == "yes" and row["Sent"] != "yes" and edited and \
                now - datetime.fromisoformat(edited.replace("Z", "+00:00")) > timedelta(hours=24):
            flags.append(f"Draft ready but not sent for 24h+: {row['Lead']}")
        if row["Chase date"] and row["Chase date"][:10] <= now.astimezone(tz).date().isoformat() and row["Sent"] == "yes":
            flags.append(f"Chase due: {row['Lead']} ({row['Next step']})")
        if row["Stage"] == "Qualified" and row["Sent"] == "yes" and edited and \
                now - datetime.fromisoformat(edited.replace("Z", "+00:00")) > timedelta(days=5):
            flags.append(f"NDA out 5+ days with no movement: {row['Lead']}")
        if row["Dead?"]:
            flags.append(f"Dead suggested, tick Confirm dead if you agree: {row['Lead']} ({row['Dead?']})")
    start = now.astimezone(tz).replace(hour=0, minute=0, second=0, microsecond=0)
    calls = []
    if calendly is not None:
        ccfg = cfg["calendly"]
        for ev in calendly.scheduled_events(ccfg["user_uri"], start, start + timedelta(days=1)):
            if ev.get("name") not in ccfg["event_type_names"]:
                continue
            for inv in calendly.invitees(ev["uri"]):
                b = to_booking(ev, inv)
                calls.append(b.form_text(cfg.tz))
    return {"live": live, "flags": flags, "calls": calls, "date": now.astimezone(tz).strftime("%A %d %B %Y")}


def build_request(llm: LLM, data: dict) -> dict:
    deals = "\n".join(" | ".join(f"{k}: {v}" for k, v in d.items() if v) for d in data["live"]) or "none"
    calls = "\n\n".join(data["calls"]) or "none"
    flags = "\n".join("- " + f for f in data["flags"]) or "none"
    user = (f"{BRIEF_INSTRUCTIONS}\n\n<date>{data['date']}</date>\n<live_deals>\n{deals}\n</live_deals>\n"
            f"<todays_calls>\n{calls}\n</todays_calls>\n<flags>\n{flags}\n</flags>")
    return llm.build(tier="strong", system=system_blocks("playbook.md"), user=user, max_tokens=8000)


def text_to_blocks(text: str) -> list[dict]:
    blocks = []
    for line in text.splitlines():
        s = line.strip()
        if not s:
            continue
        if s.startswith("## "):
            blocks.append(heading_block(s[3:], 3))
        elif s.startswith(("- ", "* ")):
            blocks.append(bullet(s[2:]))
        else:
            blocks.append(para(s))
    return blocks


def run(cfg: Config, llm: LLM, *, notion, calendly, write: bool, log=print) -> str:
    data = collect(cfg, notion=notion, calendly=calendly)
    stub = lambda: ("## Top 5 live deals\n[DRY RUN] ranking appears here\n## Today's calls\n" +
                    ("\n".join(f"- {c.splitlines()[0]}" for c in data["calls"]) or "Nothing today.") +
                    "\n## Slipping\n" + ("\n".join(f"- {f}" for f in data["flags"]) or "Nothing today."))
    text, _ = llm.call("brief", build_request(llm, data), stub=stub)
    blocks = [para(f"Updated {data['date']}")] + text_to_blocks(text)
    if write:
        notion.replace_section(cfg["notion"]["todo_page_id"], "Today", blocks)
        log("Wrote the Today section on the To do M&A page.")
    else:
        log(text)
    return text
