"""Claude API wrapper: model tiers, prompt caching, budget guard, cost log, dry-run.

ANTHROPIC_API_KEY is read from the environment by the SDK. It is never
hard-coded, logged or written anywhere.

Dry-run (no key needed): the exact request is built and saved to
logs/dry-run/, tokens and cost are estimated, and a clearly marked stub
response is returned so the rest of the job can be exercised end to end.
"""

from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from ..config import ROOT, Config, logs_dir

FALLBACK_BETA = "server-side-fallback-2026-07-01"
PROMPTS = ROOT / "prompts"


class BudgetExceeded(RuntimeError):
    pass


class ModelRefused(RuntimeError):
    pass


def load_prompt(name: str) -> str:
    return (PROMPTS / name).read_text()


def system_blocks(*names: str) -> list[dict]:
    """Stable system prompt made of prompt files; cache breakpoint on the last block.

    Keep these byte-identical between calls (no dates, no IDs) so the cache hits.
    """
    blocks = [{"type": "text", "text": load_prompt(n)} for n in names]
    blocks[-1]["cache_control"] = {"type": "ephemeral"}
    return blocks


@dataclass
class Usage:
    model: str
    input_tokens: int = 0
    output_tokens: int = 0
    cache_write: int = 0
    cache_read: int = 0
    web_searches: int = 0
    batch: bool = False
    estimated: bool = False

    def cost(self, pricing: dict) -> float:
        p = pricing.get(self.model, {})
        usd = (self.input_tokens * p.get("input", 0) + self.output_tokens * p.get("output", 0)
               + self.cache_write * p.get("cache_write", 0) + self.cache_read * p.get("cache_read", 0)) / 1e6
        if self.batch:
            usd *= 0.5
        usd += self.web_searches * pricing.get("web_search", {}).get("per_search", 0.01)
        return round(usd, 5)


def usage_from(resp: Any, model: str, batch: bool = False) -> Usage:
    u = resp.usage
    stu = getattr(u, "server_tool_use", None)
    return Usage(model=model, input_tokens=u.input_tokens or 0, output_tokens=u.output_tokens or 0,
                 cache_write=getattr(u, "cache_creation_input_tokens", 0) or 0,
                 cache_read=getattr(u, "cache_read_input_tokens", 0) or 0,
                 web_searches=(getattr(stu, "web_search_requests", 0) or 0) if stu else 0, batch=batch)


class CostLog:
    def __init__(self, cfg: Config, path: Path | None = None):
        self.cfg = cfg
        self.path = path or logs_dir() / "cost.jsonl"

    def month_total(self, now: datetime | None = None) -> float:
        now = now or datetime.now(timezone.utc)
        if not self.path.exists():
            return 0.0
        total, month = 0.0, now.strftime("%Y-%m")
        for line in self.path.read_text().splitlines():
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            if rec.get("at", "").startswith(month) and not rec.get("estimated"):
                total += rec.get("usd", 0)
        return round(total, 4)

    def check(self) -> None:
        budget = float(self.cfg["ai"].get("monthly_budget_usd", 60))
        spent = self.month_total()
        if spent >= budget:
            raise BudgetExceeded(f"Logged Claude API spend this month is ${spent:.2f}, at or over the "
                                 f"${budget:.2f} budget in config.toml. Raise it or wait for next month.")

    def record(self, job: str, usage: Usage, note: str = "") -> float:
        usd = usage.cost(self.cfg["ai"].get("pricing", {}))
        rec = {"at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "job": job,
               "model": usage.model, "in": usage.input_tokens, "out": usage.output_tokens,
               "cache_write": usage.cache_write, "cache_read": usage.cache_read,
               "searches": usage.web_searches, "batch": usage.batch, "estimated": usage.estimated,
               "usd": usd, "note": note}
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with open(self.path, "a") as fh:
            fh.write(json.dumps(rec) + "\n")
        return usd


def estimate_tokens(obj: Any) -> int:
    text = obj if isinstance(obj, str) else json.dumps(obj)
    return max(1, int(len(text) / 3.6))


class LLM:
    """One place where every Claude call is built, so dry-run and live share code."""

    def __init__(self, cfg: Config, dry_run: bool = False, client: Any = None,
                 cost_log: CostLog | None = None, log: Callable = print):
        self.cfg = cfg
        self.ai = cfg["ai"]
        self.dry_run = dry_run
        self.cost_log = cost_log or CostLog(cfg)
        self.log = log
        self._client = client
        if not dry_run and client is None and not os.environ.get("ANTHROPIC_API_KEY", "").strip():
            raise RuntimeError("ANTHROPIC_API_KEY is not set. Use --dry-run until the key arrives, "
                               "then `export ANTHROPIC_API_KEY=...` and run `nsp ai-selftest`.")

    @property
    def client(self):
        if self._client is None:
            import anthropic
            # The SDK reads ANTHROPIC_API_KEY itself. Pass it explicitly so no other
            # ambient credential (profiles, proxies) is ever picked up by mistake.
            self._client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"].strip(),
                                               base_url=os.environ.get("NSP_ANTHROPIC_BASE_URL", "https://api.anthropic.com"),
                                               max_retries=3)
        return self._client

    def model_for(self, tier: str) -> tuple[str, str]:
        if tier == "fast":
            return self.ai["fast_model"], self.ai.get("fast_effort", "low")
        return self.ai["strong_model"], self.ai.get("strong_effort", "medium")

    def build(self, *, tier: str, system: list[dict], user: str | list, max_tokens: int = 16000,
              schema: dict | None = None, tools: list | None = None, effort: str | None = None) -> dict:
        model, default_effort = self.model_for(tier)
        params: dict[str, Any] = {
            "model": model,
            "max_tokens": max_tokens,
            "system": system,
            "messages": [{"role": "user", "content": user}],
            "output_config": {"effort": effort or default_effort},
        }
        if schema:
            params["output_config"]["format"] = {"type": "json_schema", "schema": schema}
        if tools:
            params["tools"] = tools
        return params

    def _uses_fallback(self, model: str) -> bool:
        # Server-side refusal fallback exists for Opus/Sonnet/Fable, not Haiku.
        return "haiku" not in model

    def call(self, job: str, params: dict, *, stub: Callable[[], Any] | None = None) -> tuple[Any, Usage]:
        """Run one request. Returns (parsed JSON or text, usage)."""
        model = params["model"]
        if self.dry_run:
            return self._dry(job, params, stub)
        self.cost_log.check()
        messages = list(params["messages"])
        total = Usage(model=model)
        for _ in range(5):  # pause_turn loop for server tools (web search)
            req = {**params, "messages": messages}
            if self._uses_fallback(model):
                resp = self.client.beta.messages.create(**req, betas=[FALLBACK_BETA], fallbacks="default")
            else:
                resp = self.client.messages.create(**req)
            u = usage_from(resp, model)
            for f in ("input_tokens", "output_tokens", "cache_write", "cache_read", "web_searches"):
                setattr(total, f, getattr(total, f) + getattr(u, f))
            if resp.stop_reason == "pause_turn":
                messages = messages + [{"role": "assistant", "content": resp.content}]
                continue
            break
        usd = self.cost_log.record(job, total, note=getattr(resp, "_request_id", "") or "")
        self.log(f"[{job}] {model}: in {total.input_tokens} (cache read {total.cache_read}, write "
                 f"{total.cache_write}), out {total.output_tokens}, searches {total.web_searches}: ${usd:.4f}")
        if resp.stop_reason == "refusal":
            raise ModelRefused(f"{job}: the model declined ({getattr(resp, 'stop_details', None)}).")
        if resp.stop_reason == "max_tokens":
            raise RuntimeError(f"{job}: output hit max_tokens; raise it for this job.")
        return self._parse(resp, params), total

    @staticmethod
    def _parse(resp: Any, params: dict) -> Any:
        text = "".join(b.text for b in resp.content if getattr(b, "type", "") == "text")
        if params.get("output_config", {}).get("format"):
            return json.loads(text)
        return text

    def _dry(self, job: str, params: dict, stub: Callable[[], Any] | None) -> tuple[Any, Usage]:
        out_dir = logs_dir() / "dry-run"
        out_dir.mkdir(parents=True, exist_ok=True)
        stamp = time.strftime("%Y%m%d-%H%M%S")
        path = out_dir / f"{stamp}-{job}.json"
        path.write_text(json.dumps(params, indent=2, default=str))
        sys_tokens = estimate_tokens(params["system"])
        msg_tokens = estimate_tokens(params["messages"])
        # Assume a typical answer plus thinking at medium effort.
        est_out = min(params["max_tokens"], 2500 if params.get("output_config", {}).get("format") else 1500)
        searches = 0
        for t in params.get("tools", []) or []:
            if str(t.get("type", "")).startswith("web_search"):
                searches = int(t.get("max_uses", 5))
                msg_tokens += searches * 4000  # search results land in context
        first = Usage(model=params["model"], input_tokens=msg_tokens, output_tokens=est_out,
                      cache_write=sys_tokens, web_searches=searches, estimated=True)
        warm = Usage(model=params["model"], input_tokens=msg_tokens, output_tokens=est_out,
                     cache_read=sys_tokens, web_searches=searches, estimated=True)
        pricing = self.ai.get("pricing", {})
        self.log(f"[dry-run:{job}] {params['model']} effort={params['output_config'].get('effort')} "
                 f"system~{sys_tokens} tok (cached), input~{msg_tokens} tok, output~{est_out} tok, "
                 f"searches<={searches}. Est. ${first.cost(pricing):.4f} first call, "
                 f"${warm.cost(pricing):.4f} with warm cache. Request saved: {path}")
        result = stub() if stub else ("[DRY RUN] no model output" if not params.get("output_config", {}).get("format") else {})
        return result, warm
