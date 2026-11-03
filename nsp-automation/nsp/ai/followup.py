"""Post-call follow-up: transcript -> assessment, Call Log, Close note/stage, Gmail draft.

The model does the judgment (score, verdict, email text). Code does the rest
deterministically: stage mapping, style checks, NDA attachment, writes.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

from ..config import Config
from ..fireflies import Transcript
from ..nda_draft import create_nda_draft, house_style
from ..notion import plain, rich
from .llm import LLM, system_blocks

VERDICTS = ["strong", "promising", "not_ready", "too_small", "capital_raise", "not_selling", "no_show"]
TEMPLATES = {"strong": 1, "promising": 2, "not_ready": 3, "too_small": 4, "not_selling": 4,
             "capital_raise": 5, "no_show": 0}
# Deterministic stage mapping. Lost stages are only PROPOSED (Dead? column);
# they are applied after Ethan ticks Confirm dead.
FORWARD_STAGE = {"strong": "Qualified (Materials Requested)", "promising": "Qualified (Materials Requested)",
                 "not_ready": "Screening Call Held", "no_show": None}
LOST_STAGE = {"too_small": "Too Small", "not_selling": "Not a Fit", "capital_raise": "Not a Fit"}
NOTION_STAGE = {"strong": "Qualified", "promising": "Qualified", "not_ready": "Call held",
                "too_small": "DQ", "not_selling": "DQ", "capital_raise": "DQ", "no_show": "Booked"}
STAGE_ORDER = ["Call Booked", "Screening Call Held", "Qualified (Materials Requested)", "Soft Diligence",
               "Senior Team Call", "Fee and Engagement Review", "Engagement Sent", "Engagement Signed"]

_S = {"type": "string"}
SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["lead_name", "first_name", "company", "verdict", "score", "summary", "facts",
                 "buyer_concern", "close_note", "next_step", "chase_in_days", "dead_reason",
                 "attach_nda", "email_subject", "email_body"],
    "properties": {
        "lead_name": _S, "first_name": _S, "company": _S,
        "verdict": {"type": "string", "enum": VERDICTS},
        "score": {"type": "integer", "description": "1-10 lead quality: under $5M sale value scores low, $10M+ scores highest"},
        "summary": {"type": "string", "description": "Exactly three short lines separated by newlines"},
        "facts": {
            "type": "object", "additionalProperties": False,
            "required": ["revenue", "profit", "asking_price", "ownership", "timeline", "sector", "location"],
            "properties": {k: _S for k in ["revenue", "profit", "asking_price", "ownership", "timeline",
                                           "sector", "location"]},
        },
        "buyer_concern": {"type": "string", "description": "The honest question a buyer will raise"},
        "close_note": {"type": "string", "description": "CRM note: assessment, figures as stated, fit, next step"},
        "next_step": _S,
        "chase_in_days": {"type": "integer"},
        "dead_reason": {"type": "string", "description": "Empty unless the lead is a DQ; then a short reason"},
        "attach_nda": {"type": "boolean"},
        "email_subject": _S,
        "email_body": {"type": "string", "description": "Plain text, as Ethan, from the matching template"},
    },
}

INSTRUCTIONS = """Assess this M&A discovery call and draft Ethan's follow-up.

Steps:
1. Read the transcript. Identify the lead (the non-NSP participant), the company and what they want.
2. Choose the verdict:
   - strong: selling (all or a majority) and plausibly a $5M+ sale value (ideal: $10M+).
   - promising: selling and possibly $5M+, but key numbers are missing.
   - not_ready: a good business, but the timing for a sale is 12+ months out.
   - too_small: sale value clearly below the $5M minimum.
   - not_selling: no real intention to sell.
   - capital_raise: they want to raise capital rather than sell.
   - no_show: the call did not really happen or there is no substance.
3. Score 1-10 for how attractive this is as an NSP sell-side mandate.
4. Pick the template that matches the verdict (strong=1, promising=2, not_ready=3, too_small or not_selling=4,
   capital_raise=5) and fill every bracket from the call. Remove optional brackets you cannot fill well.
   Never leave a [bracket] in the email. Never invent figures or deals; only cite comparables the call mentioned.
   For no_show, write a two-line note offering to rebook.
5. attach_nda is true for templates 1 and 2 only.
6. Write as Ethan: short, confident, no em dashes, fees only within $60K to $150K work fee and 6% to 8% success fee.
"""

STUB = {
    "lead_name": "[DRY RUN] Lead Name", "first_name": "[DRY RUN]", "company": "[DRY RUN] Company",
    "verdict": "promising", "score": 6,
    "summary": "[DRY RUN] line 1\n[DRY RUN] line 2\n[DRY RUN] line 3",
    "facts": {k: "not stated" for k in ["revenue", "profit", "asking_price", "ownership", "timeline", "sector", "location"]},
    "buyer_concern": "[DRY RUN]", "close_note": "[DRY RUN] Close note text",
    "next_step": "[DRY RUN] Receive signed NDA and financials", "chase_in_days": 4, "dead_reason": "",
    "attach_nda": True, "email_subject": "Nassau Street Partners | Following up on today's call",
    "email_body": "Hi [DRY RUN],\n\nThis is placeholder text. With ANTHROPIC_API_KEY set, Claude writes this "
                  "email from the transcript and the template.\n\nBest regards,\nEthan\n",
}


@dataclass
class Assessment:
    data: dict
    transcript: Transcript
    warnings: list[str] = field(default_factory=list)

    @property
    def verdict(self) -> str:
        return self.data["verdict"]

    def lead_email(self) -> str:
        ext = self.transcript.external_emails()
        return ext[0] if ext else ""


def build_request(llm: LLM, t: Transcript, notes: str = "") -> dict:
    when = t.date.strftime("%Y-%m-%d") if t.date else "unknown date"
    user = (f"{INSTRUCTIONS}\n<call title=\"{t.title}\" date=\"{when}\" participants=\"{', '.join(t.participants)}\">\n"
            f"<transcript>\n{t.text}\n</transcript>\n")
    if t.summary:
        user += f"<fireflies_summary>\n{t.summary}\n</fireflies_summary>\n"
    if notes:
        user += f"<ethan_notes>\n{notes}\n</ethan_notes>\n"
    user += "</call>"
    return llm.build(tier="strong", system=system_blocks("playbook.md", "templates.md"), user=user,
                     schema=SCHEMA, max_tokens=16000)


FEE_RE = re.compile(r"\$\s?(\d{2,3})\s?[kK]")


def check_output(data: dict, handbook: dict | None = None) -> list[str]:
    """Deterministic guard rails on the model's draft."""
    hb = handbook or {}
    fee_lo, fee_hi = hb.get("work_fee_k", [60, 150])
    pct_lo, pct_hi = hb.get("success_fee_pct", [6, 8])
    warnings = []
    data["email_body"] = house_style(data.get("email_body", ""))
    data["email_subject"] = house_style(data.get("email_subject", ""))
    if not 1 <= int(data.get("score", 0)) <= 10:
        warnings.append(f"score {data.get('score')} outside 1-10; clamped")
        data["score"] = max(1, min(10, int(data.get("score", 1))))
    if "[" in data["email_body"] and "]" in data["email_body"]:
        warnings.append("email still contains a [bracket]; review before sending")
    for m in FEE_RE.finditer(data["email_body"]):
        if not fee_lo <= int(m.group(1)) <= fee_hi:
            warnings.append(f"email quotes ${m.group(1)}K, outside the ${fee_lo}K to ${fee_hi}K work fee range")
    for pct in re.findall(r"(\d+(?:\.\d+)?)\s?%", data["email_body"]):
        if "success" in data["email_body"].lower() and not pct_lo <= float(pct) <= pct_hi:
            warnings.append(f"email quotes {pct}%, outside the {pct_lo}% to {pct_hi}% success fee range")
    if data.get("verdict") in ("strong", "promising"):
        data["attach_nda"] = True
    elif data.get("verdict") in ("too_small", "not_selling", "capital_raise", "no_show"):
        data["attach_nda"] = False
    return warnings


def assess(llm: LLM, t: Transcript, notes: str = "") -> Assessment:
    params = build_request(llm, t, notes)
    data, _ = llm.call("followup", params, stub=lambda: dict(STUB, facts=dict(STUB["facts"])))
    warnings = check_output(data, llm.cfg.get("handbook"))
    return Assessment(data, t, warnings)


# ---- applying the result ----------------------------------------------------

@dataclass
class ApplyPlan:
    steps: list[str] = field(default_factory=list)
    done: list[str] = field(default_factory=list)


def apply(cfg: Config, a: Assessment, *, notion=None, close=None, gmail=None, drive=None,
          write: bool = False, log=print) -> ApplyPlan:
    """Write the assessment out. With write=False, only describe what would happen."""
    plan = ApplyPlan()
    d = a.data
    email = a.lead_email()
    chase = (datetime.now(timezone.utc) + timedelta(days=int(d.get("chase_in_days") or 3))).date().isoformat()
    notion_stage = NOTION_STAGE[a.verdict]
    forward = FORWARD_STAGE.get(a.verdict)
    lost = LOST_STAGE.get(a.verdict)

    plan.steps.append(f"Call Log: {d['lead_name']} <{email}> Stage={notion_stage}, Score={d['score']}, "
                      f"Next step, Chase date {chase}, tick Transcript reviewed"
                      + (f", Dead? = '{d['dead_reason'] or lost}'" if lost else ""))
    plan.steps.append(f"Close: add assessment note" + (f"; move opportunity forward to '{forward}'" if forward
                      and cfg["close"].get("auto_stage_moves") else "")
                      + (f"; PROPOSE lost stage '{lost}' (applied only after Confirm dead)" if lost else ""))
    plan.steps.append(f"Gmail: draft to {email or '<no external participant email>'}: '{d['email_subject']}'"
                      + (" + NDA attached" if d["attach_nda"] else ""))
    if not write:
        return plan

    # 1. Gmail draft (first, so the Call Log can link it)
    draft_link = ""
    if email and d.get("email_body"):
        res = create_nda_draft(cfg, to=email, subject=d["email_subject"], body=d["email_body"],
                               attach_nda=bool(d["attach_nda"]), reply_in_thread=True, gmail=gmail, drive=drive)
        draft_link = res.link
        plan.done.append(f"Gmail draft {res.draft_id}" + (" with NDA" if res.attached else ""))

    # 2. Close
    if close is not None and email:
        lead = close.find_lead_by_email(email)
        if lead:
            note = (f"Post-call assessment ({a.verdict}, score {d['score']}/10)\n{d['summary']}\n\n"
                    f"{d['close_note']}\n\nNext step: {d['next_step']}")
            close.add_note(lead["id"], note)
            plan.done.append("Close note")
            if forward and cfg["close"].get("auto_stage_moves"):
                moved = _move_forward(close, lead["id"], forward)
                if moved:
                    plan.done.append(moved)
        else:
            plan.done.append(f"Close: no lead found for {email}; add it with the booking sync or by hand")

    # 3. Notion Call Log
    if notion is not None:
        ds = cfg["notion"]["call_log_data_source_id"]
        rows = notion.query(ds, {"property": "Email", "email": {"equals": email}}) if email else []
        props = {
            "Summary": {"rich_text": rich(d["summary"])},
            "Score": {"number": int(d["score"])},
            "Stage": {"select": {"name": notion_stage}},
            "Next step": {"rich_text": rich(d["next_step"])},
            "Chase date": {"date": {"start": chase}},
            "Transcript reviewed": {"checkbox": True},
            "Close note added": {"checkbox": close is not None},
        }
        if draft_link:
            props["Draft ready"] = {"checkbox": True}
            props["Draft link"] = {"url": draft_link}
        if lost:
            props["Dead?"] = {"rich_text": rich(f"{lost}: {d['dead_reason']}".strip(": "))}
        if a.warnings:
            props["Summary"] = {"rich_text": rich(d["summary"] + "\nCHECK: " + "; ".join(a.warnings))}
        if rows:
            notion.update_page(rows[0]["id"], props)
        else:
            props.update({"Lead": {"title": rich(d["lead_name"])}, "Company": {"rich_text": rich(d["company"])},
                          "Email": {"email": email or None},
                          "Call date": {"date": {"start": (a.transcript.date or datetime.now(timezone.utc)).isoformat()}}})
            notion.create_row(ds, props)
        plan.done.append("Call Log row")
    for line in plan.done:
        log(f"  done: {line}")
    return plan


def _move_forward(close, lead_id: str, target_label: str) -> str:
    opps = [o for o in close.lead_opportunities(lead_id) if o.get("status_type", "active") == "active"]
    if not opps:
        return ""
    opp = opps[0]
    current = opp.get("status_label", "")
    target = close.resolve_opp_status(target_label)
    if current in STAGE_ORDER and target.label in STAGE_ORDER and \
            STAGE_ORDER.index(target.label) <= STAGE_ORDER.index(current):
        return ""  # never move backwards
    close.set_opportunity_status(opp["id"], target.id)
    return f"Close stage {current} -> {target.label}"


def already_done(notion, cfg: Config, email: str) -> bool:
    if not (notion and email):
        return False
    rows = notion.query(cfg["notion"]["call_log_data_source_id"], {"property": "Email", "email": {"equals": email}})
    return bool(rows) and plain(rows[0]["properties"].get("Draft ready")) == "yes"


def render(a: Assessment) -> str:
    d = a.data
    lines = [f"Lead: {d['lead_name']} ({d['company']})  verdict={a.verdict}  score={d['score']}/10",
             "Summary:", *("  " + s for s in d["summary"].splitlines()),
             "Facts: " + ", ".join(f"{k}={v}" for k, v in d["facts"].items()),
             f"Buyer concern: {d['buyer_concern']}", f"Next step: {d['next_step']} (chase in {d['chase_in_days']}d)"]
    if d.get("dead_reason"):
        lines.append(f"Dead? (suggestion only): {d['dead_reason']}")
    lines += ["", f"Subject: {d['email_subject']}" + ("   [NDA attached]" if d["attach_nda"] else ""), "",
              d["email_body"]]
    if a.warnings:
        lines += ["", "WARNINGS: " + "; ".join(a.warnings)]
    return "\n".join(lines)


def batch_requests(llm: LLM, items: list[tuple[str, Transcript]]) -> list[dict]:
    """Batch API requests (50% cheaper) for the overnight safety net."""
    out = []
    for custom_id, t in items:
        params = build_request(llm, t)
        out.append({"custom_id": custom_id, "params": params})
    return out


def parse_batch_result(result: Any) -> dict | None:
    import json
    if result.result.type != "succeeded":
        return None
    msg = result.result.message
    if msg.stop_reason != "end_turn":
        return None
    return json.loads("".join(b.text for b in msg.content if b.type == "text"))


__all__ = ["assess", "apply", "render", "Assessment", "SCHEMA", "check_output", "build_request"]
