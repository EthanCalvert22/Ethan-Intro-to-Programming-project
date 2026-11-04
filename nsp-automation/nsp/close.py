"""Close CRM REST client and the edits the Claude connector cannot make.

Auth: HTTP Basic with the API key as username and an empty password.
Docs: https://developer.close.com/

Safety rules enforced here, not by the caller:
- the org must contain the M&A pipeline (wrong org = refuse everything);
- stage moves only to stages of that pipeline, only on its opportunities;
- lead edits only on leads that have an M&A opportunity;
- deletes only M&A opportunities, never won ones, and only an unambiguous one;
- lost reasons are deleted only when no opportunity uses them.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Callable

from .config import Config, secret
from .http import Http

CLOSE_BASE = "https://api.close.com/api/v1"
LEAD_ID_RE = re.compile(r"(lead_[A-Za-z0-9]+)")
OPP_ID_RE = re.compile(r"(oppo_[A-Za-z0-9]+)")


class CloseError(RuntimeError):
    pass


class WrongOrgError(CloseError):
    pass


@dataclass
class Status:
    id: str
    label: str
    type: str  # active | won | lost | lead


def norm(s: str) -> str:
    s = s.lower().replace("&", " and ").replace("'", "").replace("’", "")
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def _core(label: str) -> str:
    """'Lost: Too Small' -> 'too small' so people can type the short name."""
    return re.sub(r"^(lost|won)\s+", "", norm(label))


def pick_status(statuses: list[Status], name: str, kind: str, aliases: dict | None = None) -> Status:
    target = (aliases or {}).get(norm(name), name)
    n = norm(target)
    for test in (lambda s: norm(s.label) == n, lambda s: _core(s.label) == _core(target)):
        hits = [s for s in statuses if test(s)]
        if len(hits) == 1:
            return hits[0]
    starts = [s for s in statuses if norm(s.label).startswith(n) or _core(s.label).startswith(n)]
    if len(starts) == 1:
        return starts[0]
    options = "; ".join(s.label for s in statuses)
    raise CloseError(f"Unknown {kind} '{name}'. Options: {options}")


class CloseClient:
    def __init__(self, cfg: Config, api_key: str | None = None, http: Http | None = None):
        self.cfg = cfg
        self.ccfg = cfg["close"]
        self.http = http or Http("Close", CLOSE_BASE, auth=(api_key or secret("CLOSE_API_KEY"), ""))
        self._pipeline: dict | None = None
        self._lead_statuses: list[Status] | None = None

    # ---- org / pipeline guard ----------------------------------------------
    def pipeline(self) -> dict:
        if self._pipeline is None:
            pipes = self.http.get("pipeline/")["data"]
            match = [p for p in pipes if p["id"] == self.ccfg["pipeline_id"]]
            if not match:
                names = ", ".join(p.get("name", "?") for p in pipes) or "none"
                raise WrongOrgError(
                    f"The {self.ccfg['pipeline_name']} pipeline ({self.ccfg['pipeline_id']}) is not in the org this "
                    f"CLOSE_API_KEY belongs to (found: {names}). Refusing to do anything. Use a key created in "
                    "the Nassau Street Partners org, never NSP - VP Sales.")
            self._pipeline = match[0]
        return self._pipeline

    def opp_statuses(self) -> list[Status]:
        return [Status(s["id"], s["label"], s.get("type", "active")) for s in self.pipeline().get("statuses", [])]

    def lead_statuses(self) -> list[Status]:
        if self._lead_statuses is None:
            self._lead_statuses = [Status(s["id"], s["label"], "lead") for s in self.http.get("status/lead/")["data"]]
        return self._lead_statuses

    def resolve_stage(self, name: str) -> Status:
        aliases = {norm(k): v for k, v in self.ccfg.get("stage_aliases", {}).items()}
        return pick_status(self.opp_statuses(), name, "M&A stage", aliases)

    # ---- leads -------------------------------------------------------------
    def get_lead(self, lead_id: str) -> dict:
        return self.http.get(f"lead/{lead_id}/")

    def find_lead(self, query: str) -> dict:
        """One lead from a name, a contact name/email, a lead ID or a Close URL."""
        query = query.strip()
        m = LEAD_ID_RE.search(query)
        if m:
            return self.get_lead(m.group(1))
        words = " ".join(re.findall(r"[\w@.+-]+", query))
        if not words:
            raise CloseError("Empty lead name.")
        leads = self.http.get("lead/", params={
            "query": words, "_limit": 50,
            "_fields": "id,display_name,name,status_id,status_label,contacts"}).get("data", [])
        n = norm(query)

        def names(lead: dict) -> list[str]:
            vals = [lead.get("display_name") or lead.get("name") or ""]
            for c in lead.get("contacts", []):
                vals.append(c.get("name") or "")
                vals += [e.get("email", "") for e in c.get("emails", [])]
            return [norm(v) for v in vals if v]

        exact_name = [l for l in leads if norm(l.get("display_name") or l.get("name") or "") == n]
        exact_any = [l for l in leads if n in names(l)]
        partial = [l for l in leads if any(n in v for v in names(l))]
        for group in (exact_name, exact_any, partial):
            if len(group) == 1:
                return group[0]
            if len(group) > 1:
                listing = "; ".join(f"{l.get('display_name')} ({l['id']})" for l in group[:8])
                raise CloseError(f"'{query}' matches {len(group)} leads: {listing}. Use the lead ID instead.")
        raise CloseError(f"No Close lead matches '{query}'.")

    def ma_opportunities(self, lead_id: str) -> list[dict]:
        data = self.http.get("opportunity/", params={"lead_id": lead_id, "_limit": 100}).get("data", [])
        ids = {s.id for s in self.opp_statuses()}
        return [o for o in data if o.get("status_id") in ids]

    def count_with_status(self, status_id: str) -> int:
        resp = self.http.get("opportunity/", params={"status_id": status_id, "_limit": 1, "_fields": "id"})
        if "total_results" in resp:
            return int(resp["total_results"])
        return len(resp.get("data", [])) + (1 if resp.get("has_more") else 0)

    # ---- writes (each re-checks the org guard) -----------------------------
    def put_opportunity(self, opp_id: str, **fields) -> dict:
        self.pipeline()
        return self.http.put(f"opportunity/{opp_id}/", json=fields)

    def delete_opportunity(self, opp_id: str) -> None:
        self.pipeline()
        self.http.delete(f"opportunity/{opp_id}/")

    def put_lead(self, lead_id: str, **fields) -> dict:
        self.pipeline()
        return self.http.put(f"lead/{lead_id}/", json=fields)

    def delete_status(self, status_id: str) -> None:
        self.pipeline()
        self.http.delete(f"status/opportunity/{status_id}/")

    def add_note(self, lead_id: str, text: str) -> dict:
        self.pipeline()
        return self.http.post("activity/note/", json={"lead_id": lead_id, "note": text})


# ---- planned changes ---------------------------------------------------------

@dataclass
class Plan:
    summary: str                          # human readable, before -> after
    apply: Callable[[], Any] = field(repr=False, default=lambda: None)
    noop: bool = False
    lead_id: str = ""
    audit_note: str = ""                  # written to the lead in Close after applying

    def run(self, client: CloseClient) -> None:
        if self.noop:
            return
        self.apply()
        if self.audit_note and self.lead_id:
            client.add_note(self.lead_id, self.audit_note)


def _ma_lead(client: CloseClient, query: str) -> tuple[dict, list[dict]]:
    client.pipeline()  # org guard before any lead is read
    lead = client.find_lead(query)
    opps = client.ma_opportunities(lead["id"])
    return lead, opps


def plan_move(client: CloseClient, lead_query: str, stage: str) -> Plan:
    lead, opps = _ma_lead(client, lead_query)
    target = client.resolve_stage(stage)
    name = lead.get("display_name") or lead.get("name")
    if not opps:
        raise CloseError(f"{name} has no opportunity in {client.ccfg['pipeline_name']}.")
    if len(opps) > 1:
        open_opps = [o for o in opps if o.get("status_type", "active") == "active"]
        if len(open_opps) != 1:
            listing = "; ".join(f"{o['id']} ({o.get('status_label')})" for o in opps)
            raise CloseError(f"{name} has {len(opps)} M&A opportunities ({listing}). Delete the duplicate first.")
        opps = open_opps
    opp = opps[0]
    current = opp.get("status_label") or opp.get("status_id")
    if opp.get("status_id") == target.id:
        return Plan(f"{name}: already at '{target.label}'", noop=True, lead_id=lead["id"])
    return Plan(f"{name}: opportunity {opp['id']} '{current}' -> '{target.label}'",
                lambda: client.put_opportunity(opp["id"], status_id=target.id), lead_id=lead["id"])


def _check_lead_edit(client: CloseClient, lead: dict, opps: list[dict]) -> None:
    if client.ccfg.get("require_ma_opportunity_for_lead_edits", True) and not opps:
        raise CloseError(f"{lead.get('display_name')} has no M&A opportunity, so it is outside the M&A pipeline. "
                         "Refusing to edit it.")


def plan_lead_status(client: CloseClient, lead_query: str, status: str) -> Plan:
    lead, opps = _ma_lead(client, lead_query)
    _check_lead_edit(client, lead, opps)
    target = pick_status(client.lead_statuses(), status, "lead status")
    name = lead.get("display_name") or lead.get("name")
    if lead.get("status_id") == target.id:
        return Plan(f"{name}: lead status already '{target.label}'", noop=True, lead_id=lead["id"])
    return Plan(f"{name}: lead status '{lead.get('status_label')}' -> '{target.label}'",
                lambda: client.put_lead(lead["id"], status_id=target.id), lead_id=lead["id"])


def plan_rename(client: CloseClient, lead_query: str, new_name: str) -> Plan:
    new_name = new_name.strip()
    if not new_name:
        raise CloseError("New name is empty.")
    lead, opps = _ma_lead(client, lead_query)
    _check_lead_edit(client, lead, opps)
    old = lead.get("display_name") or lead.get("name")
    if old == new_name:
        return Plan(f"{old}: already named that", noop=True, lead_id=lead["id"])
    return Plan(f"Rename lead {lead['id']} '{old}' -> '{new_name}'",
                lambda: client.put_lead(lead["id"], name=new_name), lead_id=lead["id"],
                audit_note=f"Close updater: renamed lead from '{old}' to '{new_name}'.")


def plan_delete_opportunity(client: CloseClient, lead_query: str, opp_hint: str = "") -> Plan:
    lead, opps = _ma_lead(client, lead_query)
    name = lead.get("display_name") or lead.get("name")
    m = OPP_ID_RE.search(opp_hint or "")
    if m:
        chosen = [o for o in opps if o["id"] == m.group(1)]
        if not chosen:
            raise CloseError(f"{m.group(1)} is not an M&A opportunity on {name}. Refusing to delete it.")
    elif len(opps) == 1:
        chosen = opps
    elif not opps:
        raise CloseError(f"{name} has no M&A opportunity to delete.")
    else:
        listing = "; ".join(f"{o['id']} ({o.get('status_label')}, created {o.get('date_created', '')[:10]})" for o in opps)
        raise CloseError(f"{name} has {len(opps)} M&A opportunities: {listing}. Put the one to delete in Target.")
    opp = chosen[0]
    if client.ccfg.get("protect_won", True) and opp.get("status_type") == "won":
        raise CloseError(f"{opp['id']} on {name} is won ('{opp.get('status_label')}'). Refusing to delete it.")
    desc = f"{opp['id']} ('{opp.get('status_label')}', created {opp.get('date_created', '')[:10]})"
    return Plan(f"Delete opportunity {desc} on {name}",
                lambda: client.delete_opportunity(opp["id"]), lead_id=lead["id"],
                audit_note=f"Close updater: deleted M&A opportunity {desc}.")


def plan_delete_lost_reason(client: CloseClient, label: str) -> Plan:
    lost = [s for s in client.opp_statuses() if s.type == "lost"]
    target = pick_status(lost, label, "lost reason")
    used = client.count_with_status(target.id)
    if used:
        raise CloseError(f"'{target.label}' is used by {used} opportunities. Move them first.")
    return Plan(f"Delete unused lost reason '{target.label}' ({target.id})",
                lambda: client.delete_status(target.id))


ACTIONS = {
    "move opportunity stage": plan_move,
    "change lead status": plan_lead_status,
    "rename lead": plan_rename,
    "delete opportunity": plan_delete_opportunity,
}
