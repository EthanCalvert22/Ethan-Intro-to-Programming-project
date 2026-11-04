import json

import pytest
import responses

from nsp.cli import main
from nsp.close import (CloseClient, CloseError, WrongOrgError, plan_delete_lost_reason,
                       plan_delete_opportunity, plan_lead_status, plan_move, plan_rename)

from .conftest import FakeClose, lead, opp

HARRISON = lead("lead_har", "Harrison Akhavan", "Bad Fit", "stat_bad")
JONATHAN = lead("lead_jon", "Jonathan (Alpha Fleet)")
YAQI_PG = lead("lead_ypg", "Yaqi Wang", contacts=[{"name": "Yaqi Wang", "emails": []}])
YAQI_RS = lead("lead_yrs", "Yaqi Wang", "Info Sent", "stat_x")
SDR_ONLY = lead("lead_sdr", "Rosie Cruz")
TWINS = lead("lead_dup", "Dup Co")
OPPS = {"lead_har": [opp("oppo_har", "stat_qual")], "lead_jon": [opp("oppo_jon", "stat_booked")],
        "lead_ypg": [opp("oppo_ypg", "stat_qual")], "lead_yrs": [opp("oppo_yrs", "stat_fee")],
        "lead_sdr": [opp("oppo_sdr", "stat_sdr")],
        "lead_dup": [opp("oppo_d1", "stat_booked", "2026-10-01"), opp("oppo_d2", "stat_booked", "2026-10-02")]}
ALL = [HARRISON, JONATHAN, YAQI_PG, YAQI_RS, SDR_ONLY, TWINS]


@pytest.fixture
def fc():
    with responses.RequestsMock(assert_all_requests_are_fired=False) as rsps:
        yield FakeClose(rsps, ALL, OPPS, status_counts={"stat_nsnr": 0, "stat_noshow": 0, "stat_small": 5})


def test_move_with_real_labels_and_short_names(cfg, fc):
    c = CloseClient(cfg)
    for name in ("Senior", "senior team call", "Senior Team Call"):
        assert "'Qualified, Materials Requested' -> 'Senior Team Call'" in plan_move(c, "Harrison Akhavan", name).summary
    p = plan_move(c, "Harrison Akhavan", "Qualified (Materials Requested)")
    assert p.noop
    plan_move(c, "harrison", "No show").run(c)
    assert json.loads(fc.put_opp.calls[-1].request.body) == {"status_id": "stat_dial"}
    plan_move(c, "Harrison Akhavan", "Too Small").run(c)
    assert json.loads(fc.put_opp.calls[-1].request.body) == {"status_id": "stat_small"}


def test_unknown_stage_lists_options(cfg, fc):
    with pytest.raises(CloseError, match="Options: Call Booked; Screening Call Held"):
        plan_move(CloseClient(cfg), "Harrison Akhavan", "Banana")


def test_sdr_pipeline_is_never_touched(cfg, fc):
    c = CloseClient(cfg)
    with pytest.raises(CloseError, match="no opportunity in M&A Opportunities"):
        plan_move(c, "Rosie Cruz", "Qualified")
    with pytest.raises(CloseError, match="outside the M&A pipeline"):
        plan_rename(c, "Rosie Cruz", "New")
    with pytest.raises(CloseError, match="not an M&A opportunity"):
        plan_delete_opportunity(c, "Rosie Cruz", "oppo_sdr")
    assert not fc.writes()


def test_wrong_org_refused(cfg):
    with responses.RequestsMock(assert_all_requests_are_fired=False) as rsps:
        fc = FakeClose(rsps, ALL, OPPS, include_ma=False)
        with pytest.raises(WrongOrgError, match="never NSP - VP Sales"):
            plan_move(CloseClient(cfg), "Harrison Akhavan", "Qualified")
        assert len(rsps.calls) == 1 and not fc.writes()  # stopped after reading the pipeline list


def test_cleanup_status_and_rename(cfg, fc):
    c = CloseClient(cfg)
    p = plan_lead_status(c, "Harrison Akhavan", "M&A Prospect")
    assert p.summary == "Harrison Akhavan: lead status 'Bad Fit' -> 'M&A Prospect'"
    p.run(c)
    p = plan_rename(c, "Jonathan (Alpha Fleet)", "Jonathan Wilcox")
    p.run(c)
    bodies = [json.loads(x.request.body) for x in fc.put_lead.calls]
    assert bodies == [{"status_id": "stat_map"}, {"name": "Jonathan Wilcox"}]
    assert "renamed lead from 'Jonathan (Alpha Fleet)' to 'Jonathan Wilcox'" in json.loads(fc.note.calls[-1].request.body)["note"]


def test_delete_opportunity_safety(cfg, fc):
    c = CloseClient(cfg)
    with pytest.raises(CloseError, match="matches 2 leads"):  # two Yaqi Wang leads: ambiguous by name
        plan_delete_opportunity(c, "Yaqi Wang")
    p = plan_delete_opportunity(c, "lead_ypg")
    assert "oppo_ypg" in p.summary
    with pytest.raises(CloseError, match="has 2 M&A opportunities"):
        plan_delete_opportunity(c, "Dup Co")
    plan_delete_opportunity(c, "Dup Co", "oppo_d2").run(c)
    assert fc.del_opp.calls[-1].request.url.endswith("/opportunity/oppo_d2/")
    assert "deleted M&A opportunity oppo_d2" in json.loads(fc.note.calls[-1].request.body)["note"]


def test_won_opportunity_is_protected(cfg):
    with responses.RequestsMock(assert_all_requests_are_fired=False) as rsps:
        won = lead("lead_w", "Winner Co")
        fc = FakeClose(rsps, [won], {"lead_w": [opp("oppo_w", "stat_won")]})
        with pytest.raises(CloseError, match="won"):
            plan_delete_opportunity(CloseClient(cfg), "Winner Co")
        assert not fc.writes()


def test_delete_lost_reasons(cfg, fc):
    c = CloseClient(cfg)
    plan_delete_lost_reason(c, "Not Selling / Not Ready").run(c)
    plan_delete_lost_reason(c, "No Show").run(c)  # the lost one, never "No Show: Dial Back"
    urls = [x.request.url for x in fc.del_status.calls]
    assert urls[0].endswith("/stat_nsnr/") and urls[1].endswith("/stat_noshow/")
    with pytest.raises(CloseError, match="used by 5"):
        plan_delete_lost_reason(c, "Too Small")
    with pytest.raises(CloseError, match="Unknown lost reason"):
        plan_delete_lost_reason(c, "Call Booked")


def test_cli_move_quick_command(cfg, fc, capsys):
    assert main(["move", "Harrison Akhavan", "Senior", "--dry-run"]) == 0
    assert "Dry run" in capsys.readouterr().out and not fc.writes()
    assert main(["move", "Harrison Akhavan", "Senior", "--yes"]) == 0
    assert json.loads(fc.put_opp.calls[-1].request.body) == {"status_id": "stat_senior"}
    assert main(["move", "Nobody Here", "Senior", "--yes"]) == 2
