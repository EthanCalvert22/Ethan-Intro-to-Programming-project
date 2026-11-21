import { describe, expect, it } from "vitest";
import { newRun } from "../../src/domain/run";
import { buyUpgrade } from "../../src/domain/upgrades";
import { cafe } from "../helpers";

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
});
