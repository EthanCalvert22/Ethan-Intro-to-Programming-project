# Waiting on credentials and decisions

Run `python -m nsp check` at any time to see which credentials are set (it never prints the values).

## Tomorrow: the Claude API key

- [ ] In the Claude Console, create the key and **set a monthly spend limit on it** (suggest $80, which leaves room under your $100).
- [ ] `export ANTHROPIC_API_KEY=...` (or add it to `nsp-automation/.env`, which git ignores). It is only ever read from the environment.
- [ ] Run the one test: `python -m nsp ai-selftest`. It makes two small calls (one follow-up on the fictional sample transcript with Opus 5.5, one email classification with Haiku 5.5), writes nothing anywhere, prints the draft and the cost, and ends with PASS or FAIL. Expected cost: about $0.10.
- [ ] Add the key as GitHub secret `ANTHROPIC_API_KEY`.

## Other credentials (none of these exist in this environment yet)

| Secret | Where to get it | Needed by |
|---|---|---|
| `CLOSE_API_KEY` | Close: switch to the **Nassau Street Partners** org first, then Settings, Developer, API Keys. A key from "NSP - VP Sales" is refused automatically (the code checks the M&A pipeline ID exists before any write). | Close helper, booking sync, follow-ups |
| `CALENDLY_TOKEN` | Calendly: Integrations, API and webhooks, Personal access token | booking sync, brief, overnight |
| `NOTION_TOKEN` | notion.so/profile/integrations, new internal integration. Then on the **To do M&A** page: ... menu, Connections, add it (sub-pages and the Call Log inherit access). | booking sync, all AI jobs |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google Cloud console: new project, enable Gmail API and Drive API, OAuth consent screen type **Internal** (Workspace), Credentials, OAuth client ID, type Desktop app. Internal matters: an External app in "Testing" status has refresh tokens that expire after 7 days. | NDA drafts, filters, sweep |
| `GOOGLE_REFRESH_TOKEN` | After the two above: `pip install google-auth-oauthlib` then `python -m nsp google-auth`, sign in as ethan.calvert@nassaustreetpartners.com, copy the printed token. Scopes: compose drafts, modify labels, basic settings (filters), read Drive. No send scope is used. | same |
| `FIREFLIES_API_KEY` | Fireflies: Integrations, Fireflies API | follow-ups, overnight |

## Decisions only you can make

- [ ] **Which form answers count as "exploring a sale".** The live form asks "What are you looking to do?" with four options. I count *Sell all or most*, *Sell a minority stake or bring in a partner* and *Just exploring options*, and exclude *Raise capital, not sell*. Edit `calendly.qualifying_answers` in `config.toml` if you want it stricter.
- [ ] **Which NDA file.** Drive search found "NSP NDA Form in Word.docx" (~335KB, in a shared drive), and the "NSP M&A Templates" folder looked empty to me. Your brief says the Word NDA is ~20KB. Put the right file's ID in `gmail.nda_drive_file_id` (or a local path in `gmail.nda_local_path`).
- [ ] **Referral filter.** Add the other VPs' addresses to the third filter in `config.toml`, or leave it skipped.
- [ ] **Capital team contact** for template 5 (handover). The model leaves `[colleague]` unless you name someone in the template; the guard rail then flags the bracket.
- [ ] **Fee wording on calls.** See REVIEW.md: on recent calls you quoted a $60K to $150K work fee and a $5M floor, while the playbook says $60K to $100K and $10M. The email guard rail only enforces the playbook figures.

## Deployment

- [ ] Put this in a **private** repository (or make this one private). It is currently inside the course project repo. No secrets are committed, but config.toml holds internal IDs and the jobs will write logs.
- [ ] Add the secrets above under Settings, Secrets and variables, Actions.
- [ ] Merge to the default branch: GitHub only runs scheduled workflows from it. The workflows are `nsp-bookings.yml` (sync every 15 min in working hours), `nsp-jobs.yml` (the Lisbon schedule) and `nsp-tests.yml`.
- [ ] Minutes: on a private repo the free plan has 2,000 Actions minutes a month. The schedules above use roughly 1,500 to 1,700. On a public repo they are free but the code and run logs are public.

## First live runs (in this order, each is safe)

1. `python -m nsp close statuses` lists the M&A stages with usage counts, so you can see the two lost reasons you want gone and confirm the stage names match the aliases in `config.toml`.
2. `python -m nsp sync-bookings --dry-run -v`, then without `--dry-run`.
3. `python -m nsp gmail-filters --dry-run`, then without.
4. `python -m nsp nda-draft --to you@yourdomain --body "test" ` and check the draft and attachment in Gmail.
5. `python -m nsp followup "Carmelita" --dry-run` once Fireflies is connected (proves the Fireflies query works), then `--no-write`, then live.
6. After the first `python -m nsp brief`, drag the new "Today" toggle heading to the top of the To do M&A page. It is replaced in place from then on.

## Built but not yet verified against the live services

Everything is tested end to end against mocked APIs (25 tests), and the Claude requests are pushed through the real Anthropic SDK to a local fake server. These parts depend on API details I could not check without your credentials:

- Fireflies GraphQL field names (`transcripts`, `sentences { speaker_name text start_time }`).
- Close free-text lead search (`GET /lead/?query=`) matching contact emails; the code then double-checks the exact email itself.
- Notion `2025-09-03` API with the Call Log data source ID.
- Live Claude output quality on your real transcripts (the self-test proves the plumbing; read the first week of drafts closely).
- "Earlier intel" history is not kept on lead pages; each run replaces "Latest intel" (Notion page history keeps the old versions).
