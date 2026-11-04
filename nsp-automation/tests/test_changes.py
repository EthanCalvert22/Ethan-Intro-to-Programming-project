import json

import responses

from nsp.changes import process_queue
from nsp.cli import main
from nsp.close import CloseClient
from nsp.notion import NotionClient

from .conftest import DS, NOTION, FakeClose, lead, opp


def row(pid, change, action, lead_name, target=""):
    t = lambda v: {"type": "rich_text", "rich_text": [{"plain_text": v}] if v else []}
    return {"id": pid, "properties": {
        "Change": {"type": "title", "title": [{"plain_text": change}]},
        "Action": {"type": "select", "select": {"name": action} if action else None},
        "Lead": t(lead_name), "Target": t(target)}}


ROWS = [
    row("r1", "Harrison back to prospect", "Change lead status", "Harrison Akhavan", "M&A Prospect"),
    row("r2", "Fix Jonathan's name", "Rename lead", "Jonathan (Alpha Fleet)", "Jonathan Wilcox"),
    row("r3", "Move Harrison", "Move opportunity stage", "Harrison Akhavan", "Senior Team Call"),
    row("r4", "Typo stage", "Move opportunity stage", "Harrison Akhavan", "Seniour Tem"),
    row("r5", "No action", "", "Harrison Akhavan", "x"),
]


def setup(rsps):
    leads = [lead("lead_har", "Harrison Akhavan", "Bad Fit", "stat_bad"), lead("lead_jon", "Jonathan (Alpha Fleet)")]
    fc = FakeClose(rsps, leads, {"lead_har": [opp("oppo_har", "stat_qual")], "lead_jon": [opp("oppo_jon", "stat_booked")]})
    q = rsps.post(f"{NOTION}/data_sources/{DS}/query", json={"results": ROWS, "has_more": False})
    upd = rsps.patch(__import__("re").compile(f"{NOTION}/pages/r\\d"), json={})
    return fc, q, upd


def updates(upd):
    return {c.request.url.rsplit("/", 1)[-1]: json.loads(c.request.body)["properties"] for c in upd.calls}


def text(prop):
    return "".join(r["text"]["content"] for r in prop["rich_text"])


def test_dry_run_previews_into_notion_and_changes_nothing_in_close(cfg):
    with responses.RequestsMock(assert_all_requests_are_fired=False) as rsps:
        fc, q, upd = setup(rsps)
        rep = process_queue(cfg, CloseClient(cfg), NotionClient(), dry_run=True, log=lambda *_: None)
        assert not fc.writes() and not fc.note.calls
        u = updates(upd)
        assert text(u["r1"]["Result"]) == "DRY RUN: would Harrison Akhavan: lead status 'Bad Fit' -> 'M&A Prospect'"
        assert text(u["r2"]["Result"]).endswith("'Jonathan (Alpha Fleet)' -> 'Jonathan Wilcox'")
        assert "Done" not in u["r1"]
        assert "Unknown M&A stage" in text(u["r4"]["Error"]) and "Unknown or missing Action" in text(u["r5"]["Error"])
        assert len(rep.previewed) == 3 and len(rep.failed) == 2
        body = json.loads(q.calls[0].request.body)
        assert body["filter"]["and"][0] == {"property": "Done", "checkbox": {"equals": False}}
        assert body["sorts"] == [{"timestamp": "created_time", "direction": "ascending"}]


def test_live_run_applies_ticks_done_and_logs(cfg):
    with responses.RequestsMock(assert_all_requests_are_fired=False) as rsps:
        fc, q, upd = setup(rsps)
        logs = []
        rep = process_queue(cfg, CloseClient(cfg), NotionClient(), dry_run=False, log=logs.append)
        assert [json.loads(c.request.body) for c in fc.put_lead.calls] == [{"status_id": "stat_map"},
                                                                          {"name": "Jonathan Wilcox"}]
        assert json.loads(fc.put_opp.calls[0].request.body) == {"status_id": "stat_senior"}
        u = updates(upd)
        for r in ("r1", "r2", "r3"):
            assert u[r]["Done"] == {"checkbox": True} and u[r]["Applied"]["date"]["start"]
        assert "Done" not in u["r4"] and text(u["r4"]["Error"])
        assert len(rep.applied) == 3 and any(l.startswith("APPLIED") for l in logs)


def test_run_limit_and_env_dry_run(cfg, monkeypatch, capsys):
    with responses.RequestsMock(assert_all_requests_are_fired=False) as rsps:
        fc, q, upd = setup(rsps)
        monkeypatch.setenv("NSP_DRY_RUN", "1")
        data = json.loads(json.dumps(cfg.data))
        data["close"]["max_changes_per_run"] = 2
        from nsp.config import Config
        rep = process_queue(Config(data), CloseClient(Config(data)), NotionClient(), dry_run=True, log=lambda *_: None)
        assert rep.skipped == 3 and len(rep.previewed) == 2
        assert main(["run"]) == 1  # env forces dry run; rows 4 and 5 fail -> exit 1
        assert "DRY RUN." in capsys.readouterr().out and not fc.writes()


def test_wrong_org_reads_no_rows(cfg):
    import pytest
    from nsp.close import WrongOrgError
    with responses.RequestsMock(assert_all_requests_are_fired=False) as rsps:
        FakeClose(rsps, [], {}, include_ma=False)
        q = rsps.post(f"{NOTION}/data_sources/{DS}/query", json={"results": ROWS, "has_more": False})
        with pytest.raises(WrongOrgError):
            process_queue(cfg, CloseClient(cfg), NotionClient(), dry_run=False)
        assert not q.calls
