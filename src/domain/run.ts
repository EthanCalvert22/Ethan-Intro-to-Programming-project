import { findProduct, type Catalogue, type Product } from "./catalogue";
import { demandForDay } from "./demand";
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
import { hasSupplierDiscount, orderUnitCost, supplierUnitCost } from "./upgrades";

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
  readonly discountedUnitsSold?: number;
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
  /** How many of the units still on the shelf were bought at the supplier rate. */
  readonly discountedStock?: Shelf;
  readonly prices: PriceList;
  readonly history: readonly DayResult[];
  readonly purchasedUpgrades: readonly string[];
  /** Trading day when each upgrade first took effect. */
  readonly upgradePurchaseDays?: Readonly<Partial<Record<string, number>>>;
}

export interface FinalSummary {
  readonly finalCashCents: number;
  readonly remainingStockValueCents: number;
  readonly gainLossCents: number;
}

/** A fresh run: €100, an empty shelf, day 1, and every price at its reference price. */
export function newRun(catalogue: Catalogue): Run {
  return {
    version: RUN_FORMAT_VERSION,
    status: "in_progress",
    currentDay: 1,
    cashCents: STARTING_CASH_CENTS,
    stock: Object.fromEntries(catalogue.map((product) => [product.id, 0])),
    prices: Object.fromEntries(
      catalogue.map((product) => [product.id, product.referencePriceCents]),
    ),
    history: [],
    purchasedUpgrades: [],
  };
}

export function stockOf(run: Run, productId: string): number {
  return run.stock[productId] ?? 0;
}

export function priceOf(run: Run, product: Product): number {
  return run.prices[product.id] ?? product.referencePriceCents;
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
  return accept({
    ...run,
    cashCents: run.cashCents - costCents,
    stock: { ...run.stock, [productId]: stockOf(run, productId) + quantity },
    ...(hasSupplierDiscount(run) && {
      discountedStock: {
        ...run.discountedStock,
        [productId]: (run.discountedStock?.[productId] ?? 0) + quantity,
      },
    }),
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

/** What one product does today: sales are capped by stock (CT R2). */
function tradeLine(run: Run, product: Product): DayLine {
  const priceCents = priceOf(run, product);
  const wanted = demandForDay(run, run.currentDay, priceCents, product.referencePriceCents);
  const unitsSold = Math.min(wanted, stockOf(run, product.id));
  const revenueCents = unitsSold * priceCents;
  // Sell the older, full-price stock first.
  const discounted = run.discountedStock?.[product.id] ?? 0;
  const fullPriceStock = stockOf(run, product.id) - discounted;
  const discountedUnitsSold = Math.max(0, unitsSold - fullPriceStock);
  // The stock was paid for when it was bought; COGS is reported, not taken from cash again (CT R4).
  const cogsCents = inventoryCostCents(product, unitsSold, discountedUnitsSold);
  return {
    productId: product.id,
    ...(discountedUnitsSold > 0 && { discountedUnitsSold }),
    priceCents,
    demand: wanted,
    unitsSold,
    revenueCents,
    cogsCents,
    grossProfitCents: revenueCents - cogsCents,
  };
}

/** Actual cost of a mix of stock bought before and after the partnership. */
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
  const lines = catalogue.map((product) => tradeLine(run, product));
  const totals = addUp(lines);
  const cashAfterCents = run.cashCents + totals.revenueCents;
  const stockAfter: Shelf = Object.fromEntries(
    lines.map((line) => [line.productId, stockOf(run, line.productId) - line.unitsSold]),
  );
  const record: DayResult = {
    day: run.currentDay,
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
    ...(run.discountedStock !== undefined && {
      discountedStock: Object.fromEntries(
        lines.map((line) => [
          line.productId,
          (run.discountedStock?.[line.productId] ?? 0) - (line.discountedUnitsSold ?? 0),
        ]),
      ),
    }),
    history: [...run.history, record],
  });
}

/** The final picture (CT05): cash, stock left at what it cost, and the gain or loss on €100. */
export function summary(run: Run, catalogue: Catalogue): FinalSummary {
  const remainingStockValueCents = catalogue.reduce(
    (total, product) =>
      total +
      inventoryCostCents(product, stockOf(run, product.id), run.discountedStock?.[product.id] ?? 0),
    0,
  );
  return {
    finalCashCents: run.cashCents,
    remainingStockValueCents,
    gainLossCents: run.cashCents + remainingStockValueCents - STARTING_CASH_CENTS,
  };
}
