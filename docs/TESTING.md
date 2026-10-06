# Testing

There are three layers of tests. All of them run in CI on every push and pull request.

| Layer             | Tool                                     | Where                                       | What it proves                                                                                                   |
| ----------------- | ---------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Acceptance data   | Vitest                                   | `tests/acceptance.test.ts`                  | Every case in `spec/acceptance.json` (A1–A6 plus E1–E12 and input tables) behaves as written.                    |
| Unit and property | Vitest, fast-check (seeded)              | `tests/domain`, `tests/storage`, `tests/ui` | Each rule, each refusal, saving and loading, the screen code (in jsdom), and invariants under random play.       |
| End-to-end        | Playwright (headless Chromium), axe-core | `e2e/`                                      | The real production build, driven like a player: full run, reload, dialog, keyboard, accessibility, phone width. |

## Commands

```bash
npm test            # unit + acceptance tests with coverage (fails under the coverage thresholds)
npm run test:e2e    # builds the app, serves it, and runs the Playwright suite
npm run lint        # ESLint, zero warnings allowed
npm run format:check
npm run typecheck   # tsc --noEmit
npm run screenshots # regenerates docs/screenshots
```

## How `spec/acceptance.json` runs

`tests/acceptance.test.ts` reads the file and, for every scenario:

1. Builds the starting run (a fresh run, plus any `start` overrides) and checks it obeys every invariant.
2. Opens the same `Shop` the app uses, over a stand-in for `localStorage` that **counts writes**.
3. Runs each step and checks the expected outcome. Automatically, for every step:
   - a refused step must leave the run identical **and write nothing**;
   - an accepted step must write **exactly once**, and storage must then hold exactly the run on screen;
   - a `restart` step opens a brand-new `Shop` from storage alone and checks the run is identical (no replay);
   - the run must still pass `findRunProblem` (all invariants).
4. Checks any `state`, `day` (receipt), `demand` and `summary` expectations listed in the step.

It also runs the `demandCases`, `priceInputCases` and `quantityInputCases` tables.

## Brief → tests

### Acceptance scenarios

| Scenario                      | Data-driven (`spec/acceptance.json`)             | Unit tests                                                                                                 | End-to-end (`e2e/`)                                                                                    |
| ----------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **A1** Purchase within budget | `A1`, `E1`, `E2`                                 | `run.test.ts` › buy (CT02) › A1 (×2), exact cash, 1 cent over                                              | `rules.spec.ts` › A1                                                                                   |
| **A2** Demand boundaries      | `demandCases` (A2 rows), `A2`, `priceInputCases` | `demand.test.ts` › A2; `run.test.ts` › refuses price 0 / -1 / -100                                         | `rules.spec.ts` › A2                                                                                   |
| **A3** Reconcile a day        | `A3`                                             | `run.test.ts` › tradeDay › A3                                                                              | `rules.spec.ts` › A3/A4; `playthrough.spec.ts` (receipt totals)                                        |
| **A4** Stock limits sales     | `A4`, `E6`                                       | `run.test.ts` › tradeDay › A4                                                                              | `rules.spec.ts` › A3/A4                                                                                |
| **A5** Resume without replay  | `A5` (two `restart` steps)                       | `shop.test.ts` › A5; `runStore.test.ts` › never writes while loading; `app.test.ts` › restores a saved run | `resume.spec.ts` › A5 (three real `page.reload()`s); `playthrough.spec.ts` reload mid-run              |
| **A6** Complete and restart   | `A6`, `E11`                                      | `run.test.ts` › A6; `app.test.ts` › starting a new run                                                     | `newRun.spec.ts` › A6 (real `<dialog>`: Cancel, Escape, confirm); `playthrough.spec.ts` › switched off |

### Capabilities

| Capability               | Proven by                                                                                                                                                 |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CT01** Manage a run    | `run.test.ts` › newRun; `app.test.ts` › first visit, chalkboard; `newRun.spec.ts` (confirmation); `playthrough.spec.ts` (day/cash/stock shown throughout) |
| **CT02** Purchase stock  | `run.test.ts` › buy (CT02); acceptance `A1`, `E1`–`E3`; `app.test.ts` › buying stock; `rules.spec.ts` › A1 and bad quantities                             |
| **CT03** Set prices      | `run.test.ts` › setPrice (CT03); acceptance `A2`, `E4`; `app.test.ts` › setting prices; `rules.spec.ts` › A2, nudges, typed price                         |
| **CT04** Trade one day   | `run.test.ts` › tradeDay; acceptance `A3`, `A4`, `E5`–`E9`; `app.test.ts` › trading; `playthrough.spec.ts`                                                |
| **CT05** Review progress | `run.test.ts` › summary; acceptance `A6`, `E11`, `E12`; `app.test.ts` › the end of the run; `playthrough.spec.ts` (final card, chips)                     |

### Business rules

| Rule                      | Proven by                                                                                                                                                                                    |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CT R1** Demand          | `demand.test.ts` (all tiers, boundaries, odd references, purity); acceptance `demandCases`, `E5`, `E9`                                                                                       |
| **CT R2** Sales and stock | `run.test.ts` › A4; acceptance `A4`, `E6`, `E7`, `E8`; property test (stock never negative)                                                                                                  |
| **CT R3** Money           | `input.test.ts`; acceptance `priceInputCases`, `quantityInputCases`, `E1`–`E4`; property test (cash never negative, all values whole cents)                                                  |
| **CT R4** Results         | `run.test.ts` › A3, "does not take the cost of stock out of the till a second time", summary; `playthrough.test.ts` (independent reconciliation); property test (gain = sum of gross profit) |
| **CT R5** Day progression | `run.test.ts` › "advances exactly one day…", "completes the run after day five…"; acceptance `A5`, `E7`; property test "exactly five trades"; `shop.test.ts` › atomic                        |

### Additional edge cases from the context file

| Edge case                                                                            | Where                                                                                                                               |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Buy exactly all cash; 1 cent over                                                    | acceptance `E1`, `E2`; `run.test.ts`                                                                                                |
| Quantity 0, negative, `2.5`, non-numeric, huge, whitespace                           | acceptance `E3`, `quantityInputCases`; `run.test.ts` › refuses quantity …; `input.test.ts`                                          |
| Price with 3 decimals, comma, spaces, huge                                           | acceptance `E4`, `priceInputCases`; `input.test.ts`                                                                                 |
| 2× boundary for odd references (€1.50 → €3.00 / €3.01)                               | `demandCases`; acceptance `E5`; `demand.test.ts`                                                                                    |
| Multi-product day; totals = sum of lines                                             | acceptance `E6`; `run.test.ts` › lists products in menu order…; `findRunProblem` checks totals                                      |
| Zero-stock trade advances the day                                                    | acceptance `E7`; `rules.spec.ts` › A3/A4                                                                                            |
| Unsold stock carries forward                                                         | acceptance `E8`                                                                                                                     |
| Priced above 2×: no revenue, stock kept                                              | acceptance `E9`                                                                                                                     |
| Full five-day run with hand-calculated result                                        | `tests/domain/playthrough.test.ts` (arithmetic in the comment); acceptance `E11`; `e2e/playthrough.spec.ts`                         |
| Reconciliation from an independent action log                                        | `playthrough.test.ts` › reconciles against the action log; property test (gain = Σ gross profit, cash change = Σ GP − unsold stock) |
| Corrupted saves (bad JSON, wrong types, negative cash, unknown product, > 5 days, …) | `saveFormat.test.ts` (26 cases); `shop.test.ts` › damaged; `app.test.ts`; `rules.spec.ts` › damaged save                            |
| No save on rejected actions                                                          | every refused step in `acceptance.test.ts`; `shop.test.ts` › does not write anything…; `app.test.ts`                                |
| Atomicity (failure between compute and save)                                         | `shop.test.ts` › is atomic…, does not half-apply…; `app.test.ts` › keeps everything as it was when the day cannot be saved          |
| Random sequences preserve invariants                                                 | `properties.test.ts` (fast-check, seed `20260929`, 400 + 200 runs per menu)                                                         |

### End-to-end list

| Requirement                               | Spec                                                                                   |
| ----------------------------------------- | -------------------------------------------------------------------------------------- |
| Full playthrough to the final screen      | `playthrough.spec.ts` › a full five-day run…                                           |
| A5 with real `page.reload()` mid-run      | `playthrough.spec.ts`, `resume.spec.ts`                                                |
| A6 with the real confirmation dialog      | `newRun.spec.ts`                                                                       |
| Disabled controls after day 5             | `playthrough.spec.ts` › after day five…                                                |
| Keyboard-only buy and trade               | `keyboard.spec.ts`                                                                     |
| axe-core: zero serious or critical issues | `accessibility.spec.ts` (start, invalid price, receipt, final, dialog; light and dark) |
| Mobile viewport smoke test (360 px)       | `mobile.spec.ts`                                                                       |

## Latest results

Recorded from the final verification run (see the README for how to reproduce).

- **Unit + acceptance:** 13 files, **299 tests passed**, 0 failed.
- **Coverage:** `src/domain/` **100 %** statements, branches, functions and lines (every file). Overall: 100 % statements, 100 % lines, 100 % functions, 98.9 % branches. The thresholds in `vite.config.ts` fail the run if `src/domain/` drops below 100 % or the total below 90 %.
- **End-to-end:** **22 tests passed** in headless Chromium against the production build.
- **Lint / format / types:** `eslint --max-warnings 0`, `prettier --check` and `tsc --noEmit` all clean.

The few uncovered branches outside the domain are defensive fallbacks that cannot happen through normal use: `main.ts` when the page has no `#app` element, an unexpected (non-`SaveShapeError`) error while decoding a save, and the `?? productId` name fallback in two Shop messages (the product is always found once the rules have accepted the action).
