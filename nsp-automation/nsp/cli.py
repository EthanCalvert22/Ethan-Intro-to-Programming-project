"""`nsp` command line. Run `python -m nsp --help`."""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from .config import ROOT, SECRETS, has_secret, load_config, load_dotenv


def _confirm(prompt: str, yes: bool) -> bool:
    if yes:
        return True
    if not sys.stdin.isatty():
        print("Not a terminal; pass --yes to apply.")
        return False
    return input(f"{prompt} [y/N] ").strip().lower() in ("y", "yes")


# ---- Close helper -----------------------------------------------------------

def cmd_close(args, cfg):
    from .close import CloseClient, plan_from_sentence
    client = CloseClient(cfg)
    if args.sentence and args.sentence[0] in ("statuses", "stages"):
        pipe = client.pipeline()
        print(f"{pipe['name']} ({pipe['id']})")
        for s in client.opp_statuses():
            used = client.count_opportunities_with_status(s.id)
            print(f"  [{s.type:6}] {s.label}  ({used} opportunities)  {s.id}")
        return 0
    if args.sentence and args.sentence[0] == "lead-statuses":
        for s in client.lead_statuses():
            print(f"  {s.label}  {s.id}")
        return 0
    plan = plan_from_sentence(client, " ".join(args.sentence))
    print(plan)
    if args.dry_run or "Nothing to do" in plan.description:
        return 0
    if _confirm("Apply?", args.yes):
        plan.apply()
        print("Done.")
    return 0


# ---- Booking sync -----------------------------------------------------------

def cmd_sync_bookings(args, cfg):
    from .booking_sync import BookingSync
    from .calendly import CalendlyClient
    from .close import CloseClient
    from .notion import NotionClient
    close = None if args.dry_run else CloseClient(cfg)
    notion = None if args.dry_run or not has_secret("NOTION_TOKEN") else NotionClient()
    if not args.dry_run and notion is None:
        print("NOTION_TOKEN not set: syncing Close only, Call Log rows skipped.")
    res = BookingSync(cfg, CalendlyClient(), close, notion, dry_run=args.dry_run).run()
    print(f"created: {len(res.created)}  planned: {len(res.planned)}  skipped: {len(res.skipped)}  errors: {len(res.errors)}")
    for line in res.created + res.planned:
        print("  +", line)
    if args.verbose:
        for who, why in res.skipped:
            print(f"  - {who}: {why}")
    for who, err in res.errors:
        print(f"  ! {who}: {err}")
    return 1 if res.errors else 0


# ---- Gmail ------------------------------------------------------------------

def cmd_nda_draft(args, cfg):
    from .nda_draft import create_nda_draft
    body = Path(args.body_file).read_text() if args.body_file else args.body
    if not body:
        print("Give --body or --body-file.")
        return 2
    res = create_nda_draft(cfg, to=args.to, cc=args.cc or "", subject=args.subject, body=body,
                           attach_nda=not args.no_nda, reply_in_thread=args.reply, dry_run=args.dry_run)
    if args.dry_run:
        print(json.dumps(res, indent=2))
    else:
        print(f"Draft created (not sent): {res.link}" + (f"  attached: {res.attached}" if res.attached else ""))
    return 0


def cmd_gmail_filters(args, cfg):
    from .gmail_filters import ensure_filters
    ensure_filters(cfg, dry_run=args.dry_run)
    return 0


def cmd_google_auth(args, cfg):
    try:
        from google_auth_oauthlib.flow import InstalledAppFlow
    except ImportError:
        print("pip install google-auth-oauthlib  (only needed for this one-time step)")
        return 2
    from .config import secret
    from .google import SCOPES
    flow = InstalledAppFlow.from_client_config(
        {"installed": {"client_id": secret("GOOGLE_CLIENT_ID"), "client_secret": secret("GOOGLE_CLIENT_SECRET"),
                       "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                       "token_uri": "https://oauth2.googleapis.com/token"}}, SCOPES)
    creds = flow.run_local_server(port=0, access_type="offline", prompt="consent")
    print("\nAdd this to .env and to the GitHub secret GOOGLE_REFRESH_TOKEN (keep it private):\n")
    print(f"GOOGLE_REFRESH_TOKEN={creds.refresh_token}")
    return 0


# ---- AI jobs ----------------------------------------------------------------

def _llm(cfg, dry_run: bool):
    from .ai.llm import LLM
    return LLM(cfg, dry_run=dry_run)


def _writers(cfg, write: bool):
    """Clients for writes; only built when writing, so dry-runs need no credentials."""
    if not write:
        return {}
    from .close import CloseClient
    from .notion import NotionClient
    return {"notion": NotionClient(), "close": CloseClient(cfg) if has_secret("CLOSE_API_KEY") else None}


def _load_transcript(args, cfg):
    from .fireflies import FirefliesClient, load_transcript_file
    if args.transcript_file:
        return load_transcript_file(args.transcript_file)
    ff = FirefliesClient()
    if args.fireflies_id:
        return ff.get(args.fireflies_id)
    if not args.name:
        raise SystemExit("Give a lead name, --fireflies-id or --transcript-file.")
    now = datetime.now(timezone.utc)
    hits = ff.find_by_name(args.name, now - timedelta(days=3), now)
    if not hits:
        raise SystemExit(f"No Fireflies call in the last 3 days matches '{args.name}'.")
    if len(hits) > 1:
        print("Several matches, using the most recent:", ", ".join(h["title"] for h in hits))
    return ff.get(hits[0]["id"])


def cmd_followup(args, cfg):
    from .ai import followup
    write = not (args.dry_run or args.no_write)
    t = _load_transcript(args, cfg)
    if not t.has_content:
        print(f"'{t.title}' has no usable transcript. Add notes with --notes and re-run.")
        return 1
    llm = _llm(cfg, args.dry_run)
    a = followup.assess(llm, t, notes=args.notes or "")
    print(followup.render(a))
    w = _writers(cfg, write)
    plan = followup.apply(cfg, a, notion=w.get("notion"), close=w.get("close"), write=write)
    if not write:
        print("\nWould do (nothing written):")
        for s in plan.steps:
            print("  -", s)
    return 0


def cmd_overnight(args, cfg):
    """Safety net: follow-ups for calls since yesterday that still have no draft."""
    from .ai import followup
    from .calendly import CalendlyClient
    from .fireflies import FirefliesClient
    from .notion import rich
    from .state import State
    write = not args.dry_run
    tz = ZoneInfo(cfg.tz)
    now = datetime.now(timezone.utc)
    start = (now.astimezone(tz) - timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    w = _writers(cfg, write)
    notion = w.get("notion")
    ff, cal = FirefliesClient(), CalendlyClient()
    ccfg = cfg["calendly"]
    m_and_a_emails = set()
    for ev in cal.scheduled_events(ccfg["user_uri"], start, now):
        if ev.get("name") in ccfg["event_type_names"]:
            m_and_a_emails |= {i.get("email", "").lower() for i in cal.invitees(ev["uri"])}
    todo, seen = [], set()
    for meta in ff.list(start, now):
        parts = {p.lower() for p in meta.get("participants") or []}
        email = next(iter(parts & m_and_a_emails), None)
        if not email or email in seen:
            continue
        seen.add(email)
        if followup.already_done(notion, cfg, email):
            continue
        todo.append((email, ff.get(meta["id"])))
    missing = m_and_a_emails - seen
    print(f"{len(todo)} M&A calls need a follow-up; {len(missing)} booked calls have no Fireflies recording.")
    for email in sorted(missing):
        if write and notion is not None:
            rows = notion.query(cfg["notion"]["call_log_data_source_id"],
                                {"property": "Email", "email": {"equals": email}})
            if rows and not rows[0]["properties"].get("Summary", {}).get("rich_text"):
                notion.update_page(rows[0]["id"], {"Summary": {"rich_text": rich("No transcript, add notes")}})
    llm = _llm(cfg, args.dry_run)
    usable = [(e, t) for e, t in todo if t.has_content]
    if args.batch and usable and not args.dry_run:
        return _overnight_batch(cfg, llm, usable, w, State("overnight"), args.wait_minutes)
    for email, t in usable:
        a = followup.assess(llm, t)
        followup.apply(cfg, a, notion=notion, close=w.get("close"), write=write)
        print(f"  {email}: {a.verdict} {a.data['score']}/10")
    return 0


def _overnight_batch(cfg, llm, items, w, state, wait_minutes=0):
    from .ai import followup
    requests = followup.batch_requests(llm, [(f"t{i}", t) for i, (_, t) in enumerate(items)])
    llm.cost_log.check()
    batch = llm.client.messages.batches.create(requests=requests)
    state.set("pending_batch", {"id": batch.id, "items": [[e, t.id] for e, t in items]})
    state.save()
    print(f"Submitted batch {batch.id} ({len(items)} calls, 50% cheaper).")
    # Default: do not wait. Waiting burns GitHub Actions minutes; the 07:00 job collects.
    deadline = time.time() + wait_minutes * 60
    ended = False
    while time.time() < deadline:
        if llm.client.messages.batches.retrieve(batch.id).processing_status == "ended":
            ended = True
            break
        time.sleep(60)
    if not ended:
        print("Batch still running; `nsp overnight-collect` (run by the 07:00 job) will finish it.")
        return 0
    return _collect(cfg, llm, w, state)


def _collect(cfg, llm, w, state):
    from .ai import followup
    from .ai.llm import usage_from
    from .fireflies import FirefliesClient
    pending = state.get("pending_batch")
    if not pending:
        print("No pending batch.")
        return 0
    b = llm.client.messages.batches.retrieve(pending["id"])
    if b.processing_status != "ended":
        print(f"Batch {pending['id']} still {b.processing_status}.")
        return 0
    ff = FirefliesClient()
    items = {f"t{i}": (e, tid) for i, (e, tid) in enumerate(pending["items"])}
    for result in llm.client.messages.batches.results(pending["id"]):
        email, tid = items[result.custom_id]
        if result.result.type == "succeeded":
            llm.cost_log.record("followup-batch", usage_from(result.result.message, cfg["ai"]["strong_model"], batch=True))
        data = followup.parse_batch_result(result)
        if data is None:
            print(f"  {email}: batch item failed ({result.result.type}); run `nsp followup` for it.")
            continue
        a = followup.Assessment(data, ff.get(tid))
        a.warnings = followup.check_output(a.data)
        followup.apply(cfg, a, notion=w.get("notion"), close=w.get("close"), write=True)
        print(f"  {email}: {a.verdict} {a.data['score']}/10")
    state.set("pending_batch", None)
    state.save()
    return 0


def cmd_overnight_collect(args, cfg):
    from .state import State
    return _collect(cfg, _llm(cfg, False), _writers(cfg, True), State("overnight"))


def cmd_sweep(args, cfg):
    from .ai import inbox
    from .google import Gmail
    from .notion import NotionClient
    write = not args.dry_run
    llm = _llm(cfg, args.dry_run) if (has_secret("ANTHROPIC_API_KEY") or args.dry_run) else None
    close = None
    if write and has_secret("CLOSE_API_KEY"):
        from .close import CloseClient
        close = CloseClient(cfg)
    inbox.sweep(cfg, gmail=Gmail(), notion=NotionClient(), llm=llm, close=close, me=args.me, write=write)
    return 0


def cmd_brief(args, cfg):
    from .ai import brief
    from .calendly import CalendlyClient
    from .notion import NotionClient
    brief.run(cfg, _llm(cfg, args.dry_run), notion=NotionClient(),
              calendly=CalendlyClient() if has_secret("CALENDLY_TOKEN") else None, write=not args.dry_run)
    return 0


def cmd_intel(args, cfg):
    from .ai import intel
    from .notion import NotionClient
    send = intel.run(cfg, _llm(cfg, args.dry_run), notion=NotionClient(), write=not args.dry_run)
    if send:
        print("Worth sending today:", ", ".join(send))
    return 0


def cmd_ai_selftest(args, cfg):
    """The one test to run when the API key arrives. Writes nothing."""
    from .ai import followup
    from .ai.inbox import CLASSIFY_SCHEMA, CLASSIFY_SYSTEM
    from .fireflies import load_transcript_file
    if not has_secret("ANTHROPIC_API_KEY"):
        print("FAIL: ANTHROPIC_API_KEY is not set.")
        return 1
    llm = _llm(cfg, False)
    sample = args.transcript_file or ROOT / "tests" / "fixtures" / "sample_transcript.txt"
    t = load_transcript_file(sample)
    ok = True
    print(f"1/2 Follow-up on {Path(sample).name} with {cfg['ai']['strong_model']} ...")
    a = followup.assess(llm, t)
    print(followup.render(a))
    for k in followup.SCHEMA["required"]:
        if k not in a.data:
            ok = False
            print(f"FAIL: missing field {k}")
    if "—" in a.data["email_body"]:
        ok = False
        print("FAIL: em dash in email")
    print(f"\n2/2 Inbox classification with {cfg['ai']['fast_model']} ...")
    params = llm.build(tier="fast", system=CLASSIFY_SYSTEM, max_tokens=1024, schema=CLASSIFY_SCHEMA,
                       user='<email subject="Re: NDA" has_attachment="True">Hi Ethan, signed NDA attached. Financials to follow.</email>')
    out, _ = llm.call("selftest-classify", params)
    print("classified as:", out.get("kind"))
    ok = ok and out.get("kind") == "nda_signed"
    print(f"\nSpend logged this month: ${llm.cost_log.month_total():.4f}")
    print("PASS" if ok else "FAIL")
    return 0 if ok else 1


# ---- utilities --------------------------------------------------------------

def cmd_check(args, cfg):
    print("Credentials (values are never printed):")
    for name, what in SECRETS.items():
        print(f"  [{'x' if has_secret(name) else ' '}] {name:22} {what}")
    g = cfg["gmail"]
    print(f"  [{'x' if g.get('nda_drive_file_id') or g.get('nda_local_path') else ' '}] NDA file set in config.toml")
    return 0


def cmd_cost(args, cfg):
    from .ai.llm import CostLog
    log = CostLog(cfg)
    print(f"Logged Claude API spend this month: ${log.month_total():.4f} of ${cfg['ai']['monthly_budget_usd']} budget")
    return 0


def cmd_sync_prompts(args, cfg):
    from .notion import NotionClient
    n = NotionClient()
    for page, fname in ((cfg["notion"]["templates_page_id"], "templates.md"),):
        text = n.page_text(page)
        (ROOT / "prompts" / fname).write_text(f"# M&A Email Templates\n\nSource: Notion. Refresh with `nsp sync-prompts`.\n\n{text}\n")
        print(f"updated prompts/{fname} ({len(text)} chars)")
    return 0


def cmd_gate(args, cfg):
    """Exit 0 only when Lisbon local time is within --window minutes of --at.

    GitHub cron is UTC-only; schedule both UTC hours and let the gate pick the
    one that matches Lisbon time, so daylight saving changes need no edits."""
    now = datetime.now(ZoneInfo(cfg.tz))
    hh, mm = map(int, args.at.split(":"))
    target = now.replace(hour=hh, minute=mm, second=0, microsecond=0)
    diff = abs((now - target).total_seconds()) / 60
    ok = diff <= args.window and (not args.days or now.isoweekday() in {int(d) for d in args.days.split(",")})
    print(f"Lisbon {now:%a %H:%M}, target {args.at}: {'run' if ok else 'skip'}")
    return 0 if ok else 1


def main(argv=None) -> int:
    load_dotenv()
    p = argparse.ArgumentParser(prog="nsp", description="NSP M&A pipeline automation")
    p.add_argument("--config", help="path to config.toml")
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("close", help='Close helper: nsp close "move Harrison to Qualified" | statuses | lead-statuses')
    s.add_argument("sentence", nargs="+")
    s.add_argument("--yes", "-y", action="store_true", help="apply without asking")
    s.add_argument("--dry-run", action="store_true")
    s.set_defaults(fn=cmd_close)

    s = sub.add_parser("sync-bookings", help="Calendly -> Close + Notion")
    s.add_argument("--dry-run", action="store_true")
    s.add_argument("-v", "--verbose", action="store_true")
    s.set_defaults(fn=cmd_sync_bookings)

    s = sub.add_parser("nda-draft", help="Gmail draft with the NDA attached")
    s.add_argument("--to", required=True)
    s.add_argument("--cc")
    s.add_argument("--subject", default="Nassau Street Partners | Following up on today's call")
    s.add_argument("--body")
    s.add_argument("--body-file")
    s.add_argument("--no-nda", action="store_true")
    s.add_argument("--reply", action="store_true", help="put the draft in the latest thread with this person")
    s.add_argument("--dry-run", action="store_true")
    s.set_defaults(fn=cmd_nda_draft)

    s = sub.add_parser("gmail-filters", help="create the filters in config.toml (idempotent)")
    s.add_argument("--dry-run", action="store_true")
    s.set_defaults(fn=cmd_gmail_filters)

    s = sub.add_parser("google-auth", help="one-time: get a Google refresh token")
    s.set_defaults(fn=cmd_google_auth)

    s = sub.add_parser("followup", help="draft a follow-up from a Fireflies transcript")
    s.add_argument("name", nargs="?", help="lead name to find in Fireflies (last 3 days)")
    s.add_argument("--fireflies-id")
    s.add_argument("--transcript-file")
    s.add_argument("--notes", help="your own notes to add to the transcript")
    s.add_argument("--dry-run", action="store_true", help="no API call, no writes (works without the key)")
    s.add_argument("--no-write", action="store_true", help="real API call, but write nothing")
    s.set_defaults(fn=cmd_followup)

    s = sub.add_parser("overnight", help="follow-ups for yesterday's calls that have no draft")
    s.add_argument("--batch", action="store_true", help="use the Batch API (50%% cheaper)")
    s.add_argument("--wait-minutes", type=int, default=0, help="with --batch, wait this long for results")
    s.add_argument("--dry-run", action="store_true")
    s.set_defaults(fn=cmd_overnight)

    s = sub.add_parser("overnight-collect", help="finish a pending overnight batch")
    s.set_defaults(fn=cmd_overnight_collect)

    s = sub.add_parser("sweep", help="inbox sweep: status labels, deal labels, dead suggestions")
    s.add_argument("--me", default="ethan.calvert@nassaustreetpartners.com")
    s.add_argument("--dry-run", action="store_true")
    s.set_defaults(fn=cmd_sweep)

    s = sub.add_parser("brief", help="morning brief into the Today section")
    s.add_argument("--dry-run", action="store_true")
    s.set_defaults(fn=cmd_brief)

    s = sub.add_parser("intel", help="deal intel with web search")
    s.add_argument("--dry-run", action="store_true")
    s.set_defaults(fn=cmd_intel)

    s = sub.add_parser("ai-selftest", help="the one live test to run when the API key arrives")
    s.add_argument("--transcript-file")
    s.set_defaults(fn=cmd_ai_selftest)

    for name, fn, h in (("check", cmd_check, "show which credentials are set"),
                        ("cost", cmd_cost, "Claude API spend this month"),
                        ("sync-prompts", cmd_sync_prompts, "refresh prompts from Notion")):
        sub.add_parser(name, help=h).set_defaults(fn=fn)

    s = sub.add_parser("gate", help="exit 0 if Lisbon time is near --at (for schedules)")
    s.add_argument("--at", required=True)
    s.add_argument("--window", type=int, default=40)
    s.add_argument("--days", help="ISO weekdays, e.g. 1,2,3,4,5")
    s.set_defaults(fn=cmd_gate)

    args = p.parse_args(argv)
    cfg = load_config(args.config)
    try:
        return args.fn(args, cfg) or 0
    except Exception as exc:  # friendly one-line errors for the expected failures
        from .config import MissingSecret
        from .close import CloseError
        from .http import ApiError
        if isinstance(exc, (MissingSecret, CloseError, ApiError)):
            print(f"Error: {exc}", file=sys.stderr)
            return 2
        raise


if __name__ == "__main__":
    sys.exit(main())
