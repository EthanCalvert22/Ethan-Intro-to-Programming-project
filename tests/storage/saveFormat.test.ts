import { describe, expect, it } from "vitest";
import { buy, newRun, tradeDay, type Run } from "../../src/domain/run";
import { buyUpgrade } from "../../src/domain/upgrades";
import { migrate, readSave, writeSave } from "../../src/storage/saveFormat";
import { cafe } from "../helpers";

function playedRun(): Run {
  const bought = buy(newRun(cafe), cafe, "toastie", 12);
  if (!bought.ok) throw new Error(bought.error.message);
  const traded = tradeDay(bought.value, cafe);
  if (!traded.ok) throw new Error(traded.error.message);
  return traded.value;
}

/** Saves a run, lets the test damage the stored data, and returns the damaged text. */
function tamper(change: (data: Record<string, unknown>) => unknown): string {
  const data = JSON.parse(writeSave(playedRun())) as Record<string, unknown>;
  return JSON.stringify(change(data));
}

function problemWith(text: string): string {
  const read = readSave(text, cafe);
  if (read.ok) {
    throw new Error("Expected the save to be refused");
  }
  return read.problem;
}

describe("writeSave and readSave", () => {
  it("round-trips a run exactly", () => {
    const run = playedRun();
    expect(readSave(writeSave(run), cafe)).toEqual({ ok: true, run });
  });

  it("stores the whole run, with its version, as one JSON value", () => {
    const data = JSON.parse(writeSave(playedRun())) as Record<string, unknown>;
    expect(data.version).toBe(3);
    expect(Object.keys(data).sort()).toEqual(
      [
        "cashCents",
        "currentDay",
        "discountedStock",
        "events",
        "history",
        "prices",
        "purchasedUpgrades",
        "status",
        "stock",
        "upgradePurchaseDays",
        "version",
      ].sort(),
    );
  });

  it("drops unknown extra fields instead of carrying them along", () => {
    const text = tamper((data) => ({ ...data, cheat: true }));
    const read = readSave(text, cafe);
    expect(read.ok && "cheat" in read.run).toBe(false);
  });
});

describe("readSave refuses damaged saves with a plain explanation", () => {
  it.each<[string, string, string]>([
    ["text that is not JSON", "{ this is not json", "not valid JSON"],
    ["an empty string", "", "not valid JSON"],
    ["a bare number", "42", "not in the expected format"],
    ["null", "null", "not in the expected format"],
    ["a list", "[]", "not in the expected format"],
    ["no version", tamper(({ version: _drop, ...rest }) => rest), "no recognisable version"],
    ["a text version", tamper((data) => ({ ...data, version: "1" })), "no recognisable version"],
    ["a newer version", tamper((data) => ({ ...data, version: 4 })), "newer version"],
    [
      "no planned events",
      tamper(({ events: _drop, ...rest }) => rest),
      "planned events is not a list",
    ],
    [
      "a planned event that is not text",
      tamper((data) => ({ ...data, events: [1, 2, 3, 4, 5] })),
      "The event for day 1",
    ],
    [
      "an unknown planned event",
      tamper((data) => ({
        ...data,
        events: ["alien-invasion", ...(data.events as string[]).slice(1)],
      })),
      'The event "alien-invasion" is not recognised',
    ],
    [
      "only four planned events",
      tamper((data) => ({ ...data, events: (data.events as string[]).slice(1) })),
      "an event for each of the 5 days",
    ],
    [
      "a recorded day without its event",
      tamper((data) => {
        const [day] = data.history as Record<string, unknown>[];
        const { eventId: _drop, ...rest } = day!;
        return { ...data, history: [rest] };
      }),
      "Day 1 in the history event",
    ],
    [
      "a recorded day with a different event from the plan",
      tamper((data) => {
        const [day] = data.history as Record<string, unknown>[];
        return { ...data, history: [{ ...day, eventId: "open-day" }] };
      }),
      "does not match the event planned",
    ],
    ["an unknown status", tamper((data) => ({ ...data, status: "paused" })), "status"],
    ["cash as text", tamper((data) => ({ ...data, cashCents: "100" })), "Cash is not a number"],
    ["negative cash", tamper((data) => ({ ...data, cashCents: -1 })), "Cash must be"],
    [
      "infinite cash",
      writeSave(playedRun()).replace(/"cashCents":\d+/, '"cashCents":1e999'),
      "Cash is not a number",
    ],
    ["fractional cash", tamper((data) => ({ ...data, cashCents: 12.5 })), "Cash must be"],
    ["a missing day", tamper(({ currentDay: _drop, ...rest }) => rest), "current day"],
    ["stock as a list", tamper((data) => ({ ...data, stock: [1, 2, 3] })), "Stock is not"],
    [
      "an unknown product in stock",
      tamper((data) => ({ ...data, stock: { ...(data.stock as object), espresso: 3 } })),
      "Stock must list exactly",
    ],
    [
      "negative stock",
      tamper((data) => ({ ...data, stock: { ...(data.stock as object), toastie: -2 } })),
      "Stock for Toastie",
    ],
    [
      "a price as text",
      tamper((data) => ({ ...data, prices: { ...(data.prices as object), toastie: "4.50" } })),
      "Prices for toastie is not a number",
    ],
    [
      "a zero price",
      tamper((data) => ({ ...data, prices: { ...(data.prices as object), toastie: 0 } })),
      "price for Toastie",
    ],
    [
      "history that is not a list",
      tamper((data) => ({ ...data, history: {} })),
      "history is not a list",
    ],
    [
      "more than five days of history",
      tamper((data) => {
        const day = (data.history as unknown[])[0];
        return { ...data, history: [day, day, day, day, day, day] };
      }),
      "more than 5 days",
    ],
    [
      "a day that is not an object",
      tamper((data) => ({ ...data, history: ["day one"] })),
      "Day 1 in the history is not",
    ],
    [
      "a receipt line without a product",
      tamper((data) => {
        const [day] = data.history as Record<string, unknown>[];
        const [line, ...rest] = day!.lines as Record<string, unknown>[];
        return { ...data, history: [{ ...day, lines: [{ ...line, productId: 7 }, ...rest] }] };
      }),
      "has no product",
    ],
    [
      "receipt totals that are missing",
      tamper((data) => {
        const [day] = data.history as Record<string, unknown>[];
        return { ...data, history: [{ ...day, totals: null }] };
      }),
      "totals is not",
    ],
    [
      "a receipt that does not add up",
      tamper((data) => {
        const [day] = data.history as Record<string, unknown>[];
        const totals = day!.totals as Record<string, unknown>;
        return { ...data, history: [{ ...day, totals: { ...totals, revenueCents: 1 } }] };
      }),
      "totals do not match",
    ],
    [
      "history that claims a day was traded twice",
      tamper((data) => {
        const [day] = data.history as unknown[];
        return { ...data, history: [day, day] };
      }),
      "history does not match",
    ],
  ])("%s", (_label, text, wording) => {
    expect(problemWith(text)).toContain(wording);
  });
});

describe("migrate", () => {
  it("passes a current save through unchanged", () => {
    const data = { version: 3, anything: "else" };
    expect(migrate(data)).toBe(data);
  });

  /** A save exactly as the game wrote it before campus events existed. */
  function versionOneSave(): Record<string, unknown> {
    const {
      events: _events,
      history,
      ...rest
    } = JSON.parse(writeSave(playedRun())) as Record<string, unknown>;
    const oldHistory = (history as Record<string, unknown>[]).map(
      ({ eventId: _eventId, ...day }) => day,
    );
    return { ...rest, version: 1, history: oldHistory };
  }

  it("upgrades a save from before events: the run carries on exactly as it was", () => {
    const read = readSave(JSON.stringify(versionOneSave()), cafe);
    expect(read).toEqual({ ok: true, run: playedRun() });
  });

  it("still refuses a damaged old save after upgrading it", () => {
    const broken = { ...versionOneSave(), history: "lost" };
    expect(problemWith(JSON.stringify(broken))).toContain("history is not a list");
    const brokenDay = { ...versionOneSave(), history: ["day one"] };
    expect(problemWith(JSON.stringify(brokenDay))).toContain("A day in the history");
  });
});

describe("saves with upgrades (format version 3)", () => {
  /** A run with the loyalty program and supplier partnership bought, and discounted stock. */
  function upgradedRun(): Run {
    const steps = [
      (run: Run) => buyUpgrade(run, "loyalty-program"),
      (run: Run) => buyUpgrade(run, "supplier-partnership"),
      (run: Run) => buy(run, cafe, "toastie", 12),
      (run: Run) => tradeDay(run, cafe),
    ];
    return steps.reduce((run, step) => {
      const outcome = step(run);
      if (!outcome.ok) throw new Error(outcome.error.message);
      return outcome.value;
    }, newRun(cafe));
  }

  function tamperUpgraded(change: (data: Record<string, unknown>) => unknown): string {
    return JSON.stringify(change(JSON.parse(writeSave(upgradedRun())) as Record<string, unknown>));
  }

  it("round-trips upgrades and discounted stock exactly", () => {
    const run = upgradedRun();
    expect(run.discountedStock.toastie).toBe(0);
    expect(run.history[0]?.lines[1]?.discountedUnitsSold).toBe(12);
    expect(readSave(writeSave(run), cafe)).toEqual({ ok: true, run });
  });

  it("upgrades a version 2 save (before upgrades): nothing bought, nothing discounted", () => {
    const current = JSON.parse(writeSave(playedRun())) as Record<string, unknown>;
    const {
      discountedStock: _stock,
      purchasedUpgrades: _bought,
      upgradePurchaseDays: _days,
      history,
      ...rest
    } = current;
    const oldHistory = (history as Record<string, unknown>[]).map((day) => ({
      ...day,
      lines: (day.lines as Record<string, unknown>[]).map(
        ({ discountedUnitsSold: _units, ...line }) => line,
      ),
    }));
    const versionTwo = { ...rest, version: 2, history: oldHistory };
    expect(readSave(JSON.stringify(versionTwo), cafe)).toEqual({ ok: true, run: playedRun() });
  });

  it("still refuses a damaged version 2 save after upgrading it", () => {
    const current = JSON.parse(writeSave(playedRun())) as Record<string, unknown>;
    const [day] = current.history as Record<string, unknown>[];
    const broken = { ...current, version: 2, history: [{ ...day, lines: "lost" }] };
    expect(problemWith(JSON.stringify(broken))).toContain("lines is not a list");
    const brokenLine = { ...current, version: 2, history: [{ ...day, lines: ["torn"] }] };
    expect(problemWith(JSON.stringify(brokenLine))).toContain("A receipt line");
  });

  it.each<[string, string, string]>([
    [
      "bought upgrades that are not a list",
      tamperUpgraded((d) => ({ ...d, purchasedUpgrades: "all" })),
      "bought upgrades is not a list",
    ],
    [
      "an upgrade id that is not text",
      tamperUpgraded((d) => ({ ...d, purchasedUpgrades: [7] })),
      "Bought upgrade 1",
    ],
    [
      "an unknown upgrade",
      tamperUpgraded((d) => ({
        ...d,
        purchasedUpgrades: ["time-machine"],
        upgradePurchaseDays: { "time-machine": 1 },
      })),
      "Bought upgrades must be known",
    ],
    [
      "the same upgrade twice",
      tamperUpgraded((d) => ({ ...d, purchasedUpgrades: ["loyalty-program", "loyalty-program"] })),
      "each bought only once",
    ],
    [
      "a purchase with no day",
      tamperUpgraded((d) => ({ ...d, upgradePurchaseDays: { "loyalty-program": 1 } })),
      "don't match the purchases",
    ],
    [
      "a purchase dated in the future",
      tamperUpgraded((d) => ({
        ...d,
        upgradePurchaseDays: { "loyalty-program": 1, "supplier-partnership": 5 },
      })),
      "don't match the purchases",
    ],
    [
      "missing discounted stock",
      tamperUpgraded(({ discountedStock: _drop, ...rest }) => rest),
      "Discounted stock is not",
    ],
    [
      "more discounted stock than stock",
      tamperUpgraded((d) => ({
        ...d,
        discountedStock: { ...(d.discountedStock as object), "flat-white": 3 },
      })),
      "more discounted Flat white",
    ],
    [
      "discounted stock without the partnership",
      JSON.stringify({
        ...(JSON.parse(writeSave(playedRun())) as Record<string, unknown>),
        discountedStock: { "flat-white": 0, toastie: 1, brownie: 0 },
      }),
      "needs the Supplier Partnership",
    ],
    [
      "a discounted sale without the partnership",
      (() => {
        const data = JSON.parse(writeSave(playedRun())) as Record<string, unknown>;
        const [day] = data.history as Record<string, unknown>[];
        const lines = (day!.lines as Record<string, unknown>[]).map((line) =>
          line.productId === "toastie" ? { ...line, discountedUnitsSold: 2 } : line,
        );
        return JSON.stringify({ ...data, history: [{ ...day, lines }] });
      })(),
      "discounted units of Toastie are not possible",
    ],
    [
      "a receipt line with no discounted count",
      tamperUpgraded((d) => {
        const [day] = d.history as Record<string, unknown>[];
        const [line, ...rest] = day!.lines as Record<string, unknown>[];
        const { discountedUnitsSold: _drop, ...trimmed } = line!;
        return { ...d, history: [{ ...day, lines: [trimmed, ...rest] }] };
      }),
      "discounted units is not a number",
    ],
  ])("refuses %s", (_label, text, wording) => {
    expect(problemWith(text)).toContain(wording);
  });
});
