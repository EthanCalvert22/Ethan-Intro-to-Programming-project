"""Create the Gmail filters listed in config.toml ([[gmail.filters]]). Idempotent."""

from __future__ import annotations

from .config import Config
from .google import Gmail


def filter_spec(f: dict, label_ids: dict[str, str]) -> tuple[dict, dict]:
    criteria = {k: f[k] for k in ("from", "to", "subject", "query") if f.get(k)}
    if f.get("has_attachment"):
        criteria["hasAttachment"] = True
    add = [label_ids[n] for n in f.get("add_labels", [])]
    remove = []
    if f.get("mark_important"):
        add.append("IMPORTANT")
    if f.get("never_spam"):
        remove.append("SPAM")
    if f.get("skip_inbox"):
        remove.append("INBOX")
    action = {}
    if add:
        action["addLabelIds"] = add
    if remove:
        action["removeLabelIds"] = remove
    return criteria, action


def _same(existing: dict, criteria: dict) -> bool:
    ec = existing.get("criteria", {})
    keys = set(ec) | set(criteria)
    return all(str(ec.get(k, "")).strip().lower() == str(criteria.get(k, "")).strip().lower() for k in keys)


def ensure_filters(cfg: Config, gmail: Gmail | None = None, dry_run: bool = False, log=print) -> list[str]:
    specs = cfg["gmail"].get("filters", [])
    done: list[str] = []
    gmail = gmail or Gmail()
    existing = gmail.filters()
    labels = gmail.labels()
    for f in specs:
        name = f.get("name", "filter")
        if not any(f.get(k) for k in ("from", "to", "query")):
            log(f"skip '{name}': no from/to/query set yet (edit config.toml)")
            continue
        if any(_same(e, filter_spec(f, {n: "" for n in f.get("add_labels", [])})[0]) for e in existing):
            log(f"exists '{name}'")
            continue
        label_ids = {}
        for ln in f.get("add_labels", []):
            if ln in labels:
                label_ids[ln] = labels[ln]
            elif dry_run:
                label_ids[ln] = f"<new label {ln}>"
            else:
                label_ids[ln] = gmail.ensure_label(ln)
        criteria, action = filter_spec(f, label_ids)
        if dry_run:
            log(f"[dry-run] would create '{name}': criteria={criteria} action={action}")
        else:
            gmail.create_filter(criteria, action)
            log(f"created '{name}'")
        done.append(name)
    return done
