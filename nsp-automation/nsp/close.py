"""Close CRM REST client and the operations the Claude connector cannot do.

Auth: HTTP Basic with the API key as username and an empty password.
Docs: https://developer.close.com/
"""

from __future__ import annotations

import difflib
import re
from dataclasses import dataclass
from typing import Any

from .config import Config, secret
from .http import Http

CLOSE_BASE = "https://api.close.com/api/v1"


class CloseError(RuntimeError):
    pass


class WrongOrgError(CloseError):
    pass


@dataclass
class Status:
    id: str
    label: str
    type: str  # active | won | lost
    pipeline_id: str | None = None


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", s.lower().replace("&", " and ").replace("'", "")).strip()


class CloseClient:
    def __init__(self, cfg: Config, api_key: str | None = None, http: Http | None = None):
        self.cfg = cfg
        self.ccfg = cfg["close"]
        self.http = http or Http("Close", CLOSE_BASE, auth=(api_key or secret("CLOSE_API_KEY"), ""))
        self._pipeline: dict | None = None
        self._lead_statuses: list[Status] | None = None

    # ---- org guard ---------------------------------------------------------
    def pipeline(self) -> dict:
        """Return the M&A pipeline, or refuse if this key belongs to another org."""
        if self._pipeline is None:
            pipes = self.http.get("pipeline/")["data"]
            match = [p for p in pipes if p["id"] == self.ccfg["pipeline_id"]]
            if not match:
                names = ", ".join(p.get("name", "?") for p in pipes) or "none"
                raise WrongOrgError(
                    f"Pipeline {self.ccfg['pipeline_id']} ({self.ccfg['pipeline_name']}) is not in the org "
                    f"this CLOSE_API_KEY belongs to (pipelines found: {names}). Refusing to touch it. "
                    "Use a key from the Nassau Street Partners org, never NSP - VP Sales."
                )
            self._pipeline = match[0]
        return self._pipeline

    def opp_statuses(self) -> list[Status]:
        pipe = self.pipeline()
        return [Status(s["id"], s["label"], s.get("type", "active"), pipe["id"]) for s in pipe.get("statuses", [])]

    def lead_statuses(self) -> list[Status]:
        if self._lead_statuses is None:
            data = self.http.get("status/lead/")["data"]
            self._lead_statuses = [Status(s["id"], s["label"], "lead") for s in data]
        return self._lead_statuses

    # ---- name resolution ---------------------------------------------------
    def resolve_opp_status(self, name: str) -> Status:
        statuses = self.opp_statuses()
        aliases = {_norm(k): v for k, v in self.ccfg.get("stage_aliases", {}).items()}
        target = aliases.get(_norm(name), name)
        return _pick(statuses, target, "M&A pipeline stage")

    def resolve_lead_status(self, name: str) -> Status:
        return _pick(self.lead_statuses(), name, "lead status")

    # ---- leads -------------------------------------------------------------
    def search_leads(self, text: str, limit: int = 25) -> list[dict]:
        params = {"query": text, "_limit": limit,
                  "_fields": "id,display_name,name,status_id,status_label,contacts,url"}
        return self.http.get("lead/", params=params).get("data", [])

    def find_lead(self, name: str) -> dict:
        """Find exactly one lead by (part of) its name or a contact's name/email."""
        if name.startswith("lead_"):
            return self.get_lead(name)
        candidates = self.search_leads(name)
        n = _norm(name)

        def hay(lead: dict) -> list[str]:
            vals = [lead.get("display_name") or lead.get("name") or ""]
            for c in lead.get("contacts", []):
                vals.append(c.get("name") or "")
                vals += [e.get("email", "") for e in c.get("emails", [])]
            return [_norm(v) for v in vals if v]

        exact = [lead for lead in candidates if n in hay(lead)]
        partial = [lead for lead in candidates if any(n in h for h in hay(lead))]
        found = exact or partial
        if not found:
            raise CloseError(f"No Close lead matches '{name}'.")
        if len(found) > 1:
            listing = "; ".join(f"{l.get('display_name')} ({l['id']})" for l in found[:10])
            raise CloseError(f"'{name}' matches {len(found)} leads: {listing}. Be more specific or pass the lead id.")
        return found[0]

    def get_lead(self, lead_id: str) -> dict:
        return self.http.get(f"lead/{lead_id}/")

    def find_lead_by_email(self, email: str) -> dict | None:
        email_l = email.strip().lower()
        for lead in self.search_leads(email_l, limit=10):
            for c in lead.get("contacts", []):
                if any(e.get("email", "").lower() == email_l for e in c.get("emails", [])):
                    return lead
        return None

    def update_lead(self, lead_id: str, **fields) -> dict:
        self.pipeline()  # org guard before any write
        return self.http.put(f"lead/{lead_id}/", json=fields)

    def create_lead(self, name: str, contact: dict, status_id: str, description: str = "") -> dict:
        self.pipeline()
        body = {"name": name, "status_id": status_id, "contacts": [contact]}
        if description:
            body["description"] = description
        return self.http.post("lead/", json=body)

    # ---- opportunities -----------------------------------------------------
    def lead_opportunities(self, lead_id: str) -> list[dict]:
        data = self.http.get("opportunity/", params={"lead_id": lead_id, "_limit": 100}).get("data", [])
        ids = {s.id for s in self.opp_statuses()}
        return [o for o in data if o.get("status_id") in ids]

    def create_opportunity(self, lead_id: str, contact_id: str | None, status_id: str, note: str = "") -> dict:
        self.pipeline()
        body: dict[str, Any] = {"lead_id": lead_id, "status_id": status_id}
        if contact_id:
            body["contact_id"] = contact_id
        if note:
            body["note"] = note
        return self.http.post("opportunity/", json=body)

    def set_opportunity_status(self, opp_id: str, status_id: str) -> dict:
        self.pipeline()
        return self.http.put(f"opportunity/{opp_id}/", json={"status_id": status_id})

    def count_opportunities_with_status(self, status_id: str) -> int:
        resp = self.http.get("opportunity/", params={"status_id": status_id, "_limit": 1, "_fields": "id"})
        if "total_results" in resp:
            return int(resp["total_results"])
        return len(resp.get("data", [])) + (1 if resp.get("has_more") else 0)

    def delete_opp_status(self, status_id: str) -> None:
        self.pipeline()
        self.http.delete(f"status/opportunity/{status_id}/")

    # ---- notes -------------------------------------------------------------
    def add_note(self, lead_id: str, text: str) -> dict:
        self.pipeline()
        return self.http.post("activity/note/", json={"lead_id": lead_id, "note": text})


def _pick(statuses: list[Status], name: str, kind: str) -> Status:
    n = _norm(name)
    by_norm = {_norm(s.label): s for s in statuses}
    if n in by_norm:
        return by_norm[n]
    starts = [s for s in statuses if _norm(s.label).startswith(n)]
    if len(starts) == 1:
        return starts[0]
    close = difflib.get_close_matches(n, list(by_norm), n=3, cutoff=0.6)
    if len(close) == 1 or (close and difflib.SequenceMatcher(None, n, close[0]).ratio() > 0.85):
        return by_norm[close[0]]
    options = ", ".join(s.label for s in statuses)
    raise CloseError(f"Unknown {kind} '{name}'. Options: {options}")


# ---- high-level operations used by the CLI and the AI jobs ------------------

@dataclass
class Plan:
    description: str
    apply: Any  # zero-arg callable

    def __str__(self) -> str:
        return self.description


def plan_move(client: CloseClient, lead_query: str, stage: str) -> Plan:
    lead = client.find_lead(lead_query)
    target = client.resolve_opp_status(stage)
    opps = client.lead_opportunities(lead["id"])
    if not opps:
        raise CloseError(f"{lead['display_name']} has no opportunity in {client.ccfg['pipeline_name']}.")
    open_opps = [o for o in opps if o.get("status_type", "active") == "active"] or opps
    opp = open_opps[0]
    if opp.get("status_id") == target.id:
        return Plan(f"{lead['display_name']} is already at {target.label}. Nothing to do.", lambda: None)
    current = opp.get("status_label") or opp.get("status_id")
    return Plan(
        f"Move {lead['display_name']} opportunity {opp['id']} from '{current}' to '{target.label}'",
        lambda: client.set_opportunity_status(opp["id"], target.id),
    )


def plan_lead_status(client: CloseClient, lead_query: str, status: str) -> Plan:
    lead = client.find_lead(lead_query)
    target = client.resolve_lead_status(status)
    return Plan(
        f"Set lead status of {lead['display_name']} from '{lead.get('status_label')}' to '{target.label}'",
        lambda: client.update_lead(lead["id"], status_id=target.id),
    )


def plan_rename(client: CloseClient, lead_query: str, new_name: str) -> Plan:
    lead = client.find_lead(lead_query)
    return Plan(
        f"Rename lead '{lead['display_name']}' ({lead['id']}) to '{new_name}'",
        lambda: client.update_lead(lead["id"], name=new_name),
    )


def plan_delete_status(client: CloseClient, label: str) -> Plan:
    target = _pick(client.opp_statuses(), label, "M&A pipeline stage")
    if target.type != "lost":
        raise CloseError(f"'{target.label}' is a {target.type} stage, not a lost reason. Refusing to delete it.")
    in_use = client.count_opportunities_with_status(target.id)
    if in_use:
        raise CloseError(
            f"'{target.label}' is used by {in_use} opportunities. Move them first "
            f"(Close refuses to delete a status in use)."
        )
    return Plan(f"Delete unused lost reason '{target.label}' ({target.id})",
                lambda: client.delete_opp_status(target.id))


COMMAND_PATTERNS = [
    (re.compile(r"^(?:move|stage)\s+(?P<lead>.+?)\s+(?:to|->)\s+(?P<arg>.+)$", re.I), plan_move),
    (re.compile(r"^(?:mark|set)\s+(?P<lead>.+?)\s+(?:as|status(?: to)?|lead status(?: to)?)\s+(?P<arg>.+)$", re.I), plan_lead_status),
    (re.compile(r"^rename\s+(?P<lead>.+?)\s+(?:to|as)\s+(?P<arg>.+)$", re.I), plan_rename),
    (re.compile(r"^(?:delete|remove)\s+(?:lost reason|status|stage)\s+(?P<arg>.+)$", re.I), None),
]


def plan_from_sentence(client: CloseClient, sentence: str) -> Plan:
    """Turn "move Harrison to Qualified" style sentences into a plan."""
    s = sentence.strip().strip(".").strip('"').strip()
    for pattern, fn in COMMAND_PATTERNS:
        m = pattern.match(s)
        if not m:
            continue
        arg = m.group("arg").strip().strip('"').strip("'")
        if fn is None:
            return plan_delete_status(client, arg)
        return fn(client, m.group("lead").strip().strip('"').strip("'"), arg)
    raise CloseError(
        "Did not understand. Try: 'move Harrison to Qualified', 'mark Harrison as Interested', "
        "'rename Harrison to Harrison Plumbing LLC', 'delete lost reason Duplicate'."
    )
