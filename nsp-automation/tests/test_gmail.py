import base64
import email
import json
from email import policy

import responses

from nsp.cli import main
from nsp.config import Config
from nsp.gmail_filters import ensure_filters
from nsp.google import Gmail
from nsp.nda_draft import create_nda_draft

GM = "https://gmail.googleapis.com/gmail/v1/users/me"
DRIVE = "https://www.googleapis.com/drive/v3"
NDA = b"PK\x03\x04 fake docx bytes" * 100


def token(rsps):
    rsps.post("https://oauth2.googleapis.com/token", json={"access_token": "ya29.test", "expires_in": 3600})


def with_drive(cfg):
    data = json.loads(json.dumps(cfg.data))
    data["gmail"]["nda_drive_file_id"] = "FILE123"
    return Config(data)


def decode_draft(call) -> email.message.EmailMessage:
    raw = json.loads(call.request.body)["message"]["raw"]
    return email.message_from_bytes(base64.urlsafe_b64decode(raw), policy=policy.default)


@responses.activate
def test_nda_draft_attaches_word_file_from_drive_and_caches_it(cfg):
    token(responses)
    responses.get(f"{DRIVE}/files/FILE123", match=[responses.matchers.query_param_matcher(
        {"fields": "id,name,mimeType,size,modifiedTime", "supportsAllDrives": "true"})],
        json={"id": "FILE123", "modifiedTime": "2026-09-24T15:17:54Z"})
    dl = responses.get(f"{DRIVE}/files/FILE123", match=[responses.matchers.query_param_matcher(
        {"alt": "media", "supportsAllDrives": "true"})], body=NDA, content_type="application/octet-stream")
    draft = responses.post(f"{GM}/drafts", json={"id": "r-1", "message": {"id": "m-1", "threadId": "t-1"}})

    c = with_drive(cfg)
    body = "Hi Dana,\n\nThank you for today — it was great.\n\nBest regards,\nEthan"
    res = create_nda_draft(c, to="dana@harborline.example", subject="Following up", body=body)
    create_nda_draft(c, to="dana@harborline.example", subject="Again", body="Hi")

    assert len(dl.calls) == 1, "NDA downloaded once, then served from cache"
    msg = decode_draft(draft.calls[0])
    assert msg["To"] == "dana@harborline.example"
    text = msg.get_body(("plain",)).get_content()
    assert "—" not in text and "today, it was great" in text
    att = next(msg.iter_attachments())
    assert att.get_filename() == cfg["gmail"]["nda_attachment_name"]
    assert att.get_content_type() == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    assert att.get_content() == NDA
    assert res.link.endswith("compose=m-1") and res.attached


@responses.activate
def test_reply_in_thread_sets_headers(cfg, tmp_path):
    token(responses)
    nda = tmp_path / "nda.docx"
    nda.write_bytes(NDA)
    data = json.loads(json.dumps(cfg.data))
    data["gmail"]["nda_local_path"] = str(nda)
    responses.get(f"{GM}/threads", json={"threads": [{"id": "t-9"}]})
    responses.get(f"{GM}/threads/t-9", json={"id": "t-9", "messages": [{"payload": {"headers": [
        {"name": "Message-ID", "value": "<abc@mail>"}, {"name": "Subject", "value": "Re: call"}]}}]})
    draft = responses.post(f"{GM}/drafts", json={"id": "r-2", "message": {"id": "m-2", "threadId": "t-9"}})
    create_nda_draft(Config(data), to="x@y.example", subject="Re: call", body="Hi", reply_in_thread=True)
    sent = json.loads(draft.calls[0].request.body)
    assert sent["message"]["threadId"] == "t-9"
    assert decode_draft(draft.calls[0])["In-Reply-To"] == "<abc@mail>"


def test_nda_draft_cli_dry_run_needs_no_credentials(capsys, monkeypatch):
    for n in ("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN"):
        monkeypatch.delenv(n)
    assert main(["nda-draft", "--to", "a@b.example", "--body", "Hi — there", "--dry-run"]) == 0
    out = json.loads(capsys.readouterr().out)
    assert out["body"] == "Hi, there\n" and out["attachment"]


@responses.activate
def test_filters_are_idempotent_and_create_labels(cfg):
    token(responses)
    responses.get(f"{GM}/settings/filters", json={"filter": [
        {"id": "f1", "criteria": {"from": "notifications@calendly.com", "subject": "\"M&A Advisory Meeting\""}}]})
    responses.get(f"{GM}/labels", json={"labels": [{"id": "Label_6", "name": "M&A/2 Reply owed"}]})
    created = responses.post(f"{GM}/settings/filters", json={"id": "f2"})
    logs = []
    done = ensure_filters(cfg, gmail=Gmail(), log=logs.append)
    assert done == ["Signed NDAs or materials coming back"]
    body = json.loads(created.calls[0].request.body)
    assert body["criteria"]["query"].startswith("has:attachment")
    assert body["action"] == {"addLabelIds": ["Label_6", "IMPORTANT"], "removeLabelIds": ["SPAM"]}
    assert any("exists 'Calendly" in l for l in logs)
    assert any("skip 'Leads forwarded" in l for l in logs)
