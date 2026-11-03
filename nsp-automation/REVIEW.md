# NSP M&A pipeline automation: review and recommendations

Reviewed against your live setup on 3 Nov 2026: Close statuses, the Calendly M&A event types and their forms, Gmail labels, the Notion Call Log schema, the Automation Playbook, the Email Templates page, and recent Fireflies calls.

## 1. Critique of the design and schedule

**What is sound.** Drafts only, "Confirm dead" as a human gate, one Call Log row per lead, status labels as a pipeline in Gmail, a written playbook the automations read. Keep all of it.

**Weaknesses found**

1. **The booking filter does not match the form.** Neither M&A form has an "exploring a sale" answer. The question is "What are you looking to do?" with four options: sell all or most, sell a minority stake, raise capital, just exploring. The automation has to map these explicitly or it guesses differently each run. It is now a list in `config.toml` (see CHECKLIST.md).
2. **Leads have no company name.** The form asks for a description, not a company. New Close leads are named from the email domain (dana@harborline.com becomes "Harborline") or the person's name for Gmail-type addresses, and the Close helper renames them later.
3. **The schedule was designed around Cowork usage limits.** Scripts calling the API do not compete with your own usage, so run times should follow when the information is needed, not when you are idle:
   - The 07:00 brief is written seven hours before your shift and goes stale (new bookings, overnight replies). The 13:30 refresh is the one you read. I kept both, but you could drop 07:00 and save about $2 a month.
   - Follow-ups were batched to 02:00 and 17:30. Your rule of drafting on demand about 15 minutes after the call is right; the scheduled runs are only a safety net for calls you did not get to.
4. **Some state lived only in the model's memory of a run.** "Since the last run" is fragile in Cowork. Now every job is idempotent against the source of truth: Close is searched by email before creating anything, the Call Log is searched by email, a row with Draft ready ticked is never redrafted. A small JSON cache only speeds this up.
5. **Lost moves and "dead" were mixed.** Moving an opportunity to Too Small or Not a Fit is effectively marking it dead, which your rules say needs your tick. The code moves stages forward automatically (Call Booked, Screening Call Held, Qualified) but only proposes lost stages in the Dead? column. They are applied after you tick Confirm dead.
6. **Fee and size figures (resolved).** The handbook is now a $60K to $150K work fee, 6% to 8% success fee, $5M bare minimum and $10M+ ideal. The code uses these; the Notion Playbook and template 4 still show the old figures. The Calendly capital form still says $50K+.
7. **Two recent Fireflies meetings had no summary** (a 2-minute call and a silent one). These are likely no-shows. The overnight job writes "No transcript, add notes" rather than drafting from nothing.
8. **Security.** The code sits in your course-project repository. Move it to a private repo. The Google OAuth app must be "Internal", or refresh tokens die after 7 days. The Close key can do anything in its org, so the code checks the M&A pipeline ID before every write, which keeps it out of "NSP - VP Sales" even if the wrong key is pasted.
9. **Prompt injection.** Transcripts, forms and emails are written by outsiders. Every prompt marks them as data, never instructions, and nothing can send, delete or archive, so the worst a hostile email can do is produce a bad draft you will read.

## 2. Recommended split

| Work | Where it runs | Why |
|---|---|---|
| Close stage moves, lead status, renames, lost-reason cleanup | **Script** `nsp close` | Deterministic, free, the connector cannot do it |
| Calendly to Close and Call Log | **Script**, every 15 min | Deterministic, free, near instant |
| NDA attachment on drafts | **Script** (Gmail API) | The 20-300KB file never passes through a model |
| Gmail filters | **Script**, once | Connector cannot create filters |
| Status labels, deal labels, dead suggestions, confirmed deads | **Script**, Haiku 5.5 for one judgment | Mostly rules on who wrote last and when |
| Transcript assessment, score, follow-up text | **Claude API**, Opus 5.5 | Needs judgment and good writing |
| Morning brief ranking and call preps | **Claude API**, Opus 5.5 | Needs judgment |
| Deal intel | **Claude API**, Opus 5.5 with web search | Needs search and relevance judgment |
| Ad-hoc questions, one-off research, editing a draft with you | **Claude chat / Cowork** | Interactive; no schedule needed |

Cowork scheduled tasks are no longer needed for any of the five workflows. Keep the Playbook page as the human-readable spec; the prompts in `prompts/` mirror it and `nsp sync-prompts` refreshes the templates from Notion.

## 3. What was built (all in `nsp-automation/`)

See README.md for setup and commands, CHECKLIST.md for credentials. Summary:

- `nsp close "move Harrison to Qualified"` and friends, with an org guard, aliases, ambiguity checks, and a refusal to delete a lost reason that is still in use.
- `nsp sync-bookings`: Calendly polling, form filter, duplicate checks against Close and Notion, lead + contact + opportunity at Call Booked + note + Call Log row.
- `nsp nda-draft`: Gmail draft with the Word NDA attached from Drive (downloaded once and cached until the file changes), optionally as a reply in the lead's thread, em dashes stripped.
- `nsp gmail-filters`: creates the filters in `config.toml`, skipping ones that already exist.
- AI jobs, each with `--dry-run` (no key needed, no writes, saves the exact request and estimates cost): `followup`, `overnight` (with the Batch API), `sweep`, `brief`, `intel`, plus `ai-selftest`, the single test to run when the key arrives.
- GitHub Actions: booking sync every 15 minutes in working hours, the Lisbon schedule with automatic daylight-saving handling, and the test suite.

## 4. Cost estimate (Claude API)

Assumptions: 10 calls a weekday (22 days), 25-minute transcripts, about 8 live deals for intel.

| Job | Model | Per run | Per month |
|---|---|---|---|
| Follow-up | Opus 5.5, medium effort, cached playbook | about $0.08 to $0.10 | about $20 (about $10 if most go through the overnight batch) |
| Inbox classification | Haiku 5.5 | under $0.001 | under $1 |
| Brief, twice a weekday | Opus 5.5 | about $0.08 | about $4 |
| Deal intel, 8 deals, 3x a week | Opus 5.5 + up to 5 searches each | about $0.20 per deal | about $20 |
| **Total** | | | **about $45** |

Levers if you want it lower: switch `strong_model` to `claude-sonnet-5-5` for intel and the brief (about half the price), cut `intel_max_searches_per_deal` to 3, or drop the 07:00 brief. Every call is logged to `logs/cost.jsonl` with its dollar cost, `nsp cost` shows the month, and jobs stop at the `monthly_budget_usd` in config. Also set the hard limit on the key in the Console.

Server-side refusal fallback (`fallbacks: "default"`) is turned on for Opus calls, so a rare safety-classifier decline is retried on another model instead of failing the job. It is not available on the Batch API or for Haiku; there a decline is reported and the job moves on.

## 5. Your seven known problems, answered

1. **Close stage changes:** yes, done (`nsp close`). Opportunities move automatically from the transcript verdict, forward only; lost moves wait for your tick.
2. **Instant bookings:** polling every 15 minutes on GitHub Actions is free and needs no server. A Calendly webhook is faster, but needs a paid Calendly plan and a public endpoint (e.g. a free Cloudflare Worker); worth it only if 15 minutes is too slow, since most SDR bookings are for later days.
3. **NDA attachments:** done, via the Gmail API. Claude only supplies the text.
4. **Gmail filters:** done, via the Gmail API.
5. **Code versus LLM:** see the table in section 2. Rule of thumb: if it can be decided from who, when and which form answer, it is code.
6. **Dedup and state:** use the systems you already have as the database (Close by email, Call Log by email, Draft ready tick). The JSON cache is a convenience; losing it is harmless.
7. **Approval prompts:** scripts with API keys have none. Scope each key or token to the minimum (no Gmail send scope; Notion integration only on the M&A pages).

## 6. Ideas for staying on top of leads

- **No-show catcher.** A Fireflies call under 3 minutes with an M&A booking is almost always a no-show. Draft a two-line rebook email with a fresh single-use Calendly link (the Calendly API can create one).
- **Close tasks instead of Notion chase dates.** Create a Close task due on the chase date; it then shows in your Close inbox and on your phone with no extra page to check.
- **Close Smart View "M&A: my move".** Opportunities where the last email is inbound, or where nothing has happened in 5 days. One click each morning.
- **Prep at booking time, not at 07:00.** When a booking syncs, run one cheap Haiku call plus one web search for a three-line company snapshot into the Call Log row. By the time the call starts, prep exists even for same-day bookings.
- **Learn from your edits.** Compare each draft with what you actually sent (Gmail Sent) once a week and feed the differences back into the templates page. The drafts converge on your voice.
- **Calibrate the score.** Every quarter, check scores against which leads reached Senior Team Call. If 6s convert as often as 8s, the rubric needs work.
- **Friday digest to the senior team.** One short email draft listing new qualified leads, NDAs back and materials received, so Gary, Bill and Ron see momentum without asking.
- **Batch the drafting yourself.** Two 15-minute review blocks (after the 17:30 run and the next day at 13:30) instead of switching after every call.
