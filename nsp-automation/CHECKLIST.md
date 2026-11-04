# Setup checklist

Already done: the **Close changes** database in Notion (under To do M&A), two clean-up rows in it (Harrison's status, Jonathan's rename), and the Automation Playbook now tells Cowork to queue Close edits instead of listing them for you.

## 1. Close API key (5 min)

- [ ] In Close, check the org switcher (top left) says **Nassau Street Partners**, not NSP - VP Sales.
- [ ] Settings (gear icon) → **Developer** → **API Keys** → **+ New API Key**. Name it "Close updater".
- [ ] Copy it now; Close only shows it once. The key acts as you, so its changes show under your name in Close.

## 2. Notion integration token (5 min)

- [ ] Go to notion.so/profile/integrations → **New integration**. Name it "Close updater", pick your workspace, type **Internal**, then save.
- [ ] Under Capabilities, keep only **Read content** and **Update content**.
- [ ] Copy the **Internal Integration Secret**.
- [ ] Open the **Close changes** database → **•••** (top right) → **Connections** → add **Close updater**. Connect only this database: the script needs nothing else.
- [ ] If Notion says a workspace admin must approve integrations, ask them. It reads and writes only that one database.

## 3. Try it on your laptop (5 min)

- [ ] In `nsp-automation/`, copy `.env.example` to `.env` and paste both values. Git ignores `.env`.
- [ ] Install and check (this prints whether each credential works, never the values):

```bash
python -m pip install -r requirements.txt
```

```bash
python -m nsp check
```

- [ ] Preview the queue. The Result column of the two clean-up rows should show "DRY RUN: would ...":

```bash
python -m nsp run --dry-run
```

- [ ] One-off: delete the two unused lost reasons. Both had no opportunities when I checked on 4 Nov; the script re-checks and refuses if that has changed.

```bash
python -m nsp delete-lost-reason "Not Selling / Not Ready"
```

```bash
python -m nsp delete-lost-reason "No Show"
```

## 4. Free hosting on GitHub Actions (10 min)

- [ ] Make the repository **private** (Settings → General → Danger Zone → Change visibility), or move `nsp-automation/` and `.github/workflows/nsp-*.yml` into a new private repo.
- [ ] Settings → **Secrets and variables** → **Actions** → **Secrets** → add `CLOSE_API_KEY` and `NOTION_TOKEN`.
- [ ] Merge this branch into the default branch. GitHub only runs schedules from there.
- [ ] Actions tab → **Close updater** → **Run workflow**. Check the log and the Result column; it is in dry run.
- [ ] Go live: Secrets and variables → Actions → **Variables** → add `NSP_LIVE` = `true`. Delete it at any time to go back to dry run.

Cost: free. A private repo gets 2,000 Actions minutes a month; this uses about 1,500 (every 15 minutes, 06:00 to 23:00 Lisbon on weekdays, every 2 hours at weekends). For an urgent change, press Run workflow or use the quick command.

## 5. Decisions for you

- [ ] **Yaqi Wang:** she has two leads, RainSure (Fee and Engagement Review) and PreciGenome (Qualified, Materials Requested). Each has only one M&A opportunity, so the PreciGenome one is not a duplicate on its own lead. If you still want it gone, add a queue row: Lead `lead_VtSSVU0rGTI2tfS1z3sQeS2Q8xNsxqXVEaWQ7AQLwrx`, Action Delete opportunity. If the two leads are really one company, merging them in Close is probably better.
- [ ] **Stage moves you want to list:** add them as rows, or give them to Claude in chat to queue.
- [ ] **Playbook figures:** the Automation Playbook still says a $60K to $100K work fee and $10M. You told me the handbook is now $60K to $150K with a $5M minimum. Cowork will quote whatever the playbook says.
