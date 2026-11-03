import json
from datetime import datetime, timezone

import responses

from nsp.booking_sync import BookingSync
from nsp.calendly import CalendlyClient
from nsp.close import CloseClient
from nsp.notion import NotionClient
from nsp.state import State

from .conftest import pipelines_payload

CAL = "https://api.calendly.com"
CLOSE = "https://api.close.com/api/v1"
NOTION = "https://api.notion.com/v1"
DS = "ee728d44-9d98-4050-8afc-8b1d827aa059"
NOW = datetime(2026, 11, 3, 12, 0, tzinfo=timezone.utc)


def event(uuid, name, start="2026-11-04T15:00:00Z", end="2026-11-04T15:30:00Z"):
    return {"uri": f"{CAL}/scheduled_events/{uuid}", "name": name, "start_time": start, "end_time": end,
            "status": "active"}


def invitee(uuid, name, email, intent, revenue="$5M to $20M"):
    return {"uri": f"{CAL}/scheduled_events/{uuid}/invitees/inv-{uuid}", "name": name, "email": email,
            "status": "active", "questions_and_answers": [
                {"question": "Phone Number", "answer": "+1 555 0100", "position": 0},
                {"question": "Brief company description", "answer": "Cold-chain logistics", "position": 1},
                {"question": "What are you looking to do?", "answer": intent, "position": 2},
                {"question": "What is your approximate annual revenue?", "answer": revenue, "position": 3}]}


def setup_calendly(rsps):
    rsps.get(f"{CAL}/scheduled_events", json={"collection": [
        event("e1", "M&A Advisory Meeting"),
        event("e2", "M&A Advisory Meeting (S)"),
        event("e3", "Capital Advisory Call (SDR)", end="2026-11-04T15:10:00Z"),
        event("e4", "M&A Advisory Meeting"),
    ], "pagination": {"next_page_token": None}})
    rsps.get(f"{CAL}/scheduled_events/e1/invitees", json={"collection": [
        invitee("e1", "Dana Whitfield", "Dana@HarborLine.example", "Sell all or most of the business")]})
    rsps.get(f"{CAL}/scheduled_events/e2/invitees", json={"collection": [
        invitee("e2", "Rick Raise", "rick@raise.example", "Raise capital, not sell")]})
    rsps.get(f"{CAL}/scheduled_events/e4/invitees", json={"collection": [
        invitee("e4", "Old Friend", "old@known.example", "Just exploring options")]})


def setup_close(rsps):
    rsps.get(f"{CLOSE}/pipeline/", json=pipelines_payload())
    # No lead for Dana; an existing lead with an open M&A opportunity for old@known.example
    rsps.get(f"{CLOSE}/lead/", match=[responses.matchers.query_param_matcher(
        {"query": "dana@harborline.example", "_limit": "10",
         "_fields": "id,display_name,name,status_id,status_label,contacts,url"})], json={"data": []})
    rsps.get(f"{CLOSE}/lead/", match=[responses.matchers.query_param_matcher(
        {"query": "old@known.example", "_limit": "10",
         "_fields": "id,display_name,name,status_id,status_label,contacts,url"})],
        json={"data": [{"id": "lead_old", "display_name": "Known", "contacts": [
            {"id": "c_old", "emails": [{"email": "old@known.example"}]}]}]})
    rsps.get(f"{CLOSE}/opportunity/", match=[responses.matchers.query_param_matcher(
        {"lead_id": "lead_old", "_limit": "100"})],
        json={"data": [{"id": "oppo_old", "status_id": "stat_booked", "status_type": "active"}]})
    lead = rsps.post(f"{CLOSE}/lead/", json={"id": "lead_new", "contacts": [
        {"id": "cont_new", "emails": [{"email": "dana@harborline.example"}]}]})
    opp = rsps.post(f"{CLOSE}/opportunity/", json={"id": "oppo_new"})
    note = rsps.post(f"{CLOSE}/activity/note/", json={"id": "acti_1"})
    return lead, opp, note


@responses.activate
def test_sync_creates_close_records_and_call_log_row_once(cfg, tmp_path):
    setup_calendly(responses)
    lead, opp, note = setup_close(responses)
    responses.post(f"{NOTION}/data_sources/{DS}/query", json={"results": [], "has_more": False})
    page = responses.post(f"{NOTION}/pages", json={"id": "page_1"})

    state = State("bookings", tmp_path)
    sync = BookingSync(cfg, CalendlyClient(), CloseClient(cfg), NotionClient(), state=state, log=lambda *_: None)
    res = sync.run(now=NOW)

    assert not res.errors
    # Only Dana is created: Rick is a capital raise, e3 is not M&A, old@ already has an open opportunity.
    body = json.loads(lead.calls[0].request.body)
    assert body["name"] == "Harborline"
    assert body["status_id"] == cfg["close"]["new_lead_status_id"]
    assert body["contacts"][0]["emails"][0]["email"] == "dana@harborline.example"
    assert body["contacts"][0]["phones"][0]["phone"] == "+1 555 0100"
    o = json.loads(opp.calls[0].request.body)
    assert o["status_id"] == cfg["close"]["call_booked_status_id"] and o["contact_id"] == "cont_new"
    n = json.loads(note.calls[0].request.body)["note"]
    assert "Sell all or most of the business" in n and "Wed 04 Nov 2026 15:00 WET" in n
    props = json.loads(page.calls[0].request.body)["properties"]
    assert props["Stage"] == {"select": {"name": "Booked"}}
    assert props["Email"] == {"email": "dana@harborline.example"}
    assert len(page.calls) == 2  # Dana + the existing Close lead that had no Call Log row
    reasons = dict(res.skipped)
    assert "Raise capital" in reasons["rick@raise.example"]
    assert "open M&A opportunity" in reasons["old@known.example"]

    # Second run: nothing new is written (state cache).
    before = len(responses.calls)
    res2 = BookingSync(cfg, CalendlyClient(), CloseClient(cfg), NotionClient(), state=State("bookings", tmp_path),
                       log=lambda *_: None).run(now=NOW)
    writes = [c for c in responses.calls[before:] if c.request.method in ("POST", "PUT") and "query" not in c.request.url]
    assert not writes and not res2.created


@responses.activate
def test_dry_run_touches_only_calendly(cfg, tmp_path):
    setup_calendly(responses)
    res = BookingSync(cfg, CalendlyClient(), None, None, state=State("b", tmp_path), dry_run=True,
                      log=lambda *_: None).run(now=NOW)
    assert any("Harborline" in p for p in res.planned)
    assert all(c.request.url.startswith(CAL) for c in responses.calls)
    assert not (tmp_path / "b.json").exists()
