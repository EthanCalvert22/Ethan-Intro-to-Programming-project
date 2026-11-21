import { describe, expect, it } from "vitest";
import type { Outcome } from "../../src/domain/result";
import { buy, newRun, setPrice, tradeDay } from "../../src/domain/run";
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
});
