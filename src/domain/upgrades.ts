
import type { Run } from "./run";

export interface Upgrade {
  id: string;
  name: string;
  costCents: number;
  description: string;
  duration: "permanent" | "one-day";
  demandBonus: number;
}

export const upgrades: Upgrade[] = [
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
    description: "+5 demand per product for one day.",
    duration: "one-day",
    demandBonus: 5,
  },
];

export function buyUpgrade(
  run: Run,
  upgradeId: string,
): { ok: true; value: Run } | { ok: false; message: string } {
  if (run.status === "completed") {
    return { ok: false, message: "The game is already finished." };
  }

  const upgrade = upgrades.find((item) => item.id === upgradeId);

  if (!upgrade) {
    return { ok: false, message: "Upgrade not found." };
  }

  if (run.purchasedUpgrades?.includes(upgradeId)) {
    return { ok: false, message: "Upgrade already purchased." };
  }

  if (run.cashCents < upgrade.costCents) {
    return { ok: false, message: "Not enough money." };
  }

  return {
    ok: true,
    value: {
      ...run,
      cashCents: run.cashCents - upgrade.costCents,
      purchasedUpgrades: [...(run.purchasedUpgrades ?? []), upgradeId],
    },
  };
}
