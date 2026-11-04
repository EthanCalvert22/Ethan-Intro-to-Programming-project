import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from nsp.config import load_config  # noqa: E402

CLOSE = "https://api.close.com/api/v1"
NOTION = "https://api.notion.com/v1"
PIPE_ID = "pipe_0Lvn5aQMMILogzbRSrQWHB"
DS = "cb971d35-aeb8-4182-82cd-642ce0c47fbd"

# Labels exactly as they are in Close (read on 2026-11-04).
STATUSES = [
    ("stat_booked", "Call Booked", "active"),
    ("stat_held", "Screening Call Held", "active"),
    ("stat_qual", "Qualified, Materials Requested", "active"),
    ("stat_dil", "Soft Diligence", "active"),
    ("stat_senior", "Senior Team Call", "active"),
    ("stat_fee", "Fee and Engagement Review", "active"),
    ("stat_sent", "Engagement Sent", "active"),
    ("stat_dial", "No Show: Dial Back", "active"),
    ("stat_won", "Engagement Signed", "won"),
    ("stat_nf", "Lost: Not a Fit", "lost"),
    ("stat_afford", "Lost: Can't Afford Work Fee", "lost"),
    ("stat_small", "Lost: Too Small", "lost"),
    ("stat_nsnr", "Lost: Not Selling / Not Ready", "lost"),
    ("stat_noshow", "Lost: No Show", "lost"),
]
LEAD_STATUSES = [("stat_bad", "Bad Fit"), ("stat_map", "M&A Prospect"), ("stat_int", "Interested")]


@pytest.fixture(autouse=True)
def env(monkeypatch):
    monkeypatch.setenv("CLOSE_API_KEY", "test-close-key")
    monkeypatch.setenv("NOTION_TOKEN", "test-notion-token")
    monkeypatch.delenv("NSP_DRY_RUN", raising=False)


@pytest.fixture
def cfg():
    return load_config(ROOT / "config.toml")


def pipelines(include_ma=True):
    pipes = [{"id": "pipe_sdr", "name": "SDR Meetings", "statuses": [
        {"id": "stat_sdr", "label": "SDR Meeting Booked", "type": "active"}]}]
    if include_ma:
        pipes.append({"id": PIPE_ID, "name": "M&A Opportunities",
                      "statuses": [{"id": i, "label": l, "type": t} for i, l, t in STATUSES]})
    return {"data": pipes}


def lead(lid, name, status="M&A Prospect", status_id="stat_map", contacts=()):
    return {"id": lid, "display_name": name, "name": name, "status_label": status, "status_id": status_id,
            "contacts": list(contacts)}


def opp(oid, status_id, created="2026-10-09T22:43:19Z"):
    label, typ = next((l, t) for i, l, t in STATUSES if i == status_id) if status_id.startswith("stat_") and \
        any(i == status_id for i, _, _ in STATUSES) else ("SDR Meeting Booked", "active")
    return {"id": oid, "status_id": status_id, "status_label": label, "status_type": typ, "date_created": created}


class FakeClose:
    """Registers a small fake Close org on a `responses` mock."""

    def __init__(self, rsps, leads, opps_by_lead, include_ma=True, status_counts=None):
        from responses import matchers
        rsps.get(f"{CLOSE}/pipeline/", json=pipelines(include_ma))
        rsps.get(f"{CLOSE}/status/lead/", json={"data": [{"id": i, "label": l} for i, l in LEAD_STATUSES]})
        rsps.add_callback("GET", f"{CLOSE}/lead/", callback=self._search, content_type="application/json")
        for l in leads:
            rsps.get(f"{CLOSE}/lead/{l['id']}/", json=l)
            rsps.get(f"{CLOSE}/opportunity/", match=[matchers.query_param_matcher(
                {"lead_id": l["id"], "_limit": "100"})], json={"data": opps_by_lead.get(l["id"], [])})
        for sid, n in (status_counts or {}).items():
            rsps.get(f"{CLOSE}/opportunity/", match=[matchers.query_param_matcher(
                {"status_id": sid, "_limit": "1", "_fields": "id"})], json={"data": [], "total_results": n})
        self.leads = leads
        self.put_opp = rsps.put(__import__("re").compile(f"{CLOSE}/opportunity/oppo_\\w+/"), json={})
        self.put_lead = rsps.put(__import__("re").compile(f"{CLOSE}/lead/lead_\\w+/"), json={})
        self.del_opp = rsps.delete(__import__("re").compile(f"{CLOSE}/opportunity/oppo_\\w+/"))
        self.del_status = rsps.delete(__import__("re").compile(f"{CLOSE}/status/opportunity/stat_\\w+/"))
        self.note = rsps.post(f"{CLOSE}/activity/note/", json={"id": "acti_1"})

    def _search(self, request):
        import json
        q = request.params.get("query", "").lower().split()
        hits = [l for l in self.leads if all(w in (l["display_name"] + " " + " ".join(
            c.get("name", "") for c in l["contacts"])).lower() for w in q)]
        return (200, {}, json.dumps({"data": hits}))

    def writes(self):
        return [c for m in (self.put_opp, self.put_lead, self.del_opp, self.del_status) for c in m.calls]
