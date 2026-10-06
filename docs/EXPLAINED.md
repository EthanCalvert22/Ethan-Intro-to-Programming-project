# Brew & Byte, explained

This guide explains the whole project in everyday language: what it does, how each part works, and how to check it yourself. You do not need to read the code first.

---

## 1. The big picture

**The game.** You run a small campus café for five days. You start with €100 and an empty shelf. Each day you buy stock (flat whites, toasties, brownies), choose your prices, and press **Open for the day**. Customers decide whether your prices are fair, you sell what you can, and the till prints a receipt. After day five you see whether you made or lost money.

**Three layers, like a real shop.**

| Layer      | Folder         | Analogy             | Its one job                                                                                        |
| ---------- | -------------- | ------------------- | -------------------------------------------------------------------------------------------------- |
| The rules  | `src/domain/`  | **The rulebook**    | Says what happens: what a purchase costs, how many customers come, what a day earns. Nothing else. |
| Saving     | `src/storage/` | **The notebook**    | Writes the game down in the browser, and reads it back carefully when you return.                  |
| The screen | `src/ui/`      | **The shop window** | Shows everything and passes your clicks to the rules.                                              |

**Why keep them apart?** The rulebook never looks at the notebook or the window. That means:

- it can be tested on its own, quickly, with exact numbers (no browser needed);
- the same rule can never behave differently on different screens;
- if the save file is damaged, the rules are not affected: the notebook simply reports the problem.

One small class, the **Shop** (`src/ui/shop.ts`), sits at the counter between the window and the rulebook. When you click Buy, the Shop asks the rulebook for the new state of the café, asks the notebook to save it, and only then shows it. If either says no, nothing changes.

```
 click ─▶ Shop ─▶ rulebook: "what happens?" ─▶ new café state (or "no, because…")
                 │
                 └▶ notebook: "write it down" ─▶ saved? ─▶ show it   (not saved? ─▶ change nothing, explain)
```

---

## 2. A guided tour of every file

### Root

| File                                  | What it is, and why it exists                                                                                    |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `README.md`                           | The front door: what the game is, how to run it and test it, screenshots.                                        |
| `CAMPUS_TYCOON_CONTEXT.md`            | The full brief and build instructions this project follows.                                                      |
| `package.json` / `package-lock.json`  | The list of tools (with exact versions) and the named commands (`npm test`, `npm run dev`, …).                   |
| `.npmrc`                              | Tells npm to always save exact versions, so nothing changes by surprise.                                         |
| `index.html`                          | The single web page. It contains an empty `<div id="app">` that the code fills in.                               |
| `tsconfig.json`                       | TypeScript settings. `strict` mode is on, so many mistakes are caught before the code runs.                      |
| `vite.config.ts`                      | Settings for Vite (which builds the app) and Vitest (which runs the tests), including the coverage targets.      |
| `eslint.config.js`                    | Code-style and safety rules. It also forbids the rulebook from using randomness, the clock, or the screen.       |
| `.prettierrc.json`, `.prettierignore` | Formatting rules, so all code is laid out the same way.                                                          |
| `playwright.config.ts`                | Settings for the browser tests: build the app, serve it, and drive Chromium.                                     |
| `playwright.screenshots.config.ts`    | Same, but only for the script that takes the README screenshots.                                                 |
| `.gitignore`                          | Keeps generated folders (`node_modules`, `dist`, `coverage`, reports) out of git.                                |
| `.github/workflows/ci.yml`            | Continuous integration: on every push, GitHub runs lint, format check, type check, unit tests and browser tests. |

### `spec/` — the specification

| File                   | What it is                                                                                                        |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `spec/catalogue.json`  | The menu: three items, each with a unit cost and a reference ("fair") price, in cents. The app reads it directly. |
| `spec/acceptance.json` | The brief's scenarios A1–A6 and twelve extra cases, written as data: start, actions, expected results.            |
| `spec/RULES.md`        | Every rule in plain English.                                                                                      |

### `src/domain/` — the rulebook (pure: no saving, no screen, no clock, no randomness)

| File            | What it does                                                                                                                                               |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rules.ts`      | The fixed numbers in one place: €100 start, 5 days, demand of 10/5/0, order limit 1,000, price ceiling €1,000.                                             |
| `catalogue.ts`  | Describes a product and checks the menu file at startup (3+ products, unique ids, positive whole cents).                                                   |
| `demand.ts`     | One small function: given a price and a reference price, how many customers want the item today (10, 5 or 0).                                              |
| `run.ts`        | The heart of the game: `newRun`, `buy`, `setPrice`, `tradeDay`, `summary`. Each takes the current café and returns a new one, or a refusal.                |
| `errors.ts`     | The five reasons the café can say no (`NotAffordable`, `InvalidQuantity`, `InvalidPrice`, `UnknownProduct`, `RunCompleted`), each with a friendly message. |
| `result.ts`     | The "answer envelope": either `{ ok: true, value }` or `{ ok: false, error }`. Nothing in the rulebook ever crashes on bad input.                          |
| `input.ts`      | Turns what the player typed (`"4,50"`, `" 12 "`) into whole numbers, or explains what is wrong.                                                            |
| `money.ts`      | Turns cents into text for people: `401` → `"€4.01"`, `-500` → `"-€5.00"`.                                                                                  |
| `invariants.ts` | The promises a café state must always keep (cash ≥ 0, receipts add up, history matches the day…). Used by tests and when loading a save.                   |

### `src/storage/` — the notebook

| File            | What it does                                                                                                                                                                       |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `runStore.ts`   | Saves the whole café as one entry under the key `brew-and-byte:run:v1`, loads it back, keeps a backup of a damaged save, and copes with a browser that blocks or fills up storage. |
| `saveFormat.ts` | Reads saved text safely: parses it, upgrades old formats (`migrate`), checks every field's type, then asks the rulebook's invariants.                                              |

### `src/ui/` — the shop window

| File              | What it does                                                                                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `shop.ts`         | The counter between screen and rules: performs an action, saves it, and only then makes it visible. Also decides what to do on startup (fresh, loaded, or damaged save). |
| `app.ts`          | Builds the page and keeps it up to date: the till figures, the next-step hint, the shelf, the receipts, the final card.                                                  |
| `shelfCard.ts`    | One card per product: stock count, order stepper with live total, price box with 10-cent nudges and a live demand hint.                                                  |
| `chalkboard.ts`   | The five-day "chalkboard" showing which days are done and which is next.                                                                                                 |
| `receipt.ts`      | Draws one day's results as a till receipt.                                                                                                                               |
| `demandPanel.ts`  | The always-visible "How customers decide" panel with its three-step picture.                                                                                             |
| `finalCard.ts`    | The "Final results" card with an encouraging message for a gain, a loss, or breaking even.                                                                               |
| `newRunDialog.ts` | The "Start a new run?" confirmation, using the browser's own `<dialog>`, with Cancel focused first.                                                                      |
| `dom.ts`          | A tiny helper to create page elements without a framework.                                                                                                               |
| `icons.ts`        | Small drawings (SVG) for the logo and each product. Drawn in code, so nothing is downloaded.                                                                             |
| `styles.css`      | The look: cream, coffee-brown and terracotta; dark mode; phone layout; reduced motion.                                                                                   |
| `../main.ts`      | The starting point: loads the styles and starts the app in the page.                                                                                                     |

### `tests/` and `e2e/`

| File                               | What it checks                                                                                       |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `tests/helpers.ts`                 | Shared test tools, including `CountingStorage`, a fake browser storage that counts every write.      |
| `tests/acceptance.test.ts`         | Runs everything in `spec/acceptance.json`.                                                           |
| `tests/domain/demand.test.ts`      | The demand rule and its exact boundaries.                                                            |
| `tests/domain/input.test.ts`       | Reading typed quantities and prices; money formatting.                                               |
| `tests/domain/run.test.ts`         | Buying, pricing, trading, the end of the run, the final summary.                                     |
| `tests/domain/catalogue*.test.ts`  | Menu validation, including what happens if the menu file is broken.                                  |
| `tests/domain/invariants.test.ts`  | That each kind of broken café state is caught.                                                       |
| `tests/domain/properties.test.ts`  | Thousands of random action sequences: the promises always hold.                                      |
| `tests/domain/playthrough.test.ts` | A full five-day game worked out by hand, and an independent reconciliation.                          |
| `tests/storage/*.test.ts`          | Saving, loading, damaged saves, full or blocked storage.                                             |
| `tests/ui/shop.test.ts`            | Save-then-show, no writes on refusals, atomicity when a save fails, startup paths.                   |
| `tests/ui/app.test.ts`             | The real screen code in a simulated browser: every button, message and state.                        |
| `e2e/*.spec.ts`                    | The real built app in real Chromium: full run, reloads, dialog, keyboard, accessibility scan, phone. |
| `e2e/screenshots.spec.ts`          | Takes the screenshots in `docs/screenshots/`.                                                        |

---

## 3. Each rule traced to code

| Requirement / rule                                                                                                   | Implemented in                                                                                                                        | Checked by                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **CT01** Manage a run: show day, cash, stock, progress; confirm before replacing                                     | `run.ts › newRun`, `app.ts › CafeScreen.refresh`, `chalkboard.ts`, `newRunDialog.ts`, `shop.ts › startNewRun`                         | `run.test.ts › newRun`; `app.test.ts › first visit`, `starting a new run`; `e2e/newRun.spec.ts`                    |
| **CT02** Purchase stock: positive whole quantity, show total, refuse if unaffordable, update cash and stock together | `run.ts › buy`, `input.ts › parseQuantityText`, `shelfCard.ts › refreshOrder`                                                         | `run.test.ts › buy (CT02)`; acceptance `A1`, `E1`–`E3`; `e2e/rules.spec.ts › A1`                                   |
| **CT03** Set prices: positive price, demand rule visible                                                             | `run.ts › setPrice`, `input.ts › parsePriceText`, `demandPanel.ts`, `shelfCard.ts › refreshPrice`                                     | `run.test.ts › setPrice (CT03)`; acceptance `A2`, `E4`; `e2e/rules.spec.ts › A2`                                   |
| **CT04** Trade one day: units, revenue, COGS, gross profit per item and total                                        | `run.ts › tradeDay` (with `tradeLine`, `addUp`), `receipt.ts`                                                                         | `run.test.ts › tradeDay`; acceptance `A3`, `A4`, `E5`–`E9`; `e2e/playthrough.spec.ts`                              |
| **CT05** Review progress: history, final cash, stock at cost, gain/loss, stop after day 5                            | `run.ts › summary`, `isComplete`; `finalCard.ts`; `app.ts › refreshReceipts`                                                          | `run.test.ts › summary`, `A6`; acceptance `A6`, `E11`, `E12`; `e2e/playthrough.spec.ts`                            |
| **CT R1** Demand 10 / 5 / 0                                                                                          | `demand.ts › demand`                                                                                                                  | `demand.test.ts`; acceptance `demandCases`, `E5`                                                                   |
| **CT R2** Sold = smaller of demand and stock; leftovers carry over                                                   | `run.ts › tradeLine` (`Math.min`) and `stockAfter`                                                                                    | `run.test.ts › A4`; acceptance `A4`, `E6`, `E8`                                                                    |
| **CT R3** Money in at most 2 decimals; purchases and sales change cash; never negative                               | `input.ts`, `run.ts › buy` (affordability check), `tradeDay`                                                                          | `input.test.ts`; acceptance input tables; `properties.test.ts`                                                     |
| **CT R4** Gross profit = revenue − cost of units sold; gain = cash + stock at cost − €100; no double deduction       | `run.ts › tradeLine`, `summary`                                                                                                       | `run.test.ts › "does not take the cost of stock out of the till a second time"`; `playthrough.test.ts`             |
| **CT R5** One day per trade, recorded once, never replayed on reload                                                 | `run.ts › tradeDay` (one record, one step); `runStore.ts › load` is read-only; `shop.ts › commit` saves the day and balances together | `run.test.ts › advances exactly one day…`; acceptance `A5`; `shop.test.ts › A5`, `is atomic`; `e2e/resume.spec.ts` |

---

## 4. Why cents instead of euros with decimals

Computers store numbers like `0.1` in binary, and most decimal fractions cannot be stored exactly — the same way 1/3 cannot be written exactly in decimals (0.3333…). So:

```js
0.1 + 0.2; // 0.30000000000000004, not 0.3
0.1 + 0.2 === 0.3; // false
```

**How that would break this game.** Every example below was checked in Node.js:

```js
1.1 * 3; // 3.3000000000000003
1.1 * 3 > 3.3; // true
```

Buy 3 items at €1.10 with exactly €3.30 left, and a euro-based check `cost > cash` would say you **cannot** afford it: the brief's "spending exactly all your cash" case (our test E1) would fail by a hair.

```js
4.35 * 100; // 434.99999999999994
Math.floor(4.35 * 100); // 434, one cent lost
0.7 + 0.1; // 0.7999999999999999, not 0.8
```

The same tiny errors hit the demand rule. It has to tell €4.00 (10 customers) from €4.01 (5) and €8.00 (5) from €8.01 (0). If prices were euro decimals built up by sums or multiplications, a price meant to be exactly twice the reference could land a hair above or below the line, and customers would appear or vanish for no visible reason. Totals drift too: adding 0.1 ten times gives `0.9999999999999999`, not 1.

**The fix.** Store every amount as a whole number of **cents**. `€4.01` is `401`, `€8.00` is `800`. Whole numbers are stored exactly, so `401 > 400` and `800 <= 2 × 400` are always exactly right, and every receipt adds up to the cent. Conversion only happens at the edges: when reading what you typed (`input.ts` reads `"4.01"` as text, splitting the euros and the cents, into `401` without ever making the decimal number `4.01`) and when showing an amount (`money.ts`).

---

## 5. How "save and resume" works, and why a day is never counted twice

1. **The whole café is one saved entry.** After every accepted action, the Shop writes the entire state (cash, stock, prices, current day, every receipt) as one piece of text under one key, `brew-and-byte:run:v1`. A single `localStorage.setItem` either happens completely or not at all.
2. **A day's receipt and the new balances are saved together.** `tradeDay` produces the new cash, the new stock, the next day number _and_ the receipt in one new state. That one state is written in one go, so you can never have "the money but not the receipt" or "the receipt but still on the same day".
3. **Save first, show second.** If saving fails (for example, the browser's storage is full), the Shop keeps the old state and tells you. The screen never shows something that isn't saved.
4. **Loading only reads.** When you reopen the page, the app reads the saved entry and shows it. Loading never trades, never saves and never "catches up". There is nothing to replay: the day you finished is already in the saved history, and the saved day counter already points at the next one.
5. **Saved data is checked before it's trusted.** The loader checks every field and then every rule (does the history length match the day? do the receipts add up?). A damaged save is reported on screen, kept as a backup, and only replaced if you choose to start fresh.
6. **Versioned.** Each save carries `version: 1`. If the format ever changes, `migrate` in `saveFormat.ts` is where an old save would be upgraded.

---

## 6. How to verify it yourself

### Run the checks

```bash
npm ci                 # install the exact tool versions (once)
npm test               # 299 tests; prints a coverage table. Pass = "Tests 299 passed" and no ERROR lines
npm run test:e2e       # 22 browser tests. Pass = "22 passed"
npm run lint           # no output after the command line = pass
npm run format:check   # "All matched files use Prettier code style!"
npm run typecheck      # no output = pass
```

### Play it

```bash
npm run dev            # then open the address it prints, e.g. http://localhost:5173
```

Try the brief's scenarios by hand: buy 10 toasties (€2.00 each) → cash €80.00. Type 41 → the Buy button is disabled and the message says €82.00 is more than €80.00. Open for the day, then reload the page: same cash, same day, one receipt.

### Five "break it on purpose" experiments

Make one change, run `npm test`, see what fails, then undo it with `git checkout .`.

| #   | Change                                                                                                                                                                                      | What should happen                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 1   | In `src/domain/demand.ts`, change `priceCents <= referenceCents` to `priceCents < referenceCents`.                                                                                          | The A2 demand test fails (€4.00 now gives 5, not 10), and so do A3 and the playthrough: 16 tests in total.                    |
| 2   | In `src/domain/rules.ts`, set `REDUCED_DEMAND = 6`.                                                                                                                                         | Demand tests and every scenario that sells in the middle tier fail, because the numbers no longer match the brief (18 tests). |
| 3   | In `src/domain/run.ts › tradeDay`, change `cashAfterCents = run.cashCents + totals.revenueCents` to subtract `totals.cogsCents` as well (the "double deduction" bug the brief warns about). | A3 fails (cash €100 instead of €120), along with the reconciliation and property tests (21 tests).                            |
| 4   | In `src/domain/run.ts › buy`, change `costCents > run.cashCents` to `costCents >= run.cashCents`.                                                                                           | "allows spending exactly all the cash" and acceptance E1 fail (2 tests).                                                      |
| 5   | In `src/ui/shop.ts › commit`, move `this.current = outcome.value;` above the `this.store.save(...)` call.                                                                                   | The atomicity tests fail: when saving fails, the screen would show a day that was never saved (6 tests).                      |

You can also edit `spec/acceptance.json` (for example change E11's `"gainLossCents": 12800` to `12801`) and watch exactly that scenario fail.

---

## 7. Likely questions, with model answers

**Why is the demand function pure?**
Pure means: same inputs, same output, no side effects. `demand(401, 400)` is always 5. It doesn't read the clock, a random number, or the save file. That makes it trivially testable and means the game behaves identically for everyone, as the brief requires ("no randomness").

**What happens if the save file is corrupted?**
The loader never crashes. It parses the text, checks every field's type, then checks the game's rules. If anything is wrong, the app shows "I couldn't open your saved café" with the reason, changes nothing, and offers "Start a fresh run". Only when you click it is the bad text copied to a backup key, and then a fresh run is saved. Tested with 26 kinds of damage in `tests/storage/saveFormat.test.ts`.

**How do you know money never goes negative?**
Three ways. (1) The only action that removes money is `buy`, and it refuses any order costing more than the cash. (2) `findRunProblem` checks cash ≥ 0 and is run after every step in the acceptance runner. (3) The property test plays thousands of random sequences of valid and invalid actions and checks cash ≥ 0, stock ≥ 0 and prices > 0 after each one.

**How do you know a day can't be counted twice?**
A trade produces one new state containing the receipt _and_ the advanced day, saved in one write. Reloading only reads. The A5 tests reload (in Vitest and with a real `page.reload()`) and check there is still exactly one record, and the storage write counter proves loading wrote nothing.

**Why store cents instead of euros?**
See section 4: whole numbers are exact; decimals in binary are not, which would make €4.01 vs €4.00 and totals unreliable.

**What does "atomic" mean here?**
All or nothing. Either the whole change (new cash, stock, day, receipt) is saved and shown, or none of it is. The test makes the fake storage fail at the moment of saving and checks that neither the screen nor storage changed.

**Why is Buy disabled _and_ refused by the rules?**
Disabling is for the player (clear and immediate). The rule refusing it is for safety: even if something bypassed the button, `buy` would still say no. Both are tested.

**Why is gain/loss equal to the sum of daily gross profit?**
Buying swaps cash for stock of exactly the same value (at cost), so it doesn't change "cash + stock at cost". Only trading changes it, by exactly that day's gross profit. Add up five days and you get the overall gain or loss. The tests check this with a hand-worked example and with random games.

**Why no framework (React etc.)?**
The brief asks for vanilla DOM. The screen is small: one page, a few cards. Plain DOM keeps dependencies minimal and every line explainable.

**How is it accessible?**
Semantic HTML (headings, lists, `<dialog>`, labels for every input), messages announced through `aria-live` regions, visible focus outlines, keyboard-only play, colour plus words for gains and losses, contrast checked by axe-core in light and dark themes, and reduced motion respected.

---

## 8. Glossary

| Term                               | Meaning                                                                                   |
| ---------------------------------- | ----------------------------------------------------------------------------------------- |
| **Run**                            | One five-day game, from €100 to the final results.                                        |
| **Catalogue / menu**               | The list of products for sale and their fixed numbers.                                    |
| **Unit cost**                      | What you pay the supplier for one item.                                                   |
| **Reference price ("fair price")** | The price customers think is fair; demand is measured against it.                         |
| **Selling price**                  | The price you choose.                                                                     |
| **Demand**                         | How many customers want an item today: 10, 5 or 0.                                        |
| **Stock / shelf**                  | How many of each item you have ready to sell.                                             |
| **Revenue**                        | Money taken from customers: units sold × your price.                                      |
| **Cost of goods sold (COGS)**      | What the items you sold cost you to buy: units sold × unit cost.                          |
| **Gross profit**                   | Revenue minus cost of goods sold.                                                         |
| **Gain or loss**                   | Final cash + leftover stock at cost − €100.                                               |
| **Cent**                           | One hundredth of a euro; the unit all money is stored in.                                 |
| **Domain**                         | The rules of the game, separate from saving and the screen.                               |
| **Pure function**                  | A function whose answer depends only on its inputs and that changes nothing else.         |
| **Invariant**                      | A promise that must always be true, such as "cash is never negative".                     |
| **Atomic**                         | All-or-nothing: a change happens completely or not at all.                                |
| **localStorage**                   | A small notebook each browser keeps per website; it survives closing the tab.             |
| **JSON**                           | A plain-text way of writing structured data; how the café is saved.                       |
| **Migration**                      | Upgrading an old save to a newer format.                                                  |
| **TypeScript**                     | JavaScript with types, which catches many mistakes before the code runs.                  |
| **Vite**                           | The tool that serves the app while developing and builds the final files.                 |
| **Vitest**                         | The tool that runs the unit tests.                                                        |
| **Playwright**                     | A tool that drives a real browser to test the app like a player.                          |
| **axe-core**                       | An automatic accessibility checker.                                                       |
| **fast-check**                     | A tool that generates random test cases; "seeded" means the same random cases every time. |
| **Coverage**                       | How much of the code the tests actually run.                                              |
| **ESLint / Prettier**              | Tools that check code quality and layout.                                                 |
| **CI (continuous integration)**    | GitHub running all the checks automatically on every push.                                |
| **jsdom**                          | A simulated browser used to test screen code quickly without opening Chromium.            |
| **aria-live**                      | A marker that tells screen readers to announce changes in that part of the page.          |
