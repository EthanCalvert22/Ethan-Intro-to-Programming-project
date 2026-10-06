import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Catalogue } from "../../src/domain/catalogue";
import { findRunProblem } from "../../src/domain/invariants";
import type { Outcome } from "../../src/domain/result";
import { RUN_LENGTH_DAYS, STARTING_CASH_CENTS } from "../../src/domain/rules";
import { buy, newRun, setPrice, summary, tradeDay, type Run } from "../../src/domain/run";
import { briefMenu, cafe } from "../helpers";

/** Fixed seed so a failure can always be reproduced exactly. */
const SEED = 20260929;

type Action =
  | { kind: "buy"; productId: string; quantity: number }
  | { kind: "price"; productId: string; priceCents: number }
  | { kind: "trade" };

function actionArbitrary(catalogue: Catalogue): fc.Arbitrary<Action> {
  const productId = fc.oneof(
    { weight: 9, arbitrary: fc.constantFrom(...catalogue.map((product) => product.id)) },
    { weight: 1, arbitrary: fc.constant("not-on-the-menu") },
  );
  // A mix of sensible and nonsense numbers, so both accepted and rejected actions happen.
  const quantity = fc.oneof(
    fc.integer({ min: 1, max: 30 }),
    fc.integer({ min: -5, max: 2000 }),
    fc.double({ min: -10, max: 10, noNaN: false }),
  );
  const priceCents = fc.oneof(
    fc.integer({ min: 1, max: 1500 }),
    fc.integer({ min: -100, max: 200000 }),
    fc.double({ min: -5, max: 5, noNaN: false }),
  );
  return fc.oneof(
    fc.record({ kind: fc.constant("buy" as const), productId, quantity }),
    fc.record({ kind: fc.constant("price" as const), productId, priceCents }),
    fc.record({ kind: fc.constant("trade" as const) }),
  );
}

function apply(run: Run, catalogue: Catalogue, action: Action): Outcome<Run> {
  switch (action.kind) {
    case "buy":
      return buy(run, catalogue, action.productId, action.quantity);
    case "price":
      return setPrice(run, catalogue, action.productId, action.priceCents);
    case "trade":
      return tradeDay(run, catalogue);
  }
}

/** Cash plus everything on the shelf valued at what it cost. */
function worth(run: Run, catalogue: Catalogue): number {
  return catalogue.reduce(
    (total, product) => total + (run.stock[product.id] ?? 0) * product.unitCostCents,
    run.cashCents,
  );
}

function checkInvariants(run: Run, catalogue: Catalogue): void {
  expect(findRunProblem(run, catalogue)).toBeNull();
  expect(run.cashCents).toBeGreaterThanOrEqual(0);
  for (const product of catalogue) {
    expect(run.stock[product.id]).toBeGreaterThanOrEqual(0);
    expect(run.prices[product.id]).toBeGreaterThan(0);
  }
  expect(run.history.length).toBeLessThanOrEqual(RUN_LENGTH_DAYS);
  const daysCompleted = run.status === "completed" ? RUN_LENGTH_DAYS : run.currentDay - 1;
  expect(run.history.length).toBe(daysCompleted);
}

describe.each([
  ["the Brew & Byte menu", cafe],
  ["the brief's menu", briefMenu],
])("random action sequences on %s", (_name, catalogue) => {
  it("keep every invariant, and rejected actions change nothing", () => {
    fc.assert(
      fc.property(fc.array(actionArbitrary(catalogue), { maxLength: 60 }), (actions) => {
        let run = newRun(catalogue);
        let profitSoFar = 0;
        for (const action of actions) {
          const before = structuredClone(run);
          const outcome = apply(run, catalogue, action);
          // The run we passed in is never modified, accepted or not.
          expect(run).toEqual(before);
          if (!outcome.ok) {
            continue;
          }
          const after = outcome.value;
          checkInvariants(after, catalogue);
          if (action.kind === "trade") {
            const day = after.history[after.history.length - 1]!;
            // Across a trade, cash + stock at cost changes by exactly the gross profit.
            expect(worth(after, catalogue) - worth(run, catalogue)).toBe(
              day.totals.grossProfitCents,
            );
            expect(after.history.length).toBe(run.history.length + 1);
            profitSoFar += day.totals.grossProfitCents;
          } else {
            // Buying swaps cash for stock of the same value; pricing moves no money at all.
            expect(worth(after, catalogue)).toBe(worth(run, catalogue));
            expect(after.history).toEqual(run.history);
          }
          run = after;
        }
        const result = summary(run, catalogue);
        expect(result.gainLossCents).toBe(profitSoFar);
        expect(result.finalCashCents - STARTING_CASH_CENTS).toBe(
          profitSoFar - result.remainingStockValueCents,
        );
      }),
      { seed: SEED, numRuns: 400 },
    );
  });

  it("always reaches a completed run after exactly five trades, whatever happens in between", () => {
    fc.assert(
      fc.property(
        fc.array(
          actionArbitrary(catalogue).filter((action) => action.kind !== "trade"),
          {
            maxLength: 10,
          },
        ),
        (setup) => {
          let run = newRun(catalogue);
          for (let day = 1; day <= RUN_LENGTH_DAYS; day += 1) {
            for (const action of setup) {
              const outcome = apply(run, catalogue, action);
              run = outcome.ok ? outcome.value : run;
            }
            expect(run.status).toBe("in_progress");
            const traded = tradeDay(run, catalogue);
            expect(traded.ok).toBe(true);
            run = traded.ok ? traded.value : run;
          }
          expect(run.status).toBe("completed");
          expect(run.currentDay).toBe(RUN_LENGTH_DAYS);
          expect(tradeDay(run, catalogue).ok).toBe(false);
        },
      ),
      { seed: SEED, numRuns: 200 },
    );
  });
});
