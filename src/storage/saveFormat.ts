import type { Catalogue } from "../domain/catalogue";
import { findRunProblem } from "../domain/invariants";
import { RUN_FORMAT_VERSION } from "../domain/rules";
import type { DayLine, DayResult, DayTotals, Run, Shelf } from "../domain/run";

/*
 * Reading a saved run back safely. Saved text is treated as untrusted: it is parsed,
 * upgraded to the current format if needed, checked field by field, and finally checked
 * against the game's rules. Anything odd is reported, never thrown.
 */

export type ReadOutcome =
  { readonly ok: true; readonly run: Run } | { readonly ok: false; readonly problem: string };

/** Signals a malformed save while decoding; caught in readSave and turned into a message. */
class SaveShapeError extends Error {}

type Fields = Readonly<Record<string, unknown>>;

function asFields(value: unknown, what: string): Fields {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SaveShapeError(`${what} is not in the expected format.`);
  }
  return value as Fields;
}

function asNumber(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new SaveShapeError(`${what} is not a number.`);
  }
  return value;
}

function asList(value: unknown, what: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new SaveShapeError(`${what} is not a list.`);
  }
  return value;
}

function asNumberMap(value: unknown, what: string): Shelf {
  const fields = asFields(value, what);
  return Object.fromEntries(
    Object.entries(fields).map(([key, entry]) => [key, asNumber(entry, `${what} for ${key}`)]),
  );
}

function decodeLine(value: unknown, what: string): DayLine {
  const fields = asFields(value, what);
  if (typeof fields.productId !== "string") {
    throw new SaveShapeError(`${what} has no product.`);
  }
  return {
    productId: fields.productId,
    priceCents: asNumber(fields.priceCents, `${what} price`),
    demand: asNumber(fields.demand, `${what} demand`),
    unitsSold: asNumber(fields.unitsSold, `${what} units sold`),
    revenueCents: asNumber(fields.revenueCents, `${what} revenue`),
    cogsCents: asNumber(fields.cogsCents, `${what} cost of goods`),
    grossProfitCents: asNumber(fields.grossProfitCents, `${what} gross profit`),
  };
}

function decodeTotals(value: unknown, what: string): DayTotals {
  const fields = asFields(value, what);
  return {
    unitsSold: asNumber(fields.unitsSold, `${what} units sold`),
    revenueCents: asNumber(fields.revenueCents, `${what} revenue`),
    cogsCents: asNumber(fields.cogsCents, `${what} cost of goods`),
    grossProfitCents: asNumber(fields.grossProfitCents, `${what} gross profit`),
  };
}

function decodeDay(value: unknown, position: number): DayResult {
  const what = `Day ${position + 1} in the history`;
  const fields = asFields(value, what);
  return {
    day: asNumber(fields.day, `${what} number`),
    lines: asList(fields.lines, `${what} lines`).map((line, index) =>
      decodeLine(line, `${what}, line ${index + 1}`),
    ),
    totals: decodeTotals(fields.totals, `${what} totals`),
    cashAfterCents: asNumber(fields.cashAfterCents, `${what} cash`),
    stockAfter: asNumberMap(fields.stockAfter, `${what} stock`),
  };
}

function decodeRun(fields: Fields): Run {
  if (fields.status !== "in_progress" && fields.status !== "completed") {
    throw new SaveShapeError("The run status is not recognised.");
  }
  return {
    version: RUN_FORMAT_VERSION,
    status: fields.status,
    currentDay: asNumber(fields.currentDay, "The current day"),
    cashCents: asNumber(fields.cashCents, "Cash"),
    stock: asNumberMap(fields.stock, "Stock"),
    prices: asNumberMap(fields.prices, "Prices"),
    history: asList(fields.history, "The history").map(decodeDay),
  };
}

/**
 * Brings older save formats up to date. Version 1 is the only format so far; a future
 * version 2 would add a step here that turns a version 1 save into a version 2 save.
 */
export function migrate(data: unknown): Fields {
  const fields = asFields(data, "The save");
  const version = fields.version;
  if (version === RUN_FORMAT_VERSION) {
    return fields;
  }
  if (typeof version === "number" && version > RUN_FORMAT_VERSION) {
    throw new SaveShapeError("The save was made by a newer version of Brew & Byte.");
  }
  throw new SaveShapeError("The save has no recognisable version.");
}

/** Turns saved text back into a run, or explains in plain words why it cannot. */
export function readSave(text: string, catalogue: Catalogue): ReadOutcome {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, problem: "The save is not readable (it is not valid JSON)." };
  }
  let run: Run;
  try {
    run = decodeRun(migrate(data));
  } catch (error) {
    const problem =
      error instanceof SaveShapeError ? error.message : "The save is not in the expected format.";
    return { ok: false, problem };
  }
  const problem = findRunProblem(run, catalogue);
  return problem === null ? { ok: true, run } : { ok: false, problem };
}

/** The exact text written to storage for a run: the whole run as one JSON value. */
export function writeSave(run: Run): string {
  return JSON.stringify(run);
}
