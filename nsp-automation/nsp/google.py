"""Gmail and Drive over REST, authorised with a long-lived OAuth refresh token.

Only the scopes below are requested. None of them can send mail:
`gmail.compose` creates drafts, but nothing in this project calls `send`.
"""

from __future__ import annotations

import base64
import mimetypes
import time
from email.message import EmailMessage
from email.utils import formataddr
from pathlib import Path
from typing import Any

import requests

from .config import secret, state_dir
from .http import Http

SCOPES = [
    "https://www.googleapis.com/auth/gmail.compose",          # create drafts
    "https://www.googleapis.com/auth/gmail.modify",           # labels on threads (inbox sweep)
    "https://www.googleapis.com/auth/gmail.settings.basic",   # create filters
    "https://www.googleapis.com/auth/drive.readonly",         # download the NDA
]
TOKEN_URL = "https://oauth2.googleapis.com/token"


class GoogleToken:
    """Exchanges the refresh token for short-lived access tokens."""

    def __init__(self, client_id: str | None = None, client_secret: str | None = None,
                 refresh_token: str | None = None, session: requests.Session | None = None):
        self.client_id = client_id or secret("GOOGLE_CLIENT_ID")
        self.client_secret = client_secret or secret("GOOGLE_CLIENT_SECRET")
        self.refresh_token = refresh_token or secret("GOOGLE_REFRESH_TOKEN")
        self.session = session or requests.Session()
        self._token, self._exp = "", 0.0

    def access_token(self) -> str:
        if not self._token or time.time() > self._exp - 60:
            r = self.session.post(TOKEN_URL, data={
                "client_id": self.client_id, "client_secret": self.client_secret,
                "refresh_token": self.refresh_token, "grant_type": "refresh_token"}, timeout=30)
            if r.status_code != 200:
                raise RuntimeError(f"Google token refresh failed ({r.status_code}): {r.text[:300]}. "
                                   "Re-run `nsp google-auth` and update GOOGLE_REFRESH_TOKEN.")
            body = r.json()
            self._token, self._exp = body["access_token"], time.time() + int(body.get("expires_in", 3600))
        return self._token


class _Authed(Http):
    def __init__(self, service: str, base: str, token: GoogleToken):
        super().__init__(service, base)
        self.token = token

    def request(self, method: str, path: str, **kwargs) -> Any:
        self.session.headers["Authorization"] = f"Bearer {self.token.access_token()}"
        return super().request(method, path, **kwargs)


class Gmail:
    def __init__(self, token: GoogleToken | None = None, http: Http | None = None):
        self.http = http or _Authed("Gmail", "https://gmail.googleapis.com/gmail/v1/users/me", token or GoogleToken())
        self._labels: dict[str, str] | None = None

    # ---- labels ------------------------------------------------------------
    def labels(self, refresh: bool = False) -> dict[str, str]:
        if self._labels is None or refresh:
            self._labels = {l["name"]: l["id"] for l in self.http.get("labels").get("labels", [])}
        return self._labels

    def ensure_label(self, name: str) -> str:
        labels = self.labels()
        if name in labels:
            return labels[name]
        created = self.http.post("labels", json={"name": name, "labelListVisibility": "labelShow",
                                                 "messageListVisibility": "show"})
        labels[name] = created["id"]
        return created["id"]

    def modify_thread(self, thread_id: str, add: list[str] = (), remove: list[str] = ()) -> dict:
        return self.http.post(f"threads/{thread_id}/modify",
                              json={"addLabelIds": list(add), "removeLabelIds": list(remove)})

    # ---- threads -----------------------------------------------------------
    def search_threads(self, q: str, max_results: int = 50) -> list[dict]:
        return self.http.get("threads", params={"q": q, "maxResults": max_results}).get("threads", [])

    def get_thread(self, thread_id: str, fmt: str = "metadata") -> dict:
        params = {"format": fmt}
        if fmt == "metadata":
            params["metadataHeaders"] = ["From", "To", "Subject", "Date", "Message-ID", "References"]
        return self.http.get(f"threads/{thread_id}", params=params)

    # ---- drafts ------------------------------------------------------------
    def create_draft(self, msg: EmailMessage, thread_id: str | None = None) -> dict:
        raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
        body: dict[str, Any] = {"message": {"raw": raw}}
        if thread_id:
            body["message"]["threadId"] = thread_id
        return self.http.post("drafts", json=body)

    # ---- filters -----------------------------------------------------------
    def filters(self) -> list[dict]:
        return self.http.get("settings/filters").get("filter", [])

    def create_filter(self, criteria: dict, action: dict) -> dict:
        return self.http.post("settings/filters", json={"criteria": criteria, "action": action})


class Drive:
    def __init__(self, token: GoogleToken | None = None, http: Http | None = None):
        self.http = http or _Authed("Drive", "https://www.googleapis.com/drive/v3", token or GoogleToken())

    def metadata(self, file_id: str) -> dict:
        return self.http.get(f"files/{file_id}", params={"fields": "id,name,mimeType,size,modifiedTime",
                                                         "supportsAllDrives": "true"})

    def download(self, file_id: str) -> bytes:
        return self.http.get(f"files/{file_id}", params={"alt": "media", "supportsAllDrives": "true"})


def build_message(*, to: str, subject: str, body: str, sender: str = "", cc: str = "",
                  attachment: tuple[str, bytes] | None = None,
                  in_reply_to: str = "", references: str = "") -> EmailMessage:
    msg = EmailMessage()
    msg["To"] = to
    if cc:
        msg["Cc"] = cc
    if sender:
        msg["From"] = sender
    msg["Subject"] = subject
    if in_reply_to:
        msg["In-Reply-To"] = in_reply_to
        msg["References"] = (references + " " + in_reply_to).strip()
    msg.set_content(body)
    if attachment:
        name, data = attachment
        ctype = mimetypes.guess_type(name)[0] or "application/octet-stream"
        maintype, subtype = ctype.split("/", 1)
        msg.add_attachment(data, maintype=maintype, subtype=subtype, filename=name)
    return msg


def nda_bytes(gcfg: dict, drive: Drive | None = None) -> tuple[str, bytes]:
    """Return (attachment name, bytes) for the NDA, from a local path or Drive.

    Drive downloads are cached in state/ keyed by modifiedTime, so the file is
    fetched once and only re-fetched when you edit it in Drive.
    """
    name = gcfg.get("nda_attachment_name") or "NDA.docx"
    file_id = gcfg.get("nda_drive_file_id", "").strip()
    if file_id:
        drive = drive or Drive()
        meta = drive.metadata(file_id)
        cache = state_dir() / f"nda-{file_id}-{meta.get('modifiedTime', 'x').replace(':', '')}.bin"
        if cache.exists():
            return name, cache.read_bytes()
        data = drive.download(file_id)
        cache.write_bytes(data)
        return name, data
    local = gcfg.get("nda_local_path", "").strip()
    if local:
        return name, Path(local).expanduser().read_bytes()
    raise RuntimeError("No NDA configured: set gmail.nda_drive_file_id or gmail.nda_local_path in config.toml.")


def sender_header(gcfg: dict, email: str = "") -> str:
    return formataddr((gcfg.get("sender_name", ""), email)) if email else ""
