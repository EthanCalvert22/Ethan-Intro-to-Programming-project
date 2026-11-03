"""Small HTTP helper shared by the REST clients: retries 429/5xx, raises clear errors."""

from __future__ import annotations

import time
from typing import Any

import requests


class ApiError(RuntimeError):
    def __init__(self, service: str, status: int, body: str):
        super().__init__(f"{service} API error {status}: {body[:500]}")
        self.status = status
        self.body = body


class Http:
    def __init__(self, service: str, base_url: str, *, headers: dict | None = None,
                 auth: Any = None, timeout: float = 30.0, max_retries: int = 4,
                 sleep=time.sleep):
        self.service = service
        self.base_url = base_url.rstrip("/")
        self.session = requests.Session()
        if headers:
            self.session.headers.update(headers)
        self.session.auth = auth
        self.timeout = timeout
        self.max_retries = max_retries
        self._sleep = sleep

    def url(self, path: str) -> str:
        if path.startswith("http"):
            return path
        return f"{self.base_url}/{path.lstrip('/')}"

    def request(self, method: str, path: str, **kwargs) -> Any:
        kwargs.setdefault("timeout", self.timeout)
        for attempt in range(self.max_retries + 1):
            resp = self.session.request(method, self.url(path), **kwargs)
            if resp.status_code == 429 or resp.status_code >= 500:
                if attempt < self.max_retries:
                    wait = float(resp.headers.get("Retry-After") or 2 ** attempt)
                    self._sleep(min(wait, 60))
                    continue
            if resp.status_code >= 400:
                raise ApiError(self.service, resp.status_code, resp.text)
            if not resp.content:
                return None
            ctype = resp.headers.get("Content-Type", "")
            return resp.json() if "json" in ctype else resp.content
        raise ApiError(self.service, resp.status_code, resp.text)  # pragma: no cover

    def get(self, path: str, **kw):
        return self.request("GET", path, **kw)

    def post(self, path: str, **kw):
        return self.request("POST", path, **kw)

    def put(self, path: str, **kw):
        return self.request("PUT", path, **kw)

    def patch(self, path: str, **kw):
        return self.request("PATCH", path, **kw)

    def delete(self, path: str, **kw):
        return self.request("DELETE", path, **kw)
