import { notAffordable, runCompleted } from "./errors";
import { accept, refuse, type Outcome } from "./result";
import type { Run } from "./run";

export interface Upgrade {
  readonly id: string;
  name: string;
  costCents: number;
  description: string;
  duration: "permanent" | "one-day";
  demandBonus: number;
}

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
    description: "+2 daily demand per product.",
    duration: "permanent",
    demandBonus: 2,
  },
  {
    id: "go-viral",
    name: "Go Viral",
    costCents: 2000,
    description: "+5 demand per product the next time you open for trade.",
    duration: "one-day",
    demandBonus: 5,
  },
  supplierPartnership,
];

export function hasSupplierDiscount(run: Run, day = run.currentDay): boolean {
  return upgradeAppliesOn(run, supplierPartnership, day);
}

/** Round the discounted price per unit to the nearest cent, with half cents rounded up. */
export function supplierUnitCost(unitCostCents: number): number {
  return Math.round((unitCostCents * 85) / 100);
}

export function orderUnitCost(run: Run, unitCostCents: number): number {
  return hasSupplierDiscount(run) ? supplierUnitCost(unitCostCents) : unitCostCents;
}

export function buyUpgrade(run: Run, upgradeId: string): Outcome<Run> {
  if (run.status === "completed") {
    return refuse(runCompleted());
  }

  const upgrade = findUpgrade(upgradeId);

  if (!upgrade) {
    return refuse({ kind: "UnknownUpgrade", message: "Upgrade not found." });
  }

  if (run.purchasedUpgrades.includes(upgradeId)) {
    return refuse({ kind: "UpgradeAlreadyPurchased", message: "Upgrade already purchased." });
  }

  if (run.cashCents < upgrade.costCents) {
    return refuse(notAffordable(upgrade.costCents, run.cashCents));
  }

  return accept({
    ...run,
    cashCents: run.cashCents - upgrade.costCents,
    purchasedUpgrades: [...run.purchasedUpgrades, upgradeId],
    upgradePurchaseDays: { ...run.upgradePurchaseDays, [upgradeId]: run.currentDay },
  });
}

export function findUpgrade(upgradeId: string): Upgrade | undefined {
  return upgrades.find((upgrade) => upgrade.id === upgradeId);
}

export function upgradeAppliesOn(run: Run, upgrade: Upgrade, day: number): boolean {
  const purchasedOn = run.upgradePurchaseDays?.[upgrade.id];
  return (
    purchasedOn !== undefined &&
    (upgrade.duration === "permanent" ? purchasedOn <= day : purchasedOn === day)
  );
}
