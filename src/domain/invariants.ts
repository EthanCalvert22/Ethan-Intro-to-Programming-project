import type { Catalogue, Product } from "./catalogue";
import { demand } from "./demand";
import { MAX_PRICE_CENTS, RUN_LENGTH_DAYS } from "./rules";
import type { DayLine, DayResult, Run, Shelf } from "./run";

/*
 * The promises a run must always keep. The tests check them after every action,
 * and the save loader uses them to refuse a save file that breaks any of them.
 * Each check returns a short explanation, or null when everything is fine.
 */

function isWholeAtLeast(value: number, minimum: number): boolean {
  return Number.isSafeInteger(value) && value >= minimum;
}

function checkEveryProductListed(
  record: Readonly<Record<string, number>>,
  catalogue: Catalogue,
  what: string,
  isValid: (value: number) => boolean,
): string | null {
  const ids = Object.keys(record);
  if (ids.length !== catalogue.length || catalogue.some((product) => !ids.includes(product.id))) {
    return `${what} must list exactly the products on the menu.`;
  }
  const bad = catalogue.find((product) => !isValid(record[product.id] as number));
  return bad === undefined ? null : `${what} for ${bad.name} is not valid.`;
}

function checkShelf(shelf: Shelf, catalogue: Catalogue, what: string): string | null {
  return checkEveryProductListed(shelf, catalogue, what, (units) => isWholeAtLeast(units, 0));
}

function checkLine(line: DayLine, product: Product): string | null {
  if (line.productId !== product.id) {
    return `a receipt line is for the wrong product.`;
  }
  if (!isWholeAtLeast(line.priceCents, 1)) {
    return `the price of ${product.name} is not valid.`;
  }
  if (line.demand !== demand(line.priceCents, product.referencePriceCents)) {
    return `the demand for ${product.name} does not follow the rule.`;
  }
  if (!isWholeAtLeast(line.unitsSold, 0) || line.unitsSold > line.demand) {
    return `the units sold of ${product.name} are not possible.`;
  }
  if (line.revenueCents !== line.unitsSold * line.priceCents) {
    return `the revenue for ${product.name} does not add up.`;
  }
  if (line.cogsCents !== line.unitsSold * product.unitCostCents) {
    return `the cost of goods sold for ${product.name} does not add up.`;
  }
  if (line.grossProfitCents !== line.revenueCents - line.cogsCents) {
    return `the gross profit for ${product.name} does not add up.`;
  }
  return null;
}

function checkTotals(day: DayResult): string | null {
  const sum = (pick: (line: DayLine) => number) =>
    day.lines.reduce((total, line) => total + pick(line), 0);
  const matches =
    day.totals.unitsSold === sum((line) => line.unitsSold) &&
    day.totals.revenueCents === sum((line) => line.revenueCents) &&
    day.totals.cogsCents === sum((line) => line.cogsCents) &&
    day.totals.grossProfitCents === sum((line) => line.grossProfitCents);
  return matches ? null : "the totals do not match the lines.";
}

function checkDay(day: DayResult, position: number, catalogue: Catalogue): string | null {
  const label = `Day ${position + 1}`;
  if (day.day !== position + 1) {
    return `${label} is recorded out of order.`;
  }
  if (day.lines.length !== catalogue.length) {
    return `${label} does not have one line per product.`;
  }
  for (const [index, product] of catalogue.entries()) {
    const problem = checkLine(day.lines[index] as DayLine, product);
    if (problem !== null) {
      return `${label}: ${problem}`;
    }
  }
  const totalsProblem = checkTotals(day);
  if (totalsProblem !== null) {
    return `${label}: ${totalsProblem}`;
  }
  if (!isWholeAtLeast(day.cashAfterCents, 0)) {
    return `${label}: the cash after trading is not valid.`;
  }
  return checkShelf(day.stockAfter, catalogue, `${label}: stock after trading`);
}

function checkProgress(run: Run): string | null {
  if (
    !Number.isSafeInteger(run.currentDay) ||
    run.currentDay < 1 ||
    run.currentDay > RUN_LENGTH_DAYS
  ) {
    return `The current day must be between 1 and ${RUN_LENGTH_DAYS}.`;
  }
  if (run.history.length > RUN_LENGTH_DAYS) {
    return `There are more than ${RUN_LENGTH_DAYS} days of history.`;
  }
  if (run.status === "completed") {
    const finished = run.history.length === RUN_LENGTH_DAYS && run.currentDay === RUN_LENGTH_DAYS;
    return finished ? null : "A completed run must have all five days recorded.";
  }
  return run.history.length === run.currentDay - 1
    ? null
    : "The history does not match the current day.";
}

/** Returns the first broken promise in a run, or null if the run is sound. */
export function findRunProblem(run: Run, catalogue: Catalogue): string | null {
  if (!isWholeAtLeast(run.cashCents, 0)) {
    return "Cash must be a whole number of cents, zero or more.";
  }
  const problem =
    checkProgress(run) ??
    checkShelf(run.stock, catalogue, "Stock") ??
    checkEveryProductListed(
      run.prices,
      catalogue,
      "The price",
      (price) => isWholeAtLeast(price, 1) && price <= MAX_PRICE_CENTS,
    );
  if (problem !== null) {
    return problem;
  }
  for (const [position, day] of run.history.entries()) {
    const dayProblem = checkDay(day, position, catalogue);
    if (dayProblem !== null) {
      return dayProblem;
    }
  }
  return null;
}
