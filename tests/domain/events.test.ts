import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  adjustDemand,
  CAMPUS_EVENTS,
  CLASSIC_WEEK,
  demandOnDay,
  effectPercent,
  findEvent,
  ORDINARY_DAY,
  scheduleFromSeed,
} from "../../src/domain/events";
import { findRunProblem } from "../../src/domain/invariants";
import { RUN_LENGTH_DAYS } from "../../src/domain/rules";
import { buy, eventFor, newRun, setPrice, tradeDay, type Run } from "../../src/domain/run";
import type { Outcome } from "../../src/domain/result";
import { cafe } from "../helpers";

function accepted(outcome: Outcome<Run>): Run {
  if (!outcome.ok) {
    throw new Error(outcome.error.message);
  }
  return outcome.value;
}

describe("the campus event list", () => {
  it("starts with an ordinary day that changes nothing", () => {
    expect(CAMPUS_EVENTS[0]).toBe(ORDINARY_DAY);
    expect(ORDINARY_DAY.effects).toEqual({});
  });

  it("has unique ids, names and only 'noticeable' effects (half to one and a half times)", () => {
    const ids = CAMPUS_EVENTS.map((event) => event.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const event of CAMPUS_EVENTS) {
      expect(event.name.trim()).not.toBe("");
      expect(event.headline.trim()).not.toBe("");
      for (const percent of Object.values(event.effects)) {
        expect([50, 150]).toContain(percent);
      }
    }
  });

  it("only mentions products that are on the Brew & Byte menu", () => {
    const menuIds = cafe.map((product) => product.id);
    for (const event of CAMPUS_EVENTS) {
      for (const productId of Object.keys(event.effects)) {
        expect(menuIds).toContain(productId);
      }
    }
  });

  it("finds events by id", () => {
    expect(findEvent("exam-week")?.name).toBe("Exam week");
    expect(findEvent("alien-invasion")).toBeUndefined();
  });

  it("treats an item an event doesn't mention as unchanged (100%)", () => {
    const examWeek = findEvent("exam-week")!;
    expect(effectPercent(examWeek, "flat-white")).toBe(150);
    expect(effectPercent(examWeek, "toastie")).toBe(100);
  });
});

describe("adjustDemand: events change the number of customers", () => {
  it.each([
    [10, 100, 10],
    [5, 100, 5],
    [0, 150, 0],
    [10, 150, 15],
    [10, 50, 5],
    // Half a customer rounds up, so 5 x 1.5 = 7.5 becomes 8 and 5 x 0.5 = 2.5 becomes 3.
    [5, 150, 8],
    [5, 50, 3],
  ])("%i customers at %i%% become %i", (base, percent, expected) => {
    expect(adjustDemand(base, percent)).toBe(expected);
  });

  it("combines with the price rule: the price decides the tier, the event scales it", () => {
    // Flat white reference €2.80. At €2.80 that is 10 customers, during exam week 15.
    expect(demandOnDay(280, 280, 150)).toBe(15);
    expect(demandOnDay(281, 280, 150)).toBe(8);
    expect(demandOnDay(561, 280, 150)).toBe(0);
    expect(demandOnDay(280, 280, 100)).toBe(10);
  });
});

describe("scheduleFromSeed: each run gets its own week of events", () => {
  it("gives the same week for the same seed, so a run never changes on reload", () => {
    expect(scheduleFromSeed(12345)).toEqual(scheduleFromSeed(12345));
  });

  it("always gives five known events and never repeats a special event", () => {
    for (let seed = 0; seed < 500; seed += 1) {
      const week = scheduleFromSeed(seed * 7919);
      expect(week).toHaveLength(RUN_LENGTH_DAYS);
      for (const id of week) {
        expect(findEvent(id)).toBeDefined();
      }
      const specials = week.filter((id) => id !== ORDINARY_DAY.id);
      expect(new Set(specials).size).toBe(specials.length);
    }
  });

  it("varies between runs and uses every event over many runs", () => {
    const weeks = new Set<string>();
    const seen = new Set<string>();
    for (let seed = 0; seed < 300; seed += 1) {
      const week = scheduleFromSeed(seed);
      weeks.add(week.join(","));
      week.forEach((id) => seen.add(id));
    }
    expect(weeks.size).toBeGreaterThan(100);
    expect(seen).toEqual(new Set(CAMPUS_EVENTS.map((event) => event.id)));
  });

  it("offers a classic week of five ordinary days, the brief's original rules", () => {
    expect(CLASSIC_WEEK).toEqual(Array(RUN_LENGTH_DAYS).fill(ORDINARY_DAY.id));
  });
});

describe("trading with events", () => {
  const week = ["exam-week", "rainy-day", "ordinary-day", "big-match", "bake-sale"];

  it("a new run remembers its week, and defaults to the classic week", () => {
    expect(newRun(cafe, week).events).toEqual(week);
    expect(newRun(cafe).events).toEqual(CLASSIC_WEEK);
  });

  it("knows the event for any day of the run", () => {
    const run = newRun(cafe, week);
    expect(eventFor(run, 1).id).toBe("exam-week");
    expect(eventFor(run, 2).id).toBe("rainy-day");
    expect(eventFor(run, 6)).toBe(ORDINARY_DAY);
  });

  it("exam week brings 15 flat white customers, and the receipt records the event", () => {
    let run = accepted(buy(newRun(cafe, week), cafe, "flat-white", 20));
    run = accepted(buy(run, cafe, "toastie", 20));
    run = accepted(tradeDay(run, cafe));
    const day = run.history[0]!;
    expect(day.eventId).toBe("exam-week");
    expect(day.lines.find((line) => line.productId === "flat-white")).toMatchObject({
      demand: 15,
      unitsSold: 15,
      revenueCents: 15 * 280,
    });
    // Toasties are not affected by exam week.
    expect(day.lines.find((line) => line.productId === "toastie")?.demand).toBe(10);
  });

  it("a rainy day lifts toasties; a big match halves everything", () => {
    let run = accepted(buy(newRun(cafe, week), cafe, "toastie", 40));
    run = accepted(tradeDay(run, cafe));
    run = accepted(tradeDay(run, cafe));
    expect(run.history[1]!.lines.find((line) => line.productId === "toastie")?.demand).toBe(15);
    run = accepted(tradeDay(run, cafe));
    run = accepted(setPrice(run, cafe, "toastie", 500));
    run = accepted(tradeDay(run, cafe));
    // Big match: €5.00 is above the €4.50 reference, so 5 customers, halved to 3 (2.5 rounds up).
    expect(run.history[3]!.lines.find((line) => line.productId === "toastie")?.demand).toBe(3);
  });

  it("an ordinary day follows the brief's rule exactly", () => {
    let run = accepted(buy(newRun(cafe), cafe, "brownie", 12));
    run = accepted(tradeDay(run, cafe));
    expect(run.history[0]!.eventId).toBe(ORDINARY_DAY.id);
    expect(run.history[0]!.lines.find((line) => line.productId === "brownie")?.demand).toBe(10);
  });
});

describe("random games with events (seeded property test)", () => {
  it("keep every promise: valid runs, and cash + stock changes only by each day's gross profit", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2 ** 32 - 1 }),
        fc.array(
          fc.oneof(
            fc.record({
              kind: fc.constant("buy" as const),
              productId: fc.constantFrom(...cafe.map((product) => product.id)),
              quantity: fc.integer({ min: -2, max: 40 }),
            }),
            fc.record({
              kind: fc.constant("price" as const),
              productId: fc.constantFrom(...cafe.map((product) => product.id)),
              priceCents: fc.integer({ min: -10, max: 2000 }),
            }),
            fc.record({ kind: fc.constant("trade" as const) }),
          ),
          { maxLength: 40 },
        ),
        (seed, actions) => {
          let run = newRun(cafe, scheduleFromSeed(seed));
          const worth = (state: Run) =>
            cafe.reduce(
              (total, product) => total + (state.stock[product.id] ?? 0) * product.unitCostCents,
              state.cashCents,
            );
          for (const action of actions) {
            const outcome =
              action.kind === "buy"
                ? buy(run, cafe, action.productId, action.quantity)
                : action.kind === "price"
                  ? setPrice(run, cafe, action.productId, action.priceCents)
                  : tradeDay(run, cafe);
            if (!outcome.ok) {
              continue;
            }
            expect(findRunProblem(outcome.value, cafe)).toBeNull();
            if (action.kind === "trade") {
              const day = outcome.value.history[outcome.value.history.length - 1]!;
              expect(day.eventId).toBe(run.events[day.day - 1]);
              expect(worth(outcome.value) - worth(run)).toBe(day.totals.grossProfitCents);
            }
            run = outcome.value;
          }
        },
      ),
      { seed: 20261120, numRuns: 300 },
    );
  });
});
