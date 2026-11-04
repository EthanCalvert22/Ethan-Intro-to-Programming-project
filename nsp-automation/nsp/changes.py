"""Apply the Notion "Close changes" queue to Close.

A row is picked up when Done is unticked and Error is empty. After a run:
- applied: Done ticked, Result = before -> after, Applied = now;
- failed:  Error = the reason (row is skipped until you clear Error);
- dry run: Result = "DRY RUN: would ..." and nothing else changes.
Every change is also printed (GitHub Actions keeps the run log) and renames
and deletions get an audit note on the lead in Close.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone

from .close import ACTIONS, CloseClient, CloseError, norm
from .config import Config
from .http import ApiError
from .notion import NotionClient, plain, rich

PENDING = {"and": [{"property": "Done", "checkbox": {"equals": False}},
                   {"property": "Error", "rich_text": {"is_empty": True}}]}
OLDEST_FIRST = [{"timestamp": "created_time", "direction": "ascending"}]


@dataclass
class RunReport:
    applied: list[str] = field(default_factory=list)
    previewed: list[str] = field(default_factory=list)
    failed: list[str] = field(default_factory=list)
    skipped: int = 0


def process_queue(cfg: Config, close: CloseClient, notion: NotionClient, *, dry_run: bool,
                  log=print) -> RunReport:
    ds = cfg["notion"]["close_changes_data_source_id"]
    limit = int(cfg["close"].get("max_changes_per_run", 25))
    rep = RunReport()
    close.pipeline()  # org guard before reading any row

    rows = notion.query(ds, PENDING, OLDEST_FIRST)
    if len(rows) > limit:
        rep.skipped = len(rows) - limit
        log(f"{len(rows)} pending rows; applying the oldest {limit} this run.")
        rows = rows[:limit]

    for row in rows:
        p = row["properties"]
        title = plain(p.get("Change")) or row["id"]
        action, lead, target = plain(p.get("Action")), plain(p.get("Lead")), plain(p.get("Target"))
        fn = ACTIONS.get(norm(action))
        stamp = datetime.now(timezone.utc).isoformat(timespec="seconds")
        try:
            if not fn:
                raise CloseError(f"Unknown or missing Action '{action}'. Use: Move opportunity stage, "
                                 "Change lead status, Rename lead, Delete opportunity.")
            if not lead:
                raise CloseError("Lead is empty.")
            if not target and fn.__name__ != "plan_delete_opportunity":
                raise CloseError("Target is empty.")
            plan = fn(close, lead, target)
            if dry_run:
                msg = f"DRY RUN: would {plan.summary}"
                notion.update_page(row["id"], {"Result": {"rich_text": rich(msg)}})
                rep.previewed.append(msg)
                log(f"[dry-run] {title}: {plan.summary}")
                continue
            plan.run(close)
            done = ("No change needed: " if plan.noop else "") + plan.summary
            notion.update_page(row["id"], {"Done": {"checkbox": True}, "Result": {"rich_text": rich(done)},
                                           "Applied": {"date": {"start": stamp}}})
            rep.applied.append(done)
            log(f"APPLIED {stamp} {title}: {done}")
        except (CloseError, ApiError) as exc:
            notion.update_page(row["id"], {"Error": {"rich_text": rich(str(exc))}})
            rep.failed.append(f"{title}: {exc}")
            log(f"FAILED {title}: {exc}")
    return rep
