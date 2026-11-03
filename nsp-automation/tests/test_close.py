import json

import pytest
import responses
from responses import matchers

from nsp.cli import main
from nsp.close import CloseClient, CloseError, WrongOrgError, plan_from_sentence

from .conftest import pipelines_payload

API = "https://api.close.com/api/v1"

HARRISON = {"id": "lead_h", "display_name": "Harrison Plumbing", "status_label": "M&A Prospect",
            "contacts": [{"id": "cont_h", "name": "Tom Harrison", "emails": [{"email": "tom@harrison.example"}]}]}
OTHER = {"id": "lead_o", "display_name": "Acme", "contacts": [{"id": "c2", "name": "Jane Roe", "emails": []}]}


def _pipes(rsps, include_ma=True):
    rsps.get(f"{API}/pipeline/", json=pipelines_payload(include_ma))


@responses.activate
def test_move_lead_to_stage_by_alias(cfg):
    _pipes(responses)
    responses.get(f"{API}/lead/", json={"data": [HARRISON, OTHER]})
    responses.get(f"{API}/opportunity/", match=[matchers.query_param_matcher({"lead_id": "lead_h", "_limit": "100"})],
                  json={"data": [{"id": "oppo_1", "status_id": "stat_booked", "status_label": "Call Booked",
                                  "status_type": "active"}]})
    put = responses.put(f"{API}/opportunity/oppo_1/", json={"id": "oppo_1"})
    assert main(["close", "move Harrison to qualified", "--yes"]) == 0
    assert json.loads(put.calls[0].request.body) == {"status_id": "stat_qual"}


@responses.activate
def test_wrong_org_is_refused_before_any_write(cfg):
    _pipes(responses, include_ma=False)
    client = CloseClient(cfg)
    with pytest.raises(WrongOrgError):
        client.set_opportunity_status("oppo_1", "stat_qual")
    assert all(c.request.method == "GET" for c in responses.calls)


@responses.activate
def test_ambiguous_lead_lists_matches(cfg):
    _pipes(responses)
    twin = dict(HARRISON, id="lead_h2", display_name="Harrison Electric")
    responses.get(f"{API}/lead/", json={"data": [HARRISON, twin]})
    with pytest.raises(CloseError, match="matches 2 leads"):
        plan_from_sentence(CloseClient(cfg), "move Harrison to held")


@responses.activate
def test_lead_status_rename_and_unknown_stage(cfg):
    _pipes(responses)
    responses.get(f"{API}/lead/", json={"data": [HARRISON]})
    responses.get(f"{API}/status/lead/", json={"data": [{"id": "stat_int", "label": "Interested"},
                                                         {"id": "stat_q", "label": "Qualified"}]})
    put = responses.put(f"{API}/lead/lead_h/", json={})
    c = CloseClient(cfg)
    plan_from_sentence(c, "mark Harrison as interested").apply()
    plan_from_sentence(c, "rename Harrison to Harrison Plumbing LLC").apply()
    assert [json.loads(x.request.body) for x in put.calls] == [{"status_id": "stat_int"},
                                                               {"name": "Harrison Plumbing LLC"}]
    responses.get(f"{API}/opportunity/", json={"data": [{"id": "o", "status_id": "stat_booked", "status_type": "active"}]})
    with pytest.raises(CloseError, match="Unknown M&A pipeline stage"):
        plan_from_sentence(c, "move Harrison to banana")


@responses.activate
def test_delete_lost_reason_only_when_unused(cfg):
    _pipes(responses)
    responses.get(f"{API}/opportunity/", match=[matchers.query_param_matcher(
        {"status_id": "stat_dup", "_limit": "1", "_fields": "id"})], json={"data": [], "total_results": 0})
    responses.get(f"{API}/opportunity/", match=[matchers.query_param_matcher(
        {"status_id": "stat_small", "_limit": "1", "_fields": "id"})], json={"data": [{"id": "o"}], "total_results": 7})
    delete = responses.delete(f"{API}/status/opportunity/stat_dup/")
    c = CloseClient(cfg)
    plan_from_sentence(c, "delete lost reason Duplicate").apply()
    assert len(delete.calls) == 1
    with pytest.raises(CloseError, match="used by 7"):
        plan_from_sentence(c, "delete lost reason Too Small")
    with pytest.raises(CloseError, match="not a lost reason"):
        plan_from_sentence(c, "delete stage Call Booked")


@responses.activate
def test_dry_run_and_already_there(cfg, capsys):
    _pipes(responses)
    responses.get(f"{API}/lead/", json={"data": [HARRISON]})
    responses.get(f"{API}/opportunity/", json={"data": [{"id": "oppo_1", "status_id": "stat_qual",
                                                         "status_label": "Qualified (Materials Requested)"}]})
    assert main(["close", "move", "Harrison", "to", "Qualified", "--yes"]) == 0
    assert "already at" in capsys.readouterr().out
    assert not [c for c in responses.calls if c.request.method != "GET"]
