import { FULL_DEMAND, NO_DEMAND, REDUCED_DEMAND } from "./rules";
import type { Run } from "./run";
import { upgradeAppliesOn, upgrades } from "./upgrades";

export type Demand = typeof FULL_DEMAND | typeof REDUCED_DEMAND | typeof NO_DEMAND;

/**
 * How many customers want an item today (rule CT R1).
 * Both values are whole cents, so €4.01 against €4.00 is an exact comparison.
 */
export function demand(priceCents: number, referenceCents: number): Demand {
  if (priceCents <= referenceCents) {
    return FULL_DEMAND;
  }
  if (priceCents <= 2 * referenceCents) {
    return REDUCED_DEMAND;
  }
  return NO_DEMAND;
}

/** The same calculation for a shelf preview, a trade, and a saved receipt. */
export function demandForDay(
  run: Run,
  day: number,
  priceCents: number,
  referenceCents: number,
): number {
  return upgrades.reduce<number>(
    (wanted, upgrade) => wanted + (upgradeAppliesOn(run, upgrade, day) ? upgrade.demandBonus : 0),
    demand(priceCents, referenceCents),
  );
}
