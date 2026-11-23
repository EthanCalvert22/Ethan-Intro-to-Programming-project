import { findProduct, type Catalogue, type Product } from "./catalogue";
import {
  CLASSIC_WEEK,
  demandOnDay,
  effectPercent,
  findEvent,
  ORDINARY_DAY,
  type CampusEvent,
} from "./events";
import {
  invalidPrice,
  invalidQuantity,
  notAffordable,
  runCompleted,
  unknownProduct,
} from "./errors";
import { accept, refuse, type Outcome } from "./result";
import {
  MAX_ORDER_QUANTITY,
  MAX_PRICE_CENTS,
  RUN_FORMAT_VERSION,
  RUN_LENGTH_DAYS,
  STARTING_CASH_CENTS,
} from "./rules";
import { hasSupplierDiscount, orderUnitCost, supplierUnitCost, upgradeBonus } from "./upgrades";

/*
 * The rulebook. Every function here is pure: it takes a run and returns a new run
 * (or the reason it refused). Nothing here touches storage, the screen or the clock.
 */

export type RunStatus = "in_progress" | "completed";

/** Units per product id. */
export type Shelf = Readonly<Record<string, number>>;

/** Selling price in cents per product id. */
export type PriceList = Readonly<Record<string, number>>;

export interface DayLine {
  readonly productId: string;
  /** How many of the units sold were bought at the supplier rate (they cost less). */
  readonly discountedUnitsSold: number;
  readonly priceCents: number;
  readonly demand: number;
  readonly unitsSold: number;
  readonly revenueCents: number;
  readonly cogsCents: number;
  readonly grossProfitCents: number;
}

export interface DayTotals {
  readonly unitsSold: number;
  readonly revenueCents: number;
  readonly cogsCents: number;
  readonly grossProfitCents: number;
}

/** One completed trading day: the till receipt plus the balances right after it. */
export interface DayResult {
  readonly day: number;
  /** The campus event that was on that day. */
  readonly eventId: string;
  readonly lines: readonly DayLine[];
  readonly totals: DayTotals;
  readonly cashAfterCents: number;
  readonly stockAfter: Shelf;
}

/**
 * The whole game state. currentDay is the day about to be traded (1 to 5).
 * After the fifth trade the status becomes "completed" and currentDay stays at 5.
 */
export interface Run {
  readonly version: typeof RUN_FORMAT_VERSION;
  readonly status: RunStatus;
  readonly currentDay: number;
  readonly cashCents: number;
  readonly stock: Shelf;
  /** How many of the units on the shelf were bought at the supplier rate. */
  readonly discountedStock: Shelf;
  readonly prices: PriceList;
  /** The campus event for each of the five days, chosen when the run starts. */
  readonly events: readonly string[];
  readonly history: readonly DayResult[];
  /** Upgrade ids bought this run, in the order they were bought. */
  readonly purchasedUpgrades: readonly string[];
  /** The day each upgrade was bought, which is the first day it works. */
  readonly upgradePurchaseDays: Readonly<Partial<Record<string, number>>>;
}

export interface FinalSummary {
  readonly finalCashCents: number;
  readonly remainingStockValueCents: number;
  readonly gainLossCents: number;
}

/**
 * A fresh run: €100, an empty shelf, day 1, and every price at its reference price.
 * Without a week of events it is the classic week: five ordinary days, the original rules.
 */
export function newRun(catalogue: Catalogue, events: readonly string[] = CLASSIC_WEEK): Run {
  return {
    version: RUN_FORMAT_VERSION,
    status: "in_progress",
    currentDay: 1,
    cashCents: STARTING_CASH_CENTS,
    stock: Object.fromEntries(catalogue.map((product) => [product.id, 0])),
    discountedStock: Object.fromEntries(catalogue.map((product) => [product.id, 0])),
    prices: Object.fromEntries(
      catalogue.map((product) => [product.id, product.referencePriceCents]),
    ),
    events: [...events],
    history: [],
    purchasedUpgrades: [],
    upgradePurchaseDays: {},
  };
}

export function stockOf(run: Run, productId: string): number {
  return run.stock[productId] ?? 0;
}

export function discountedStockOf(run: Run, productId: string): number {
  return run.discountedStock[productId] ?? 0;
}

/**
 * How many customers want an item on a day: the price picks the tier (10, 5 or 0), the day's
 * campus event scales it, and then active upgrades add their bonus. Bonuses only add to items
 * that already have customers, so an item priced above twice its fair price still sells nothing.
 */
export function customersFor(run: Run, product: Product, priceCents: number, day: number): number {
  const event = eventFor(run, day);
  const usual = demandOnDay(
    priceCents,
    product.referencePriceCents,
    effectPercent(event, product.id),
  );
  return usual === 0 ? 0 : usual + upgradeBonus(run, day);
}

/** What units really cost: discounted ones at the supplier rate, the rest at the usual cost. */
export function inventoryCostCents(
  product: Product,
  units: number,
  discountedUnits: number,
): number {
  return (
    (units - discountedUnits) * product.unitCostCents +
    discountedUnits * supplierUnitCost(product.unitCostCents)
  );
}

export function priceOf(run: Run, product: Product): number {
  return run.prices[product.id] ?? product.referencePriceCents;
}

/** The campus event on a day of this run (an ordinary day if the run has none for it). */
export function eventFor(run: Run, day: number): CampusEvent {
  const eventId = run.events[day - 1];
  return (eventId === undefined ? undefined : findEvent(eventId)) ?? ORDINARY_DAY;
}

export function daysCompleted(run: Run): number {
  return run.history.length;
}

export function isComplete(run: Run): boolean {
  return run.status === "completed";
}

/** Buys stock (CT02). Cash and stock change together, or not at all. */
export function buy(
  run: Run,
  catalogue: Catalogue,
  productId: string,
  quantity: number,
): Outcome<Run> {
  if (isComplete(run)) {
    return refuse(runCompleted());
  }
  const product = findProduct(catalogue, productId);
  if (product === undefined) {
    return refuse(unknownProduct(productId));
  }
  if (!Number.isInteger(quantity)) {
    return refuse(invalidQuantity("notWhole"));
  }
  if (quantity < 1) {
    return refuse(invalidQuantity("tooFew"));
  }
  if (quantity > MAX_ORDER_QUANTITY) {
    return refuse(invalidQuantity("tooMany"));
  }
  const costCents = quantity * orderUnitCost(run, product.unitCostCents);
  if (costCents > run.cashCents) {
    return refuse(notAffordable(costCents, run.cashCents));
  }
  const discountedBought = hasSupplierDiscount(run) ? quantity : 0;
  return accept({
    ...run,
    cashCents: run.cashCents - costCents,
    stock: { ...run.stock, [productId]: stockOf(run, productId) + quantity },
    discountedStock: {
      ...run.discountedStock,
      [productId]: discountedStockOf(run, productId) + discountedBought,
    },
  });
}

/** Sets a selling price in whole cents (CT03). It stays until it is changed again. */
export function setPrice(
  run: Run,
  catalogue: Catalogue,
  productId: string,
  priceCents: number,
): Outcome<Run> {
  if (isComplete(run)) {
    return refuse(runCompleted());
  }
  if (findProduct(catalogue, productId) === undefined) {
    return refuse(unknownProduct(productId));
  }
  if (!Number.isInteger(priceCents)) {
    return refuse(invalidPrice("tooPrecise"));
  }
  if (priceCents <= 0) {
    return refuse(invalidPrice("notPositive"));
  }
  if (priceCents > MAX_PRICE_CENTS) {
    return refuse(invalidPrice("tooHigh"));
  }
  return accept({ ...run, prices: { ...run.prices, [productId]: priceCents } });
}

/** What one product does today: the event scales demand, and sales are capped by stock (CT R2). */
function tradeLine(run: Run, product: Product): DayLine {
  const priceCents = priceOf(run, product);
  const wanted = customersFor(run, product, priceCents, run.currentDay);
  const unitsSold = Math.min(wanted, stockOf(run, product.id));
  const revenueCents = unitsSold * priceCents;
  // Older, full-price stock sells first; discounted units only once it has run out.
  const fullPriceStock = stockOf(run, product.id) - discountedStockOf(run, product.id);
  const discountedUnitsSold = Math.max(0, unitsSold - fullPriceStock);
  // The stock was paid for when it was bought; COGS is reported, not taken from cash again (CT R4).
  const cogsCents = inventoryCostCents(product, unitsSold, discountedUnitsSold);
  return {
    productId: product.id,
    discountedUnitsSold,
    priceCents,
    demand: wanted,
    unitsSold,
    revenueCents,
    cogsCents,
    grossProfitCents: revenueCents - cogsCents,
  };
}

function addUp(lines: readonly DayLine[]): DayTotals {
  return lines.reduce<DayTotals>(
    (totals, line) => ({
      unitsSold: totals.unitsSold + line.unitsSold,
      revenueCents: totals.revenueCents + line.revenueCents,
      cogsCents: totals.cogsCents + line.cogsCents,
      grossProfitCents: totals.grossProfitCents + line.grossProfitCents,
    }),
    { unitsSold: 0, revenueCents: 0, cogsCents: 0, grossProfitCents: 0 },
  );
}

/**
 * Trades exactly one day (CT04, CT R5): works out every line, adds the revenue to the till,
 * takes the sold units off the shelf, records the day, and moves to the next day, all in one step.
 */
export function tradeDay(run: Run, catalogue: Catalogue): Outcome<Run> {
  if (isComplete(run)) {
    return refuse(runCompleted());
  }
  const event = eventFor(run, run.currentDay);
  const lines = catalogue.map((product) => tradeLine(run, product));
  const totals = addUp(lines);
  const cashAfterCents = run.cashCents + totals.revenueCents;
  const stockAfter: Shelf = Object.fromEntries(
    lines.map((line) => [line.productId, stockOf(run, line.productId) - line.unitsSold]),
  );
  const record: DayResult = {
    day: run.currentDay,
    eventId: event.id,
    lines,
    totals,
    cashAfterCents,
    stockAfter,
  };
  const isLastDay = run.currentDay >= RUN_LENGTH_DAYS;
  return accept({
    ...run,
    status: isLastDay ? "completed" : "in_progress",
    currentDay: isLastDay ? run.currentDay : run.currentDay + 1,
    cashCents: cashAfterCents,
    stock: stockAfter,
    discountedStock: Object.fromEntries(
      lines.map((line) => [
        line.productId,
        discountedStockOf(run, line.productId) - line.discountedUnitsSold,
      ]),
    ),
    history: [...run.history, record],
  });
}

/** The final picture (CT05): cash, stock left at what it cost, and the gain or loss on €100. */
export function summary(run: Run, catalogue: Catalogue): FinalSummary {
  const remainingStockValueCents = catalogue.reduce(
    (total, product) =>
      total +
      inventoryCostCents(product, stockOf(run, product.id), discountedStockOf(run, product.id)),
    0,
  );
  return {
    finalCashCents: run.cashCents,
    remainingStockValueCents,
    gainLossCents: run.cashCents + remainingStockValueCents - STARTING_CASH_CENTS,
  };
}
