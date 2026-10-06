/** The fixed numbers of the game, in one place so they are easy to find and explain. */

/** Every run starts with €100.00 in the till. */
export const STARTING_CASH_CENTS = 10000;

/** A run lasts five trading days. */
export const RUN_LENGTH_DAYS = 5;

/** Customers per day at or below the reference price. */
export const FULL_DEMAND = 10;

/** Customers per day above the reference price, up to twice it. */
export const REDUCED_DEMAND = 5;

/** Customers per day above twice the reference price. */
export const NO_DEMAND = 0;

/** The largest single order, so totals stay small, exact whole numbers. */
export const MAX_ORDER_QUANTITY = 1000;

/** The highest price the till accepts (€1,000.00); anything above 2x reference sells nothing anyway. */
export const MAX_PRICE_CENTS = 100000;

/** The shape version of a saved run, so the save format can evolve later. */
export const RUN_FORMAT_VERSION = 1;
