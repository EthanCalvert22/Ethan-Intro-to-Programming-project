# NSP M&A automation

Plain Python scripts that run the admin around each M&A lead, on GitHub Actions or your laptop. They keep working after any Claude Code credits expire. The judgment steps call the Claude API with your own key.

- **REVIEW.md**: critique of the design and schedule, the code versus Claude split, costs, ideas.
- **CHECKLIST.md**: credentials and decisions still outstanding, and the first live runs.

Nothing here ever sends an email, deletes a thread, or marks a lead dead without your Confirm dead tick.

## Setup

```bash
cd nsp-automation
```

```bash
python -m pip install -r requirements.txt
```

```bash
cp .env.example .env
```

Fill in `.env` (git ignores it), then check what is set:

```bash
python -m nsp check
```

Non-secret IDs (Close pipeline and statuses, Notion pages, label names, models, budget) are in `config.toml`.

## Commands

### Close helper (no AI)

```bash
python -m nsp close "move Harrison to Qualified"
```

Also: `"mark Harrison as Interested"` (lead status), `"rename Harrison to Harrison Plumbing LLC"`, `"delete lost reason Duplicate"` (refused if any opportunity uses it), `statuses`, `lead-statuses`. It shows the change and asks before applying; `--yes` skips the question, `--dry-run` only shows it. Stage shortcuts such as `qualified`, `held`, `senior`, `too small` are in `config.toml`.

### Booking sync (no AI)

```bash
python -m nsp sync-bookings --dry-run -v
```

Without `--dry-run` it creates the Close lead, contact and opportunity at Call Booked with the form answers as a note, and a Call Log row, for each new M&A booking of 30+ minutes whose answer is in `calendly.qualifying_answers`. It skips anything Close or the Call Log already has.

### NDA draft (no AI)

```bash
python -m nsp nda-draft --to dana@example.com --body-file email.txt --reply
```

Creates a Gmail draft with the Word NDA attached straight from Drive. `--reply` files it in the latest thread with that person, `--no-nda` leaves the attachment off, `--dry-run` prints the draft.

### Gmail filters (no AI, run once)

```bash
python -m nsp gmail-filters --dry-run
```

### Follow-up from a call (Claude)

```bash
python -m nsp followup "Carmelita"
```

Finds the latest Fireflies call matching the name, scores it, writes the Call Log row and a Close note, moves the opportunity forward if appropriate, and creates the Gmail draft (NDA attached for templates 1 and 2). Add `--notes "..."` for your own notes. Modes:

- `--dry-run`: no API call, no writes, works without a key. Saves the exact request in `logs/dry-run/` and estimates the cost.
- `--no-write`: real Claude call, prints the assessment and email, writes nothing.
- `--transcript-file path` instead of a name, for a saved transcript.

### Scheduled jobs (Claude)

| Command | What it does |
|---|---|
| `overnight [--batch]` | Follow-ups for calls since yesterday that still have no draft (Batch API is 50% cheaper) |
| `overnight-collect` | Applies a finished overnight batch |
| `sweep` | Status labels, deal labels, dead suggestions, applies confirmed deads |
| `brief` | Top 5 deals, today's call preps, slipping items into the "Today" toggle on To do M&A |
| `intel` | Web-search intel into "Latest intel" on each live deal's Call Log page |
| `cost` | Logged Claude spend this month |

All take `--dry-run`.

### When the API key arrives

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

```bash
python -m nsp ai-selftest
```

## Tests

```bash
python -m pip install pytest responses
```

```bash
python -m pytest -q
```

25 end-to-end tests against mocked Close, Calendly, Notion, Gmail, Drive and Fireflies APIs, plus the Claude requests sent through the real Anthropic SDK to a local fake server. No network or credentials needed.

## Schedules (GitHub Actions, Lisbon time)

| When | Job |
|---|---|
| Every 15 min, 11:00 to 23:00 weekdays; every 3 h otherwise | booking sync |
| 02:00 Tue to Sat | overnight follow-ups (batch) + sweep |
| 04:00 Mon, Wed, Fri | deal intel |
| 07:00 weekdays | collect batch, booking sync, brief |
| 13:30 weekdays | booking sync, sweep, brief |
| 17:30 weekdays | afternoon follow-ups + sweep |

GitHub cron is UTC only, so each slot is scheduled at both possible UTC hours and `nsp gate` runs only the one matching Lisbon time. Scheduled workflows run only from the repository's default branch. Any job can also be started by hand from the Actions tab.
