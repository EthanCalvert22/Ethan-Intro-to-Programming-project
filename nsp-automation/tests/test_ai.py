import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import pytest

from nsp.ai import followup
from nsp.ai.llm import LLM, BudgetExceeded, CostLog, ModelRefused, Usage
from nsp.cli import main
from nsp.fireflies import load_transcript_file

SAMPLE = Path(__file__).parent / "fixtures" / "sample_transcript.txt"

GOOD = {
    "lead_name": "Dana Whitfield", "first_name": "Dana", "company": "Harborline Logistics",
    "verdict": "strong", "score": 8,
    "summary": "3PL, cold chain, Savannah GA.\n$38M revenue, $5.1M EBITDA.\nSelling within 12 months.",
    "facts": {"revenue": "$38M", "profit": "$5.1M EBITDA", "asking_price": "not stated", "ownership": "50/50 siblings",
              "timeline": "12 months", "sector": "cold-chain logistics", "location": "Savannah, GA"},
    "buyer_concern": "31% customer concentration", "close_note": "Strong fit.",
    "next_step": "Signed NDA and financials", "chase_in_days": 4, "dead_reason": "", "attach_nda": True,
    "email_subject": "Nassau Street Partners | Following up on today's call",
    "email_body": "Hi Dana,\n\nThank you for your time today — very helpful.\n\nBest regards,\nEthan\n",
}


def test_transcript_file_loader():
    t = load_transcript_file(SAMPLE)
    assert t.external_emails() == ["dana@harborlinelogistics.example"]
    assert t.text.startswith("[00:01 - 00:03] Ethan Calvert") and t.has_content


def test_dry_run_followup_needs_no_key_and_writes_nothing(cfg, tmp_path, capsys):
    assert main(["followup", "--transcript-file", str(SAMPLE), "--dry-run"]) == 0
    out = capsys.readouterr().out
    assert "[dry-run:followup] claude-opus-5-5" in out and "Would do (nothing written)" in out
    saved = sorted((tmp_path / "logs" / "dry-run").glob("*-followup.json"))
    req = json.loads(saved[-1].read_text())
    assert req["model"] == "claude-opus-5-5"
    assert req["system"][-1]["cache_control"] == {"type": "ephemeral"}
    assert req["output_config"]["effort"] == "medium"
    assert req["output_config"]["format"]["schema"]["properties"]["verdict"]["enum"][0] == "strong"
    assert "Harborline" in req["messages"][0]["content"]
    assert "ANTHROPIC" not in json.dumps(req)  # no credentials in saved requests
    assert not (tmp_path / "logs" / "cost.jsonl").exists()  # estimates are not logged as spend


def test_live_mode_refuses_without_key(cfg):
    with pytest.raises(RuntimeError, match="ANTHROPIC_API_KEY is not set"):
        LLM(cfg, dry_run=False)
    assert main(["ai-selftest"]) == 1


def test_guard_rails_on_model_output():
    d = json.loads(json.dumps(GOOD))
    d["email_body"] += "Work fee is $150K and success fee 10%. [Name]"
    d["verdict"], d["attach_nda"], d["score"] = "too_small", True, 14
    w = followup.check_output(d)
    assert "—" not in d["email_body"]
    assert d["attach_nda"] is False and d["score"] == 10
    assert any("$150K" in x for x in w) and any("10%" in x for x in w) and any("bracket" in x for x in w)


def test_apply_plan_never_auto_applies_lost_stage(cfg):
    t = load_transcript_file(SAMPLE)
    d = json.loads(json.dumps(GOOD))
    d["verdict"], d["dead_reason"] = "too_small", "Sale value about $5M"
    plan = followup.apply(cfg, followup.Assessment(d, t), write=False)
    text = " ".join(plan.steps)
    assert "PROPOSE lost stage 'Too Small'" in text and "move opportunity forward" not in text
    assert "Stage=DQ" in text


# ---- live path with the real SDK against a local fake API -------------------

class FakeAnthropic(BaseHTTPRequestHandler):
    requests: list = []
    reply: dict = {}

    def do_POST(self):  # noqa: N802
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        FakeAnthropic.requests.append({"path": self.path, "headers": {k.lower(): v for k, v in self.headers.items()}, "body": body})
        payload = json.dumps(FakeAnthropic.reply).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("request-id", "req_test")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *a):
        pass


@pytest.fixture
def fake_api(monkeypatch):
    srv = HTTPServer(("127.0.0.1", 0), FakeAnthropic)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    monkeypatch.setenv("NSP_ANTHROPIC_BASE_URL", f"http://127.0.0.1:{srv.server_port}")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test-not-real")
    FakeAnthropic.requests = []
    yield FakeAnthropic
    srv.shutdown()


def message(text, stop="end_turn", model="claude-opus-5-5"):
    return {"id": "msg_1", "type": "message", "role": "assistant", "model": model, "stop_reason": stop,
            "stop_sequence": None, "content": [{"type": "text", "text": text}],
            "usage": {"input_tokens": 9000, "output_tokens": 2000, "cache_creation_input_tokens": 0,
                      "cache_read_input_tokens": 1600}}


def test_live_followup_through_real_sdk(cfg, fake_api, tmp_path):
    fake_api.reply = message(json.dumps(GOOD))
    llm = LLM(cfg, log=lambda *_: None)
    a = followup.assess(llm, load_transcript_file(SAMPLE))
    sent = fake_api.requests[0]
    assert sent["path"].startswith("/v1/messages")
    h = sent["headers"]
    assert "sk-ant-test-not-real" in (h.get("x-api-key", "") + h.get("authorization", ""))
    assert "server-side-fallback-2026-07-01" in sent["headers"].get("anthropic-beta", "")
    assert sent["body"]["fallbacks"] == "default"
    assert sent["body"]["output_config"]["format"]["type"] == "json_schema"
    assert "temperature" not in sent["body"]
    assert a.data["email_body"] == "Hi Dana,\n\nThank you for your time today, very helpful.\n\nBest regards,\nEthan\n"
    rec = json.loads((tmp_path / "logs" / "cost.jsonl").read_text().splitlines()[-1])
    # 9000*4 + 2000*20 + 1600*0.2 per million
    assert rec["usd"] == pytest.approx(0.07632) and rec["model"] == "claude-opus-5-5"


def test_fast_model_has_no_fallback_and_refusals_raise(cfg, fake_api):
    fake_api.reply = message('{"kind": "nda_signed"}', model="claude-haiku-5-5")
    llm = LLM(cfg, log=lambda *_: None)
    p = llm.build(tier="fast", system=[{"type": "text", "text": "x"}], user="y", max_tokens=100,
                  schema={"type": "object", "properties": {"kind": {"type": "string"}}, "required": ["kind"],
                          "additionalProperties": False})
    out, _ = llm.call("t", p)
    assert out == {"kind": "nda_signed"}
    body = fake_api.requests[-1]["body"]
    assert body["model"] == "claude-haiku-5-5" and "fallbacks" not in body
    assert body["output_config"]["effort"] == "low"
    fake_api.reply = message("", stop="refusal")
    with pytest.raises(ModelRefused):
        llm.call("t", p)


def test_budget_guard_blocks_calls(cfg, fake_api, tmp_path):
    log = CostLog(cfg)
    log.record("old", Usage(model="claude-opus-5-5", input_tokens=20_000_000))  # $80
    llm = LLM(cfg, log=lambda *_: None)
    with pytest.raises(BudgetExceeded):
        llm.call("x", llm.build(tier="strong", system=[{"type": "text", "text": "x"}], user="y"))
    assert not fake_api.requests


def test_selftest_passes_end_to_end_with_working_api(cfg, fake_api, capsys):
    replies = [message(json.dumps(GOOD)), message('{"kind": "nda_signed"}', model="claude-haiku-5-5")]

    class Seq(FakeAnthropic):
        pass
    orig = FakeAnthropic.do_POST

    def do_post(self):
        FakeAnthropic.reply = replies[min(len(FakeAnthropic.requests), 1)]
        orig(self)
    FakeAnthropic.do_POST = do_post
    try:
        assert main(["ai-selftest"]) == 0
    finally:
        FakeAnthropic.do_POST = orig
    assert "PASS" in capsys.readouterr().out


def test_gate(cfg):
    from datetime import datetime
    from zoneinfo import ZoneInfo
    now = datetime.now(ZoneInfo("Europe/Lisbon"))
    assert main(["gate", "--at", now.strftime("%H:%M")]) == 0
    assert main(["gate", "--at", f"{(now.hour + 6) % 24:02d}:00"]) == 1


def test_overnight_batch_request_is_accepted_by_sdk(cfg, fake_api):
    fake_api.reply = {"id": "msgbatch_1", "type": "message_batch", "processing_status": "in_progress",
                      "request_counts": {"processing": 1, "succeeded": 0, "errored": 0, "canceled": 0, "expired": 0},
                      "created_at": "2026-11-03T02:00:00Z", "expires_at": "2026-11-04T02:00:00Z",
                      "ended_at": None, "cancel_initiated_at": None, "archived_at": None, "results_url": None}
    llm = LLM(cfg, log=lambda *_: None)
    reqs = followup.batch_requests(llm, [("t0", load_transcript_file(SAMPLE))])
    batch = llm.client.messages.batches.create(requests=reqs)
    assert batch.id == "msgbatch_1"
    body = fake_api.requests[-1]["body"]
    assert fake_api.requests[-1]["path"].startswith("/v1/messages/batches")
    assert "fallbacks" not in body["requests"][0]["params"]  # not allowed on the Batch API
