import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { scheduleFromSeed } from "../../src/domain/events";
import { findRunProblem } from "../../src/domain/invariants";
import type { Outcome } from "../../src/domain/result";
import { buy, newRun, setPrice, summary, tradeDay, type Run } from "../../src/domain/run";
import { buyUpgrade, findUpgrade, upgrades } from "../../src/domain/upgrades";
import { cafe } from "../helpers";

function accepted<T>(outcome: Outcome<T>): T {
  if (!outcome.ok) throw new Error(outcome.error.message);
  return outcome.value;
}

describe("Upgrades Shop", () => {
  it("allows purchasing an affordable upgrade", () => {
    const run = newRun(cafe);
    const result = buyUpgrade(run, "loyalty-program");

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.value.cashCents).toBe(8500);
      expect(result.value.purchasedUpgrades).toContain("loyalty-program");
    }
  });

  it("prevents buying the same upgrade twice", () => {
    const run = newRun(cafe);
    const first = buyUpgrade(run, "loyalty-program");

    expect(first.ok).toBe(true);

    if (first.ok) {
      const second = buyUpgrade(first.value, "loyalty-program");
      expect(second.ok).toBe(false);
    }
  });

  it("rejects upgrades when cash is insufficient", () => {
    const run = {
      ...newRun(cafe),
      cashCents: 1000,
    };

    const result = buyUpgrade(run, "loyalty-program");

    expect(result.ok).toBe(false);
    expect(run.cashCents).toBe(1000);
  });

  it("adds both bonuses to each product, keeps the stock cap and expires Go Viral after the trade", () => {
    let run = accepted(tradeDay(newRun(cafe), cafe));
    run = accepted(buyUpgrade(run, "loyalty-program"));
    run = accepted(buyUpgrade(run, "go-viral"));
    expect(run.cashCents).toBe(6500);
    run = accepted(buy(run, cafe, "toastie", 14));
    run = accepted(setPrice(run, cafe, "brownie", 361));
    run = accepted(tradeDay(run, cafe));
    expect(run.history[0]?.lines.every((line) => line.demand === 10)).toBe(true);
    expect(
      run.history[1]?.lines.map((line) => [line.productId, line.demand, line.unitsSold]),
    ).toEqual([
      ["flat-white", 17, 0],
      ["toastie", 17, 14],
      // Brownie is priced above twice its fair price, so it has no customers for the bonus
      // to add to (Viktoria's decision: bonuses only add to items that already have customers).
      ["brownie", 0, 0],
    ]);
    expect(run.cashCents).toBe(10000);
    expect(buyUpgrade(run, "go-viral")).toMatchObject({
      ok: false,
      error: { kind: "UpgradeAlreadyPurchased" },
    });
    run = accepted(tradeDay(run, cafe));
    expect(run.history[2]?.lines.map((line) => line.demand)).toEqual([12, 12, 0]);
  });

  it("rejects an unknown upgrade and purchases after the run is over", () => {
    let run = newRun(cafe);
    expect(buyUpgrade(run, "fake")).toMatchObject({ ok: false, error: { kind: "UnknownUpgrade" } });
    for (let day = 1; day <= 5; day += 1) {
      run = accepted(tradeDay(run, cafe));
    }
    expect(buyUpgrade(run, "go-viral")).toMatchObject({
      ok: false,
      error: { kind: "RunCompleted" },
    });
  });

  it("charges the supplier rate on future orders and values mixed stock at actual cost", () => {
    let run = accepted(buy(newRun(cafe), cafe, "toastie", 4));
    run = accepted(buyUpgrade(run, "supplier-partnership"));
    expect(run.cashCents).toBe(6700);
    expect(summary(run, cafe).remainingStockValueCents).toBe(800);
    run = accepted(buy(run, cafe, "toastie", 9));
    expect(run.cashCents).toBe(5170);
    run = accepted(tradeDay(run, cafe));
    expect(run.history[0]?.lines[1]).toMatchObject({
      demand: 10,
      unitsSold: 10,
      discountedUnitsSold: 6,
      cogsCents: 1820,
      grossProfitCents: 2680,
    });
    expect(summary(run, cafe)).toEqual({
      finalCashCents: 9670,
      remainingStockValueCents: 510,
      gainLossCents: 180,
    });
    run = accepted(buy(run, cafe, "brownie", 3));
    expect(run.cashCents).toBe(9490); // €0.595 rounds to €0.60 per Brownie.
    run = accepted(tradeDay(run, cafe));
    expect(run.history[1]?.lines[1]?.cogsCents).toBe(510);
    expect(run.history[1]?.lines[2]?.cogsCents).toBe(180);
    expect(summary(run, cafe).remainingStockValueCents).toBe(0);
  });

  it("checks affordability against the discounted price and refuses duplicate purchases", () => {
    const upgraded = accepted(buyUpgrade(newRun(cafe), "supplier-partnership"));
    expect(buyUpgrade(upgraded, "supplier-partnership").ok).toBe(false);
    const run = { ...upgraded, cashCents: 170 };
    expect(buy(run, cafe, "toastie", 2).ok).toBe(false);
    expect(accepted(buy(run, cafe, "toastie", 1)).cashCents).toBe(0);
  });
});

describe("upgrades together with campus events (Viktoria's decisions)", () => {
  const week = ["exam-week", "big-match", "ordinary-day", "ordinary-day", "ordinary-day"];

  it("applies the event first, then adds the bonus: exam week 15 + loyalty 2 = 17", () => {
    let run = accepted(buyUpgrade(newRun(cafe, week), "loyalty-program"));
    run = accepted(buy(run, cafe, "flat-white", 20));
    run = accepted(tradeDay(run, cafe));
    expect(run.history[0]?.lines[0]).toMatchObject({ demand: 17, unitsSold: 17 });
  });

  it("a big match halves the usual customers, and the bonus still adds its full amount", () => {
    let run = accepted(buyUpgrade(newRun(cafe, week), "loyalty-program"));
    run = accepted(tradeDay(run, cafe));
    run = accepted(tradeDay(run, cafe));
    // 10 x 0.5 = 5, then +2 = 7.
    expect(run.history[1]?.lines.map((line) => line.demand)).toEqual([7, 7, 7]);
  });

  it("never brings customers to an item priced above twice its fair price, even with every bonus", () => {
    let run = accepted(buyUpgrade(newRun(cafe, week), "loyalty-program"));
    run = accepted(buyUpgrade(run, "go-viral"));
    run = accepted(setPrice(run, cafe, "toastie", 901));
    run = accepted(tradeDay(run, cafe));
    expect(run.history[0]?.lines.map((line) => line.demand)).toEqual([22, 0, 22]);
  });
});

describe("random games with events and upgrades (seeded property test)", () => {
  it("keep every promise, and money only moves the way the rules say", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2 ** 32 - 1 }),
        fc.array(
          fc.oneof(
            fc.record({
              kind: fc.constant("buy" as const),
              productId: fc.constantFrom(...cafe.map((product) => product.id)),
              quantity: fc.integer({ min: -1, max: 30 }),
            }),
            fc.record({
              kind: fc.constant("price" as const),
              productId: fc.constantFrom(...cafe.map((product) => product.id)),
              priceCents: fc.integer({ min: -5, max: 1200 }),
            }),
            fc.record({
              kind: fc.constant("upgrade" as const),
              upgradeId: fc.constantFrom(...upgrades.map((upgrade) => upgrade.id), "fake"),
            }),
            fc.record({ kind: fc.constant("trade" as const) }),
          ),
          { maxLength: 40 },
        ),
        (seed, actions) => {
          let run = newRun(cafe, scheduleFromSeed(seed));
          const worth = (state: Run) => summary(state, cafe).gainLossCents;
          for (const action of actions) {
            const outcome =
              action.kind === "buy"
                ? buy(run, cafe, action.productId, action.quantity)
                : action.kind === "price"
                  ? setPrice(run, cafe, action.productId, action.priceCents)
                  : action.kind === "upgrade"
                    ? buyUpgrade(run, action.upgradeId)
                    : tradeDay(run, cafe);
            if (!outcome.ok) {
              continue;
            }
            const after = outcome.value;
            expect(findRunProblem(after, cafe)).toBeNull();
            const change = worth(after) - worth(run);
            if (action.kind === "trade") {
              // Trading changes the result by exactly the day's gross profit.
              expect(change).toBe(after.history[after.history.length - 1]?.totals.grossProfitCents);
            } else if (action.kind === "upgrade") {
              // An upgrade is spending: the result drops by exactly its cost.
              expect(change).toBe(-(findUpgrade(action.upgradeId)?.costCents ?? 0));
            } else {
              // Buying stock swaps cash for stock at what it cost; pricing moves no money.
              expect(change).toBe(0);
            }
            run = after;
          }
        },
      ),
      { seed: 20261122, numRuns: 300 },
    );
  });
});
