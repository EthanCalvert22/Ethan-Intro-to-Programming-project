import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { scheduleFromSeed } from "../../src/domain/events";
import type { Outcome } from "../../src/domain/result";
import { buy, newRun, setPrice, summary, tradeDay, type Run } from "../../src/domain/run";
import { weekStats } from "../../src/domain/stats";
import { buyUpgrade, upgrades } from "../../src/domain/upgrades";
import { cafe } from "../helpers";

function accepted(outcome: Outcome<Run>): Run {
  if (!outcome.ok) {
    throw new Error(outcome.error.message);
  }
  return outcome.value;
}

describe("weekStats", () => {
  it("is empty before the first trade", () => {
    expect(weekStats(newRun(cafe), cafe)).toEqual({
      days: [],
      totalUnitsSold: 0,
      totalRevenueCents: 0,
      totalGrossProfitCents: 0,
      upgradeSpendCents: 0,
      resultSoFarCents: 0,
      bestSeller: null,
      bestDay: null,
    });
  });

  it("adds up the days, finds the best seller and the best day", () => {
    let run = accepted(buy(newRun(cafe), cafe, "toastie", 12));
    run = accepted(buy(run, cafe, "brownie", 15));
    run = accepted(tradeDay(run, cafe));
    run = accepted(tradeDay(run, cafe));
    const stats = weekStats(run, cafe);
    // Day 1: 10 toasties (GP 2500) + 10 brownies (GP 1100) = 3600. Day 2: 2 toasties (500) + 5 brownies (550) = 1050.
    expect(stats.days.map((day) => day.grossProfitCents)).toEqual([3600, 1050]);
    expect(stats.totalGrossProfitCents).toBe(4650);
    expect(stats.totalUnitsSold).toBe(27);
    expect(stats.bestSeller).toEqual({ productId: "brownie", units: 15 });
    expect(stats.bestDay).toEqual({ day: 1, grossProfitCents: 3600 });
    expect(stats.resultSoFarCents).toBe(summary(run, cafe).gainLossCents);
  });

  it("breaks ties: the item first on the menu, and the earlier day", () => {
    let run = accepted(buy(newRun(cafe), cafe, "flat-white", 5));
    run = accepted(buy(run, cafe, "toastie", 5));
    run = accepted(tradeDay(run, cafe));
    run = accepted(tradeDay(run, cafe));
    const stats = weekStats(run, cafe);
    expect(stats.bestSeller).toEqual({ productId: "flat-white", units: 5 });
    expect(stats.bestDay?.day).toBe(1);
  });

  it("has no best seller when nothing has sold yet", () => {
    const run = accepted(tradeDay(newRun(cafe), cafe));
    expect(weekStats(run, cafe).bestSeller).toBeNull();
    expect(weekStats(run, cafe).bestDay).toEqual({ day: 1, grossProfitCents: 0 });
  });

  it("subtracts what upgrades cost from the result so far", () => {
    let run = accepted(buyUpgrade(newRun(cafe), "loyalty-program"));
    run = accepted(buy(run, cafe, "toastie", 12));
    run = accepted(tradeDay(run, cafe));
    const stats = weekStats(run, cafe);
    expect(stats.upgradeSpendCents).toBe(1500);
    // 12 toastie customers (10 + 2 loyalty): GP 12 x 250 = 3000, minus the €15 upgrade.
    expect(stats.resultSoFarCents).toBe(3000 - 1500);
    expect(stats.resultSoFarCents).toBe(summary(run, cafe).gainLossCents);
  });

  it("always agrees with the final summary (seeded random test)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2 ** 32 - 1 }),
        fc.array(
          fc.oneof(
            fc.record({
              kind: fc.constant("buy" as const),
              productId: fc.constantFrom(...cafe.map((product) => product.id)),
              quantity: fc.integer({ min: 1, max: 25 }),
            }),
            fc.record({
              kind: fc.constant("price" as const),
              productId: fc.constantFrom(...cafe.map((product) => product.id)),
              priceCents: fc.integer({ min: 50, max: 1200 }),
            }),
            fc.record({
              kind: fc.constant("upgrade" as const),
              upgradeId: fc.constantFrom(...upgrades.map((upgrade) => upgrade.id)),
            }),
            fc.record({ kind: fc.constant("trade" as const) }),
          ),
          { maxLength: 40 },
        ),
        (seed, actions) => {
          let run = newRun(cafe, scheduleFromSeed(seed));
          for (const action of actions) {
            const outcome =
              action.kind === "buy"
                ? buy(run, cafe, action.productId, action.quantity)
                : action.kind === "price"
                  ? setPrice(run, cafe, action.productId, action.priceCents)
                  : action.kind === "upgrade"
                    ? buyUpgrade(run, action.upgradeId)
                    : tradeDay(run, cafe);
            run = outcome.ok ? outcome.value : run;
            const stats = weekStats(run, cafe);
            expect(stats.resultSoFarCents).toBe(summary(run, cafe).gainLossCents);
            expect(stats.days).toHaveLength(run.history.length);
          }
        },
      ),
      { seed: 20261123, numRuns: 200 },
    );
  });
});
