# Close updater

The Claude Close connector can create but not edit or delete. This fills that gap:

1. Claude (chat or Cowork) or you add a row to the Notion database **Close changes** (under To do M&A).
2. Every 15 minutes, GitHub Actions runs this script. It applies the row through the Close REST API, then ticks **Done** and writes **Result**, or writes **Error**.

Only two credentials: a Close API key and a Notion integration token. No Fireflies, Calendly, Google or Claude API use.

## Queue columns

| Column | What to put |
|---|---|
| Change | Short description |
| Lead | Close lead ID (`lead_...`), a Close lead URL, or the exact lead name |
| Action | Move opportunity stage, Change lead status, Rename lead, Delete opportunity |
| Target | Stage name, lead status, new name, or for a delete the `oppo_...` ID if the lead has several |
| Done / Result / Applied / Error | Filled in by the updater |

A failed row is skipped until you fix it and clear **Error**. Stage names are matched loosely: `Qualified`, `qualified materials requested` and `Qualified, Materials Requested` all work, as do `Senior`, `Too Small` (= Lost: Too Small) and `No Show` (= No Show: Dial Back). See `config.toml` for the short names.

## Safety

- **Wrong org:** before reading anything, the script checks that the M&A Opportunities pipeline exists in the key's org. A key from NSP - VP Sales is refused.
- **Wrong pipeline:** stage moves and deletes only touch M&A opportunities. Lead renames and status changes only apply to leads that have an M&A opportunity.
- **Deletes:** it never deletes a won opportunity. If the lead has more than one M&A opportunity, the row must name which one.
- **Ambiguous names:** if a name matches two leads (there are two "Yaqi Wang" leads), the row fails and asks for the lead ID.
- **Volume:** at most 25 rows per run.
- **Log:** every change is recorded in the row (before and after, time) and in the GitHub Actions log. Renames and deletes also get an audit note on the lead in Close.
- **Dry run:** previews go into Result and nothing changes in Close. The schedule stays in dry run until you turn it live.

## Quick commands (from your laptop)

```bash
python -m nsp move "Harrison Akhavan" "Qualified"
```

Also: `status LEAD STATUS`, `rename LEAD NEW_NAME`, `delete-opp LEAD [oppo_ID]`, `delete-lost-reason NAME` (only if unused), `stages` (lists stages and how many opportunities each has), `run` (process the queue now), `check` (tests both credentials). Each command shows the change and asks before applying. `--dry-run` only shows it, `--yes` skips the question.

## Tests

```bash
python -m pip install -r requirements.txt pytest responses
```

```bash
python -m pytest -q
```

13 end-to-end tests against a fake Close org and a fake Notion queue, using your real stage names.

Setup steps are in CHECKLIST.md.
