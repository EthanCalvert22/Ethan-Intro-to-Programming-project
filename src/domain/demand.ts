import { FULL_DEMAND, NO_DEMAND, REDUCED_DEMAND } from "./rules";

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
