import json
from datetime import datetime, timedelta, timezone

import responses

from nsp.ai import brief, inbox, intel
from nsp.ai.llm import LLM
from nsp.google import Gmail
from nsp.notion import NotionClient

NOTION = "https://api.notion.com/v1"
GM = "https://gmail.googleapis.com/gmail/v1/users/me"
DS = "ee728d44-9d98-4050-8afc-8b1d827aa059"
ME = "ethan.calvert@nassaustreetpartners.com"
NOW = datetime(2026, 11, 3, 12, tzinfo=timezone.utc)


def t(v):
    return {"type": "rich_text", "rich_text": [{"plain_text": v}]}


def row(pid, name, email, stage, **extra):
    props = {"Lead": {"type": "title", "title": [{"plain_text": name}]}, "Company": t(extra.get("company", "")),
             "Email": {"type": "email", "email": email}, "Stage": {"type": "select", "select": {"name": stage}},
             "Score": {"type": "number", "number": extra.get("score")},
             "Summary": t(extra.get("summary", "")), "Dead?": t(extra.get("dead", "")),
             "Confirm dead": {"type": "checkbox", "checkbox": extra.get("confirm", False)},
             "Draft ready": {"type": "checkbox", "checkbox": extra.get("draft", False)},
             "Sent": {"type": "checkbox", "checkbox": extra.get("sent", False)},
             "Chase date": {"type": "date", "date": None}, "Next step": t("")}
    return {"id": pid, "properties": props, "last_edited_time": "2026-10-30T10:00:00.000Z"}


def msg(frm, days_ago, attach=False, labels=()):
    parts = [{"filename": "NDA signed.pdf"}] if attach else []
    return {"internalDate": str(int((NOW - timedelta(days=days_ago)).timestamp() * 1000)), "snippet": "signed NDA attached",
            "labelIds": list(labels), "payload": {"headers": [{"name": "From", "value": frm},
                                                               {"name": "Subject", "value": "Re: NSP"}], "parts": parts}}


@responses.activate
def test_sweep_plans_labels_dead_suggestions_and_confirmed_dead(cfg):
    responses.post("https://oauth2.googleapis.com/token", json={"access_token": "x", "expires_in": 3600})
    responses.get(f"{GM}/labels", json={"labels": [{"id": f"L{i}", "name": n} for i, n in
                                                   enumerate(cfg["gmail"]["labels"].values())]})
    responses.post(f"{NOTION}/data_sources/{DS}/query", json={"has_more": False, "results": [
        row("p1", "Dana", "dana@h.example", "Qualified", company="Harborline"),
        row("p2", "Ghost", "ghost@g.example", "Call held"),
        row("p3", "Bye", "bye@b.example", "DQ", confirm=True, dead="Too Small: $3M"),
    ]})

    def threads(request):
        q = request.params["q"]
        tid = "t-" + q.split("from:")[1].split()[0].strip("()")
        return (200, {"Content-Type": "application/json"}, json.dumps({"threads": [{"id": tid}]}))
    responses.add_callback(responses.GET, f"{GM}/threads", callback=threads)
    responses.get(f"{GM}/threads/t-dana@h.example", json={"id": "td", "messages": [msg(ME, 5), msg("Dana <dana@h.example>", 1, attach=True)]})
    responses.get(f"{GM}/threads/t-ghost@g.example", json={"id": "tg", "messages": [
        msg("ghost@g.example", 30), msg(ME, 25), msg(ME, 18), msg(ME, 12)]})

    llm = LLM(cfg, dry_run=True, log=lambda *_: None)
    rep = inbox.sweep(cfg, gmail=Gmail(), notion=NotionClient(), llm=llm, me=ME, write=False, now=NOW, log=lambda *_: None)
    acts = "\n".join(rep.actions)
    assert "Dana: thread 'Re: NSP' -> M&A/2 Reply owed" in acts  # stub classifier says "other"
    assert "Dana: ensure deal label 'M&A Deals/Harborline'" in acts
    assert "Ghost: thread 'Re: NSP' -> M&A/3 Waiting on them" in acts
    assert "Bye: label thread" in acts and "Bye: Call Log Stage -> Dead" in acts
    assert rep.suggestions == ["Ghost: suggest dead (no reply after two nudges)"]
    assert all(c.request.method == "GET" or "query" in c.request.url or "token" in c.request.url
               for c in responses.calls), "plan mode writes nothing"


@responses.activate
def test_brief_and_intel_dry_run(cfg):
    responses.post(f"{NOTION}/data_sources/{DS}/query", json={"has_more": False, "results": [
        row("p1", "Dana", "dana@h.example", "Qualified", company="Harborline", score=8, draft=True),
        row("p2", "Old", "o@o.example", "Dead")]})
    logs = []
    llm = LLM(cfg, dry_run=True, log=logs.append)
    text = brief.run(cfg, llm, notion=NotionClient(), calendly=None, write=False, log=logs.append)
    assert "Draft ready but not sent for 24h+: Dana" in text
    intel.run(cfg, llm, notion=NotionClient(), write=False, log=logs.append)
    assert any("[dry-run:intel:Harborline]" in l and "searches<=5" in l for l in logs)
    blocks = brief.text_to_blocks("## A\n- b\nc")
    assert [b["type"] for b in blocks] == ["heading_3", "bulleted_list_item", "paragraph"]
