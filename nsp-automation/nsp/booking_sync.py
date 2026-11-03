"""Calendly -> Close + Notion booking sync.

For every active "M&A Advisory Meeting" booking that is 30+ minutes and whose
form answer counts as exploring a sale:
  1. Skip if already processed (state cache) or if Close already has an open
     M&A opportunity for that email (source-of-truth dedupe).
  2. Create (or reuse) the Close lead + contact, create the opportunity at
     Call Booked, add the form answers as a note.
  3. Add a Call Log row (Stage: Booked), unless one exists for that email.

Run it every 15 minutes (GitHub Actions) or by hand: `nsp sync-bookings`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from zoneinfo import ZoneInfo

from .calendly import CalendlyClient, parse_iso
from .close import CloseClient
from .config import Config
from .notion import NotionClient, rich
from .state import State

FREEMAIL = {"gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com", "aol.com",
            "live.com", "msn.com", "me.com", "protonmail.com", "proton.me", "gmx.com", "ymail.com"}


@dataclass
class Booking:
    event_uri: str
    invitee_uri: str
    name: str
    email: str
    phone: str
    start: datetime
    end: datetime
    event_name: str
    answers: list[tuple[str, str]]
    created_at: str = ""

    @property
    def minutes(self) -> int:
        return int((self.end - self.start).total_seconds() // 60)

    def answer(self, question: str) -> str:
        q = question.strip().lower()
        for k, v in self.answers:
            if k.strip().lower() == q:
                return v.strip()
        return ""

    @property
    def domain(self) -> str:
        return self.email.split("@")[-1].lower() if "@" in self.email else ""

    def company_guess(self) -> str:
        """Close leads are companies. The form has no company field, so use the
        email domain when it is a business domain, else the person's name."""
        d = self.domain
        if not d or d in FREEMAIL:
            return self.name
        root = d.split(".")[0]
        return root.replace("-", " ").title()

    def form_text(self, tz: str) -> str:
        local = self.start.astimezone(ZoneInfo(tz))
        lines = [f"{self.event_name}: {local:%a %d %b %Y %H:%M} {local.tzname()} ({self.minutes} min)",
                 f"Booked by: {self.name} <{self.email}>"]
        if self.phone:
            lines.append(f"Phone: {self.phone}")
        lines += [f"{q} {a}" if q.endswith("?") else f"{q}: {a}" for q, a in self.answers if a]
        return "\n".join(lines)


@dataclass
class SyncResult:
    created: list[str] = field(default_factory=list)
    skipped: list[tuple[str, str]] = field(default_factory=list)
    planned: list[str] = field(default_factory=list)
    errors: list[tuple[str, str]] = field(default_factory=list)


def to_booking(event: dict, invitee: dict) -> Booking:
    answers = [(qa.get("question", ""), qa.get("answer", "") or "")
               for qa in sorted(invitee.get("questions_and_answers") or [], key=lambda q: q.get("position", 0))]
    phone = invitee.get("text_reminder_number") or ""
    for q, a in answers:
        if q.lower().startswith("phone") and a:
            phone = a
    return Booking(
        event_uri=event["uri"], invitee_uri=invitee["uri"], name=(invitee.get("name") or "").strip(),
        email=(invitee.get("email") or "").strip().lower(), phone=phone,
        start=parse_iso(event["start_time"]), end=parse_iso(event["end_time"]),
        event_name=event.get("name", ""), answers=answers, created_at=invitee.get("created_at", ""),
    )


def qualifies(b: Booking, ccfg: dict) -> tuple[bool, str]:
    if b.event_name not in ccfg["event_type_names"]:
        return False, f"event type '{b.event_name}' is not M&A"
    if b.minutes < ccfg.get("min_duration_minutes", 30):
        return False, f"only {b.minutes} minutes"
    intent = b.answer(ccfg["intent_question"])
    if not intent:
        return False, "no answer to the intent question"
    allowed = {a.lower() for a in ccfg["qualifying_answers"]}
    if intent.lower() not in allowed:
        return False, f"form says '{intent}'"
    if not b.email:
        return False, "no invitee email"
    return True, intent


class BookingSync:
    def __init__(self, cfg: Config, calendly: CalendlyClient, close: CloseClient | None,
                 notion: NotionClient | None, state: State | None = None, dry_run: bool = False,
                 log=print):
        self.cfg, self.cal, self.close, self.notion = cfg, calendly, close, notion
        self.state = state or State("bookings")
        self.dry_run = dry_run
        self.log = log

    def run(self, now: datetime | None = None) -> SyncResult:
        ccfg = self.cfg["calendly"]
        res = SyncResult()
        if self.close and not self.dry_run:
            self.close.pipeline()  # org guard before anything else
        events = self.cal.window_events(ccfg["user_uri"], ccfg.get("lookback_hours", 48),
                                        ccfg.get("lookahead_days", 60), now=now)
        for ev in events:
            if ev.get("name") not in ccfg["event_type_names"]:
                continue  # not M&A: do not even fetch invitees
            for inv in self.cal.invitees(ev["uri"]):
                if inv.get("status", "active") != "active":
                    continue
                b = to_booking(ev, inv)
                key = b.invitee_uri
                if self.state.seen(key):
                    res.skipped.append((b.email, "already processed"))
                    continue
                ok, why = qualifies(b, ccfg)
                if not ok:
                    res.skipped.append((b.email or b.name, why))
                    self.state.mark(key, {"skipped": why})
                    continue
                try:
                    self._process(b, res)
                    if not self.dry_run:
                        self.state.mark(key, {"email": b.email})
                except Exception as exc:  # keep going; report at the end
                    res.errors.append((b.email, str(exc)))
                    self.log(f"ERROR {b.email}: {exc}")
        if not self.dry_run:
            self.state.save()
        return res

    def _process(self, b: Booking, res: SyncResult) -> None:
        tz = self.cfg.tz
        note = "M&A booking via Calendly\n" + b.form_text(tz)
        company = b.company_guess()

        if self.dry_run:
            res.planned.append(f"Close: lead '{company}' + contact {b.name} <{b.email}> + opportunity at Call Booked + note")
            res.planned.append(f"Notion: Call Log row '{b.name}' (Stage Booked, {b.start:%Y-%m-%d %H:%M}Z)")
            self.log(f"[dry-run] would sync {b.name} <{b.email}> ({b.answer(self.cfg['calendly']['intent_question'])})")
            return

        # ---- Close (source-of-truth dedupe by email) ----
        cl = self.close
        ccfg = self.cfg["close"]
        lead = cl.find_lead_by_email(b.email)
        if lead:
            opps = cl.lead_opportunities(lead["id"])
            open_opps = [o for o in opps if o.get("status_type", "active") == "active"]
            if open_opps:
                res.skipped.append((b.email, f"Close already has an open M&A opportunity ({open_opps[0]['id']})"))
                self.log(f"skip {b.email}: open opportunity exists")
                self._notion_row(b, res)  # still make sure the Call Log has it
                return
            contact_id = _contact_id_for(lead, b.email)
        else:
            contact = {"name": b.name, "emails": [{"email": b.email, "type": "office"}]}
            if b.phone:
                contact["phones"] = [{"phone": b.phone, "type": "office"}]
            lead = cl.create_lead(company, contact, ccfg["new_lead_status_id"])
            contact_id = _contact_id_for(lead, b.email)
        cl.create_opportunity(lead["id"], contact_id, ccfg["call_booked_status_id"],
                              note=f"{b.event_name} {b.start:%Y-%m-%d}")
        cl.add_note(lead["id"], note)
        res.created.append(f"Close lead {lead['id']} ({company}) for {b.email}")
        self.log(f"created Close lead/opportunity for {b.name} <{b.email}>")
        self._notion_row(b, res)

    def _notion_row(self, b: Booking, res: SyncResult) -> None:
        if not self.notion:
            return
        ds = self.cfg["notion"]["call_log_data_source_id"]
        existing = self.notion.query(ds, {"property": "Email", "email": {"equals": b.email}})
        if existing:
            res.skipped.append((b.email, "Call Log row already exists"))
            return
        props = {
            "Lead": {"title": rich(b.name or b.email)},
            "Company": {"rich_text": rich(b.company_guess())},
            "Email": {"email": b.email},
            "Stage": {"select": {"name": "Booked"}},
            "Call date": {"date": {"start": b.start.isoformat()}},
            "Form answers": {"rich_text": rich(b.form_text(self.cfg.tz))},
        }
        self.notion.create_row(ds, props)
        res.created.append(f"Call Log row for {b.email}")


def _contact_id_for(lead: dict, email: str) -> str | None:
    for c in lead.get("contacts", []):
        if any(e.get("email", "").lower() == email for e in c.get("emails", [])):
            return c["id"]
    contacts = lead.get("contacts") or []
    return contacts[0]["id"] if contacts else None
