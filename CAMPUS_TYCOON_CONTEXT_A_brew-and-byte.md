# Brew & Byte: Full Build Context

> Drop this file into the root of a new GitHub repository and start a cloud session on it. It contains everything needed: the course context, the verbatim business brief, the design decisions, the design of this version, the quality bar, and the working rules. Read all of it before writing any code. This project is **completely standalone**; it has no dependency on any other repository or version.

---

## 1\. Your mission

Build **one complete, standalone version** of the Campus Tycoon first release, called **Brew & Byte** (a campus café), to a very high standard, in this one GitHub repository. It must satisfy every requirement, business rule and acceptance scenario in the brief (Section 3).

The student is submitting this as their own course project and must be able to explain and verify everything. Write it as one coherent piece of work with its own voice, naming and design. It should read as the work of a single person who made deliberate choices: a distinctive name, theme, catalogue, visual identity, layout and wording. Do not mention any other version of this product anywhere in the code, comments or docs.

Stack: TypeScript (`strict`), Vite, vanilla DOM (no UI framework), `vitest`, `playwright`, `eslint`, `prettier`; Node 20+. Web app with no backend and no network at runtime.

The budget for this session may be used in full. Prefer thoroughness, correctness and verification over speed. Do not stop at "it runs"; stop when everything in the Definition of Done (Section 9\) is proven.

---

## 2\. Course context (why this exists)

This is a solo project for an Introduction to Programming course (Nova SBE, weeks 5 to 7, ready for week 8). Rules from the course:

- Pick one of three products; this one is **Product 02: Campus Tycoon** ("3 products, 5 days, €100 starting cash").  
- Build **one complete first release**: an experience that works from beginning to end, with sample content, clear rules, and progress that survives an app restart.  
- Every brief includes concrete acceptance scenarios; use them to check the result.  
- The student chooses the design: name, setting, content and interface. Meet the required behaviour before adding extensions.  
- **AI may be used to build, but the student must be able to explain and verify what it produces.** This drives several requirements below (readable code, explanations, tests).  
- Keep scope manageable: one user at a time. Accounts, payments, multiplayer, external APIs and LLM features are **not required** (and should not be added).  
- Work is kept on GitHub, ready for week 8\.  
- No programming language is mandated.

---

## 3\. The business brief (verbatim, source of truth)

**Block 2 · Product 02 · Business requirements: Campus Tycoon** *A small business with decisions that add up.* 3 products · 5 days · €100 starting cash. Version 1.0 · 29 September 2026

### The opportunity

A player wants to try running a small campus business and see the consequences of their decisions. We need a short simulation where prices affect demand, stock limits sales, and the financial results are understandable.

### First release

Deliver one business with at least three products and a five-day trading run. Begin with €100 cash and zero stock. Give each product a fixed unit purchase cost and a fixed reference selling price, both positive. Choose the business theme and catalogue; a café, snack stand, or merchandise stall would work.

### The user journey

The player starts a run, buys stock, sets selling prices, and opens for one day. The app reports what sold and updates cash and stock. The player repeats these decisions until day five, then sees the final result. They can leave and resume between trading days.

### Required capabilities

**CT01: Manage a run.** Show the current day, available cash, stock by product, and progress through the five-day run. Ask for confirmation before replacing a run.

**CT02: Purchase stock.** Let the player buy a positive whole-number quantity of a product. Show the total cost, reject unaffordable purchases, and update cash and stock together.

**CT03: Set prices.** Let the player set a positive selling price for each product before trading. Show the demand rule so players can make informed decisions.

**CT04: Trade one day.** Run one trading day using the current stock and prices. Show units sold, revenue, cost of goods sold, and gross profit by product and in total.

**CT05: Review progress.** Keep a history of completed days. After day five, show final cash, remaining stock at purchase cost, and the overall gain or loss. Further buying and trading must stop.

### Business rules

**CT R1: Demand.** For each product per day, demand is 10 units when its selling price is at or below its reference price, 5 units when above the reference price but no more than twice it, and 0 units above twice it. There is no randomness in the first release.

**CT R2: Sales and stock.** Units sold equal the smaller of demand and available stock. Unsold stock carries forward. There are no running costs, spoilage, borrowing, or stock returns in this release.

**CT R3: Money.** Use euro amounts with at most two decimal places. Purchases reduce cash by quantity × unit cost. Trading increases cash by units sold × selling price. Cash and stock must never become negative.

**CT R4: Results.** Daily gross profit is revenue minus the purchase cost of the units sold. Overall gain or loss is final cash plus remaining stock at purchase cost minus the initial €100. Do not deduct stock purchases a second time from cash when calculating sales.

**CT R5: Day progression.** A completed day is recorded once. Refreshing or reopening the app must not repeat its sales. Each explicit trade action advances exactly one day; after day five the run is complete.

### What the product must remember

Keep the product catalogue, costs, and reference prices. Save the run's cash, stock, chosen selling prices, current day, and daily results. Save accepted purchases and price changes immediately, and save each day's results together with its updated balances.

### Acceptance criteria

**A1: Purchase within budget.** With €100 and no stock, buy 10 units costing €2 each. Cash becomes €80 and stock becomes 10\. An additional €82 purchase is rejected without changing either balance.

**A2: Demand boundaries.** For a reference price of €4, prices of €4, €4.01, €8, and €8.01 produce demand of 10, 5, 5, and 0 respectively. A zero or negative selling price is rejected.

**A3: Reconcile a trading day.** With €80 cash, 10 units costing €2 each, and a €4 price at the reference price, trade once with other products out of stock. Revenue is €40, cost of goods sold €20, gross profit €20, cash €120, and stock zero.

**A4: Stock limits sales.** With only 3 units and demand of 10, sell 3 units. With zero stock, sell zero. Neither case produces negative stock.

**A5: Resume without replay.** Complete a day, stop and reopen the app, and verify cash, stock, prices, and history are unchanged. The completed day has only one record.

**A6: Complete and restart.** Finish day five and verify buying and trading are disabled. Confirming a new run restores €100, zero stock, day one, and empty history; cancelling preserves the previous run.

### Scope boundaries

Random events, upgrades, competing businesses, and more complex demand models belong after the first release works.

Accepted changes must survive restarting the app. Rejected actions leave existing data unchanged. The core experience works with supplied content and without a paid service or live external integration.

---

## 4\. Design decisions (the brief leaves these open; these are fixed)

Where the brief is silent, use these decisions. Record each one in `docs/DECISIONS.md` with a one-line reason.

1. **Money is stored as integer cents everywhere** (never floats). `€4.01` is `401`. Convert only at the input and display edges. Selling-price input accepts at most two decimal places; anything else (e.g. `4.005`, `abc`, `1e2`, empty) is rejected with a clear message.  
2. **Demand uses integer comparison in cents**: demand is 10 if `price <= ref`, 5 if `ref < price <= 2*ref`, else 0\. This makes €4.01 and €8.01 exact.  
3. **Default selling price** for each product at the start of a run equals its reference price (so every price is always valid and positive).  
4. **Selling prices can be changed any time before a trade action** while the run is in progress, and persist across days until changed. Prices are rejected if zero, negative, or malformed.  
5. **Buying is allowed any time while the run is in progress** (before each trade). It is disabled once day five is complete.  
6. **Trading with zero stock is allowed** and still advances the day (zero units sold). The player is not blocked from progressing.  
7. **Day numbering**: the run starts on day 1\. `current_day` is the day about to be traded. After the fifth trade, status becomes `completed` and `current_day` stays 5 with 5 history records (or the UI shows "5 of 5 complete"). Pick one convention, document it, and test it.  
8. **Cost of goods sold** uses the fixed unit cost (there is no cost averaging because unit costs never change).  
9. **Overall gain/loss** \= `final_cash + sum(remaining_stock * unit_cost) - 10000` (cents). Can be negative; display clearly with sign and colour/wording.  
10. **Replacing a run**: "New run" asks for explicit confirmation if a run exists (in progress or completed). Cancel changes nothing. Confirm resets to the initial state. Starting the app for the very first time with no save creates a fresh run without a prompt.  
11. **Rejected actions never mutate state and never write to storage.**  
12. **A run is a single saved record** that is replaced atomically (see persistence). No partial saves.  
13. **Catalogue lives in a data file / constant**, not scattered through logic, and is validated at startup (at least 3 products, unique ids, positive integer cents for cost and reference price).  
14. **No randomness, no network, no accounts, no external services, no LLM features.**

---

## 5\. Domain model (use idiomatic camelCase names in TypeScript, e.g. `unitCostCents`)

Product      { id, name, unit\_cost\_cents, reference\_price\_cents }

Run          { version, status: "in\_progress" | "completed",

               current\_day (1..5), cash\_cents,

               stock: { product\_id: int \>= 0 },

               prices: { product\_id: int \> 0 (cents) },

               history: \[DayResult\] }

DayResult    { day, lines: \[ { product\_id, price\_cents, demand, units\_sold,

                               revenue\_cents, cogs\_cents, gross\_profit\_cents } \],

               totals: { units\_sold, revenue\_cents, cogs\_cents, gross\_profit\_cents },

               cash\_after\_cents, stock\_after }

FinalSummary { final\_cash\_cents, remaining\_stock\_value\_cents, gain\_loss\_cents }

Core operations are **pure functions** that take a `Run` (and catalogue) and return a new `Run` or a typed error. They never touch the disk, the clock, the console or the DOM:

- `new_run(catalogue) -> Run`  
- `buy(run, catalogue, product_id, quantity) -> Run | Error`  
- `set_price(run, catalogue, product_id, price_cents) -> Run | Error`  
- `trade_day(run, catalogue) -> Run | Error`  (appends exactly one `DayResult`, advances state, in one step)  
- `demand(price_cents, reference_cents) -> 0 | 5 | 10`  
- `summary(run, catalogue) -> FinalSummary`

Typed errors (use an enum or union): `NotAffordable`, `InvalidQuantity`, `InvalidPrice`, `UnknownProduct`, `RunCompleted`. Each carries a human-readable message.

**Invariants** (assert in tests, including property-style randomised tests): cash \>= 0; every stock \>= 0; every price \> 0; `len(history) <= 5`; `len(history) == days_completed`; cash \+ stock value changes only by gross profit across a trade; sum of daily gross profits \== final gain/loss when all purchases are accounted for (reconciliation test).

---

## 6\. Persistence rules

- Save immediately after every **accepted** buy and every **accepted** price change.  
- Save a trading day's `DayResult` **together with** the updated cash/stock/day in one atomic write.  
- Never save on rejected actions.  
- On startup: load the save if it exists and validates; otherwise create a fresh run. A corrupted or invalid save must **not crash the app**: show a clear message, keep a backup copy of the bad data under a separate key and offer to start fresh, and do not silently overwrite without telling the player.  
- Include a `version` field in the saved data and a migration/validation function, so the format can evolve.  
- Reopening must never replay a day (A5): loading is read-only and has no side effects.  
- `localStorage` under the single namespaced key `brew-and-byte:run:v1` holding the whole run as one JSON value (a single `setItem` is atomic). Wrap storage access in try/catch; handle storage being unavailable or full with a clear message.

---

## 7\. Design of Brew & Byte

### 7.1 Identity and interface choices

Mood: **Warm, light and friendly**. These choices are fixed; implement them faithfully and polish them.

| Aspect | Choice |
| :---- | :---- |
| Business | Campus café |
| Products (cost / reference) | Flat white €1.20 / €2.80; Toastie €2.00 / €4.50; Brownie €0.70 / €1.80 |
| Visual identity | Warm cream background, coffee-brown and terracotta accents, rounded corners, soft shadows, a serif heading font stack (system fonts only, with fallbacks) |
| Light/dark | Light by default; also supports `prefers-color-scheme: dark` with a tasteful dark palette |
| Layout | A card per product with large controls; a "day chalkboard" showing days 1 to 5 as five steps |
| Buying | Quantity stepper with `-` / `+` buttons and a "Buy" button; shows total cost live |
| Setting prices | Typed price field with small `-` / `+` nudge buttons (10 cent steps) |
| Demand rule display | A friendly always-visible "How customers decide" panel with a small three-step illustration drawn in CSS/SVG |
| Daily report | Styled like a till receipt (itemised lines, total, "thanks for trading\!") |
| History | A row of five day "chips" you can click to reopen each day's receipt |
| Final screen | A "Final results" card with a short, encouraging message that depends on gain, loss or break-even |
| New run confirmation | Modal dialog (use the native `<dialog>` element), default focus on Cancel |
| Error messages | Friendly, first person ("Oops, you only have €12.40 left.") |
| Keyboard | Standard tab order; Enter submits the focused control |
| Save key / file naming | `brew-and-byte:run:v1` |
| Microcopy and naming | Domain names like `Shop`, `Till`, `Shelf` in UI code |

The behaviour behind these choices must follow the rules in Section 4 exactly. Only presentation, wording, structure and naming are a matter of design.

### 7.2 Structure

- Layers: `src/domain/` (pure rules), `src/storage/` (persistence), `src/ui/` (screen). The domain imports nothing from the other two.  
- Money in integer cents; persistence rules in Section 6\.  
- Scripts in `package.json`: `dev`, `build`, `preview`, `test`, `test:e2e`, `lint`, `format:check`, `typecheck`.  
- No frameworks, no CDNs, no runtime network requests; works offline after build.

### 7.3 Quality requirements for the interface

- Responsive down to a 360 px wide phone and up to wide desktop screens.  
- Accessible: semantic HTML, every input has a visible label, errors and results announced through `aria-live` regions, visible keyboard focus, colour contrast at WCAG AA or better, controls usable by keyboard alone, respects `prefers-reduced-motion`.  
- Controls that are not allowed (after day 5, or when a value is invalid) are **genuinely disabled** in the interface *and* refused by the domain.  
- A first-time player understands what to do within seconds: an obvious "next step" cue (for example, a highlighted **Open for the day** button once they have stock and prices).  
- A short "How to play" section, and the demand rule on screen at all times.

### 7.4 Tooling and testing

- Unit tests with `vitest` for domain and storage (run `spec/acceptance.json`).  
- End-to-end tests with `playwright` (headless Chromium) driving the real interface.  
- Accessibility scan with `@axe-core/playwright` (zero serious or critical issues) and a mobile viewport smoke test.  
- Property-style randomised tests with `fast-check` (seeded).

---

## 8\. Specification and test vectors

Create `spec/` containing:

- `spec/catalogue.json`: the Brew & Byte catalogue (cents).  
- `spec/acceptance.json`: machine-readable scenarios A1 to A6 and the extra cases below, as data (initial state, action sequence, expected state or expected error). The `vitest` suite loads this file and runs every case, so the behaviour is defined by data and not only by hand-written tests.  
- `spec/RULES.md`: the rules and decisions in Section 4 in plain language.

### Test cases that must exist (at minimum)

**From the brief**

- A1: buy 10 at €2 \-\> cash €80, stock 10; extra €82 purchase rejected, state unchanged.  
- A2: reference €4: prices €4 / €4.01 / €8 / €8.01 \-\> demand 10 / 5 / 5 / 0\. Prices 0, \-1, \-0.01 rejected.  
- A3: €80 cash, 10 units at €2, price €4, others out of stock \-\> revenue €40, COGS €20, gross profit €20, cash €120, stock 0\.  
- A4: stock 3 with demand 10 \-\> sells 3; stock 0 \-\> sells 0; stock never negative.  
- A5: complete a day, "restart" (reload from storage into a fresh process / page reload), compare all state; exactly one history record.  
- A6: complete 5 days; buy/price/trade are refused; new run with confirm \-\> €100, zero stock, day 1, empty history; cancel \-\> previous run intact.

**Additional edge cases**

- Buy exactly all remaining cash (cash becomes 0, allowed). Buy 1 cent over (rejected).  
- Quantity 0, negative, fractional (`2.5`), non-numeric, very large (overflow safe), whitespace.  
- Price with 3 decimals, comma decimal separator handling (decide and document: accept `4,50` or reject consistently), leading/trailing spaces, huge values.  
- Demand boundary at exactly 2x reference for odd cent values (e.g. reference €1.50 \-\> €3.00 sells 5, €3.01 sells 0).  
- Multi-product day where some products sell out and some do not; totals equal sum of lines.  
- Zero-stock trade advances the day and records a zero-sales `DayResult`.  
- Unsold stock carries forward; carried stock sells on later days.  
- Price set to 0 demand tier (above 2x): zero revenue, stock retained.  
- Full five-day scripted playthrough with hand-calculated expected final result (document the arithmetic in a comment).  
- Reconciliation: overall gain/loss equals final cash \+ remaining stock at purchase cost \- €100, computed independently from the recorded action log (not from the code under test), and equals the sum of daily gross profits minus the cost of stock still unsold.  
- Corrupted save file (invalid JSON, wrong types, negative cash, unknown product, history longer than 5\) is handled safely, never crashes, never replays.  
- Save is not written on rejected actions (assert write count / file mtime / storage calls).  
- Atomicity: simulate failure between "compute" and "save" and show no partial state is observable.  
- Property-style randomised tests (seeded, using `fast-check`): any random sequence of valid and invalid actions preserves all invariants from Section 5\.

**End-to-end (Playwright)**

- Full playthrough through the real UI to the final screen.  
- A5 via real page reload mid-run (`page.reload()`); history has exactly one record for the completed day.  
- A6 via the real confirmation dialog: cancel preserves, confirm resets.  
- Disabled controls after day 5\.  
- Keyboard-only run of buy \+ trade.  
- Basic automated accessibility check (`@axe-core/playwright`) with zero serious or critical violations.  
- Mobile viewport smoke test.

---

## 9\. Definition of Done (do not finish until all are true)

1. Every requirement CT01 to CT05, every rule CT R1 to CT R5, and every scenario A1 to A6 is implemented and **proven by passing tests** that you actually ran. Show the test output.  
2. `spec/acceptance.json` runs green.  
3. Domain coverage is effectively complete (aim for 100% line and branch on `src/domain/`; explain any exclusion). Overall coverage target \>= 90%.  
4. Lint, format check and type checks pass with zero warnings (`tsc --noEmit`, `eslint`, `prettier --check`).  
5. A clean clone can be set up and run by following the README exactly. **Actually verify this** from a fresh directory.  
6. CI (GitHub Actions) runs lint, typecheck, unit tests and end-to-end tests on push and pull request, and passes.  
7. The app has been built (`npm run build`) and run in a real headless browser through Playwright for a complete five-day run including a page reload mid-run.  
8. Screenshots of the key screens (desktop and a 360 px mobile width) are saved in `docs/screenshots/`.  
9. No secrets, no `node_modules`, no build output are committed.  
10. The **explainability pack** (Section 11\) exists and is accurate.  
11. A final self-review has been performed against the brief, line by line, and any gap is fixed or explicitly listed in `docs/KNOWN_LIMITATIONS.md`.

---

## 10\. Repository layout

brew-and-byte/

├── README.md                    \# what it is, how to run, how to test, screenshots

├── CAMPUS\_TYCOON\_CONTEXT.md     \# this file (keep it)

├── package.json

├── index.html

├── .gitignore                   \# node\_modules, dist, coverage, playwright reports, caches

├── .github/workflows/ci.yml

├── spec/

│   ├── RULES.md

│   ├── acceptance.json

│   └── catalogue.json

├── src/{domain,storage,ui}/

├── tests/                       \# vitest

├── e2e/                         \# playwright

└── docs/

    ├── DECISIONS.md             \# Section 4 decisions with reasons

    ├── EXPLAINED.md             \# explainability pack (Section 11\)

    ├── TESTING.md               \# how acceptance scenarios map to tests

    ├── KNOWN\_LIMITATIONS.md

    └── screenshots/

---

## 11\. Explainability pack (required by the course rule)

The student must be able to explain and verify everything. Produce `docs/EXPLAINED.md` in **plain, accessible language with clear analogies, avoiding academic or overly technical framing**. It should contain:

1. **The big picture** in one page: what the game is, the three layers (rules, saving, screen) and why they are separate (analogy: the rulebook, the notebook, and the shop window).  
2. **A guided tour of every file**: what it does and why it exists, in a sentence or two each.  
3. **Each rule traced to code**: a table mapping CT R1 to R5 and CT01 to CT05 to the exact function and test that implements and checks it.  
4. **Why cents instead of euros with decimals**, with a tiny worked example showing the bug it prevents (e.g. how `0.1 + 0.2` misleads, and how €4.01 would break the demand boundary).  
5. **How "save and resume" works** and how the day is never counted twice.  
6. **How to verify it yourself**: the exact commands to run tests, play the game, and what a pass looks like; plus five "break it on purpose" experiments the student can try (e.g. change a threshold and watch which test fails).  
7. **Likely questions and model answers** for a code review in week 8 (e.g. "Why is the demand function pure?", "What happens if the save file is corrupted?", "How do you know money never goes negative?").  
8. **A glossary** of every term used, in everyday words.

Also keep code **readable first**: small functions, descriptive names, brief comments explaining *why* (not *what*), no clever one-liners, no unnecessary dependencies.

---

---

## 12\. Working rules for the session

**Process**

1. Start by reading this whole file. Then create a plan (`docs/PLAN.md`) with milestones, and keep it updated.  
2. Initialise git first. **Commit early and often** with clear, conventional messages (`feat:`, `test:`, `docs:`, `chore:`). Push to GitHub regularly (cloud sessions can be temporary; unpushed work can be lost).  
3. Work in this order: `spec/` \-\> domain \+ tests \-\> storage \-\> UI \-\> end-to-end tests \-\> CI \-\> docs \-\> final verification.  
4. **Test-first for the domain**: write tests from the acceptance scenarios and the edge cases, watch them fail, then implement.  
5. After each milestone, run the full test suite and report results honestly. If something fails, fix it; do not weaken a test to make it pass and do not claim success without running it.  
6. Do not add features beyond the brief (no random events, upgrades, competitors, accounts, payments, external APIs, LLM features). Ideas go under "Future work" in the README. Meet the required behaviour fully before any polish.  
7. When the brief is ambiguous, follow Section 4\. If a new ambiguity appears, choose the simplest reasonable option, document it in `docs/DECISIONS.md`, and continue rather than stopping to ask.  
8. Keep dependencies minimal and pin versions. No telemetry, no network calls at runtime.

**Quality bar**

- Correctness first, then clarity, then polish.  
- No dead code, no commented-out code, no TODOs left behind.  
- Meaningful error messages written for a player, not a programmer.  
- Consistent formatting enforced by tools.  
- The README lets a first-time visitor understand, run and test the project in under five minutes, with screenshots.

**Budget guidance**

- Spend freely on verification: full suites, Playwright runs, a fresh-clone setup check, and a final line-by-line review against Section 3\.  
- Do not waste budget on large rewrites or on features outside scope.  
- If budget runs low, prioritise: (1) domain and persistence correct and tested, (2) working, accessible interface with end-to-end tests, (3) design polish, (4) explainability pack, (5) extras. Always leave the repo committed, pushed and working.

---

## 13\. Final deliverable summary (report back with this)

When finished, reply with:

- How to run it (exact commands).  
- A table mapping A1 to A6 (and CT01 to CT05, CT R1 to R5) to the tests that prove them, with pass results.  
- Coverage numbers and lint/type results.  
- The CI status.  
- Any decisions made on ambiguities and anything listed under known limitations.  
- Confirmation that the repo is pushed and a fresh clone works.