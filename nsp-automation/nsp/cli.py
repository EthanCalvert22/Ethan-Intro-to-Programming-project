"""`nsp` command line for the Close updater. Run `python -m nsp --help`."""

from __future__ import annotations

import argparse
import os
import sys

from .config import SECRETS, has_secret, load_config, load_dotenv


def _confirm(prompt: str, yes: bool) -> bool:
    if yes:
        return True
    if not sys.stdin.isatty():
        print("Not a terminal: pass --yes to apply.")
        return False
    return input(f"{prompt} [y/N] ").strip().lower() in ("y", "yes")


def _direct(planner, args, cfg, *plan_args) -> int:
    from .close import CloseClient
    client = CloseClient(cfg)
    plan = planner(client, *plan_args)
    print(plan.summary)
    if plan.noop or args.dry_run:
        print("Nothing changed." if plan.noop else "Dry run: nothing changed.")
        return 0
    if not _confirm("Apply this change?", args.yes):
        print("Cancelled.")
        return 1
    plan.run(client)
    print("Done.")
    return 0


def cmd_run(args, cfg):
    from .changes import process_queue
    from .close import CloseClient
    from .notion import NotionClient
    dry = args.dry_run or os.environ.get("NSP_DRY_RUN", "").strip().lower() in ("1", "true", "yes")
    rep = process_queue(cfg, CloseClient(cfg), NotionClient(), dry_run=dry)
    print(f"{'DRY RUN. ' if dry else ''}applied {len(rep.applied)}, previewed {len(rep.previewed)}, "
          f"failed {len(rep.failed)}, left for next run {rep.skipped}")
    return 1 if rep.failed else 0


def cmd_move(args, cfg):
    from .close import plan_move
    return _direct(plan_move, args, cfg, args.lead, args.stage)


def cmd_status(args, cfg):
    from .close import plan_lead_status
    return _direct(plan_lead_status, args, cfg, args.lead, args.status)


def cmd_rename(args, cfg):
    from .close import plan_rename
    return _direct(plan_rename, args, cfg, args.lead, args.new_name)


def cmd_delete_opp(args, cfg):
    from .close import plan_delete_opportunity
    return _direct(plan_delete_opportunity, args, cfg, args.lead, args.opportunity or "")


def cmd_delete_lost_reason(args, cfg):
    from .close import plan_delete_lost_reason

    def planner(client, label):
        return plan_delete_lost_reason(client, label)
    return _direct(planner, args, cfg, args.label)


def cmd_stages(args, cfg):
    from .close import CloseClient
    c = CloseClient(cfg)
    pipe = c.pipeline()
    print(f"{pipe['name']} ({pipe['id']})")
    for s in c.opp_statuses():
        print(f"  [{s.type:6}] {s.label:38} {c.count_with_status(s.id):4} opportunities")
    if args.lead_statuses:
        print("Lead statuses:")
        for s in c.lead_statuses():
            print(f"  {s.label}")
    return 0


def cmd_check(args, cfg):
    print("Credentials (values are never printed):")
    for name, what in SECRETS.items():
        print(f"  [{'x' if has_secret(name) else ' '}] {name:15} {what}")
    if has_secret("CLOSE_API_KEY"):
        from .close import CloseClient
        pipe = CloseClient(cfg).pipeline()
        print(f"  Close OK: key belongs to the org with '{pipe['name']}'.")
    if has_secret("NOTION_TOKEN"):
        from .notion import NotionClient
        rows = NotionClient().query(cfg["notion"]["close_changes_data_source_id"])
        print(f"  Notion OK: Close changes database readable ({len(rows)} rows).")
    return 0


def main(argv=None) -> int:
    load_dotenv()
    p = argparse.ArgumentParser(prog="nsp", description="Close updater for the NSP M&A pipeline")
    p.add_argument("--config", help="path to config.toml")
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("run", help="apply the Notion 'Close changes' queue")
    s.add_argument("--dry-run", action="store_true", help="preview into the Result column, change nothing in Close")
    s.set_defaults(fn=cmd_run)

    def direct(name, fn, help_, *positionals):
        s = sub.add_parser(name, help=help_)
        for pos, h in positionals:
            s.add_argument(pos, help=h)
        s.add_argument("--yes", "-y", action="store_true", help="apply without asking")
        s.add_argument("--dry-run", action="store_true", help="show the change only")
        s.set_defaults(fn=fn)
        return s

    direct("move", cmd_move, 'move "Harrison Akhavan" "Qualified"',
           ("lead", "lead name, lead ID or Close URL"), ("stage", "M&A stage (short names work)"))
    direct("status", cmd_status, 'status "Harrison Akhavan" "M&A Prospect"',
           ("lead", "lead name, lead ID or Close URL"), ("status", "lead status"))
    direct("rename", cmd_rename, 'rename "Jonathan (Alpha Fleet)" "Jonathan Wilcox"',
           ("lead", "current lead name, lead ID or Close URL"), ("new_name", "new lead name"))
    s = direct("delete-opp", cmd_delete_opp, 'delete-opp "Yaqi Wang" oppo_...',
               ("lead", "lead name, lead ID or Close URL"))
    s.add_argument("opportunity", nargs="?", help="opportunity ID; needed if the lead has more than one")
    direct("delete-lost-reason", cmd_delete_lost_reason, 'delete-lost-reason "No Show" (only if unused)',
           ("label", "lost reason name"))

    s = sub.add_parser("stages", help="list M&A stages with how many opportunities use each")
    s.add_argument("--lead-statuses", action="store_true")
    s.set_defaults(fn=cmd_stages)
    sub.add_parser("check", help="check the two credentials work").set_defaults(fn=cmd_check)

    args = p.parse_args(argv)
    cfg = load_config(args.config)
    try:
        return args.fn(args, cfg) or 0
    except Exception as exc:
        from .close import CloseError
        from .config import MissingSecret
        from .http import ApiError
        if isinstance(exc, (MissingSecret, CloseError, ApiError)):
            print(f"Error: {exc}", file=sys.stderr)
            return 2
        raise


if __name__ == "__main__":
    sys.exit(main())
