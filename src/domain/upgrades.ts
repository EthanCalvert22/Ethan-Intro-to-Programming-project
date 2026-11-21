import { notAffordable, runCompleted, upgradeAlreadyBought, unknownUpgrade } from "./errors";
import { accept, refuse, type Outcome } from "./result";
import type { Run } from "./run";

/*
 * The upgrades shop: things the café can buy once per run to bring in more customers or
 * pay less for stock. Upgrade spending is real spending: it comes out of cash, so it lowers
 * the final gain or loss, exactly like a real business investment.
 */

export interface Upgrade {
  readonly id: string;
  readonly name: string;
  readonly costCents: number;
  readonly description: string;
  /** "permanent": from the day it is bought to the end of the run. "one-day": that day only. */
  readonly duration: "permanent" | "one-day";
  /** Extra customers per item while the upgrade is active (only for items that get customers). */
  readonly demandBonus: number;
}

/** The supplier rate: 85% of the usual unit cost, so 15% off. */
const SUPPLIER_RATE_PERCENT = 85;

const supplierPartnership: Upgrade = {
  id: "supplier-partnership",
  name: "Supplier Partnership",
  costCents: 2500,
  description: "15% off future stock orders for the rest of this run.",
  duration: "permanent",
  demandBonus: 0,
};

export const upgrades: readonly Upgrade[] = [
  {
    id: "loyalty-program",
    name: "Student Loyalty Program",
    costCents: 1500,
    description: "+2 customers a day for every item that already has customers.",
    duration: "permanent",
    demandBonus: 2,
  },
  {
    id: "go-viral",
    name: "Go Viral",
    costCents: 2000,
    description: "+5 customers for every item that already has customers, the next time you open.",
    duration: "one-day",
    demandBonus: 5,
  },
  supplierPartnership,
];

export function findUpgrade(upgradeId: string): Upgrade | undefined {
  return upgrades.find((upgrade) => upgrade.id === upgradeId);
}

/** Whether an upgrade is working on a given day of the run. */
export function upgradeAppliesOn(run: Run, upgrade: Upgrade, day: number): boolean {
  const boughtOn = run.upgradePurchaseDays[upgrade.id];
  if (boughtOn === undefined) {
    return false;
  }
  return upgrade.duration === "permanent" ? boughtOn <= day : boughtOn === day;
}

/** The upgrades working on a given day, in shop order. */
export function activeUpgrades(run: Run, day: number): readonly Upgrade[] {
  return upgrades.filter((upgrade) => upgradeAppliesOn(run, upgrade, day));
}

/** Extra customers per item from every upgrade working that day. */
export function upgradeBonus(run: Run, day: number): number {
  return activeUpgrades(run, day).reduce((total, upgrade) => total + upgrade.demandBonus, 0);
}

export function hasSupplierDiscount(run: Run, day = run.currentDay): boolean {
  return upgradeAppliesOn(run, supplierPartnership, day);
}

/** The discounted unit cost, rounded to the nearest cent with half a cent rounded up. */
export function supplierUnitCost(unitCostCents: number): number {
  return Math.floor((unitCostCents * SUPPLIER_RATE_PERCENT + 50) / 100);
}

/** What one unit costs to order today. */
export function orderUnitCost(run: Run, unitCostCents: number): number {
  return hasSupplierDiscount(run) ? supplierUnitCost(unitCostCents) : unitCostCents;
}

/** Buys an upgrade. It works from today's trade; each upgrade can be bought once per run. */
export function buyUpgrade(run: Run, upgradeId: string): Outcome<Run> {
  if (run.status === "completed") {
    return refuse(runCompleted());
  }
  const upgrade = findUpgrade(upgradeId);
  if (upgrade === undefined) {
    return refuse(unknownUpgrade(upgradeId));
  }
  if (run.purchasedUpgrades.includes(upgradeId)) {
    return refuse(upgradeAlreadyBought(upgrade.name));
  }
  if (upgrade.costCents > run.cashCents) {
    return refuse(notAffordable(upgrade.costCents, run.cashCents));
  }
  return accept({
    ...run,
    cashCents: run.cashCents - upgrade.costCents,
    purchasedUpgrades: [...run.purchasedUpgrades, upgradeId],
    upgradePurchaseDays: { ...run.upgradePurchaseDays, [upgradeId]: run.currentDay },
  });
}
