import { describe, expect, it } from "vitest";
import { buy, newRun, tradeDay, type Run } from "../../src/domain/run";
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
    expect(data.version).toBe(2);
    expect(Object.keys(data).sort()).toEqual(
      [
        "cashCents",
        "currentDay",
        "events",
        "history",
        "prices",
        "status",
        "stock",
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
    ["a newer version", tamper((data) => ({ ...data, version: 3 })), "newer version"],
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
    const data = { version: 2, anything: "else" };
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
