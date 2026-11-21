import { describe, expect, it } from "vitest";
import type { Outcome } from "../../src/domain/result";
import { buy, newRun, setPrice, summary, tradeDay } from "../../src/domain/run";
import { buyUpgrade } from "../../src/domain/upgrades";
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
      ["brownie", 7, 0],
    ]);
    expect(run.cashCents).toBe(10000);
    expect(buyUpgrade(run, "go-viral")).toMatchObject({
      ok: false,
      error: { kind: "UpgradeAlreadyPurchased" },
    });
    run = accepted(tradeDay(run, cafe));
    expect(run.history[2]?.lines.map((line) => line.demand)).toEqual([12, 12, 2]);
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
