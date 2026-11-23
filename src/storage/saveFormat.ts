import type { Catalogue } from "../domain/catalogue";
import { CLASSIC_WEEK, ORDINARY_DAY } from "../domain/events";
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

function asText(value: unknown, what: string): string {
  if (typeof value !== "string") {
    throw new SaveShapeError(`${what} is not in the expected format.`);
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
    discountedUnitsSold: asNumber(fields.discountedUnitsSold, `${what} discounted units`),
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
    eventId: asText(fields.eventId, `${what} event`),
    lines: asList(fields.lines, `${what} lines`).map((line, index) =>
      decodeLine(line, `${what}, line ${index + 1}`),
    ),
    totals: decodeTotals(fields.totals, `${what} totals`),
    cashAfterCents: asNumber(fields.cashAfterCents, `${what} cash`),
    stockAfter: asNumberMap(fields.stockAfter, `${what} stock`),
  };
}

function decodeUpgradeIds(value: unknown): readonly string[] {
  return asList(value, "The bought upgrades").map((id, index) =>
    asText(id, `Bought upgrade ${index + 1}`),
  );
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
    discountedStock: asNumberMap(fields.discountedStock, "Discounted stock"),
    prices: asNumberMap(fields.prices, "Prices"),
    events: asList(fields.events, "The planned events").map((eventId, index) =>
      asText(eventId, `The event for day ${index + 1}`),
    ),
    history: asList(fields.history, "The history").map(decodeDay),
    purchasedUpgrades: decodeUpgradeIds(fields.purchasedUpgrades),
    upgradePurchaseDays: asNumberMap(fields.upgradePurchaseDays, "Upgrade purchase days"),
  };
}

/**
 * Version 1 saves come from before campus events existed. They become version 2 by
 * planning five ordinary days and marking every recorded day as ordinary, which is
 * exactly how those days were traded, so an old run carries on unchanged.
 */
function upgradeFromVersion1(fields: Fields): Fields {
  const history = Array.isArray(fields.history)
    ? fields.history.map((day: unknown) => ({
        ...asFields(day, "A day in the history"),
        eventId: ORDINARY_DAY.id,
      }))
    : fields.history;
  return { ...fields, version: 2, events: CLASSIC_WEEK, history };
}

/**
 * Version 2 saves come from before the upgrades shop. They become version 3 with no
 * upgrades bought and no discounted stock, and every recorded sale marked as full price,
 * which is exactly how those days were traded.
 */
function upgradeFromVersion2(fields: Fields): Fields {
  const stock = asFields(fields.stock, "Stock");
  const history = Array.isArray(fields.history)
    ? fields.history.map((day: unknown) => {
        const dayFields = asFields(day, "A day in the history");
        const lines = Array.isArray(dayFields.lines)
          ? dayFields.lines.map((line: unknown) => ({
              ...asFields(line, "A receipt line"),
              discountedUnitsSold: 0,
            }))
          : dayFields.lines;
        return { ...dayFields, lines };
      })
    : fields.history;
  return {
    ...fields,
    version: 3,
    discountedStock: Object.fromEntries(Object.keys(stock).map((id) => [id, 0])),
    purchasedUpgrades: [],
    upgradePurchaseDays: {},
    history,
  };
}

/** Brings older save formats up to date, one version step at a time. */
export function migrate(data: unknown): Fields {
  let fields = asFields(data, "The save");
  if (fields.version === 1) {
    fields = upgradeFromVersion1(fields);
  }
  if (fields.version === 2) {
    fields = upgradeFromVersion2(fields);
  }
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
