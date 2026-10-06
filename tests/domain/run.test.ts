import { describe, expect, it } from "vitest";
import {
  buy,
  daysCompleted,
  newRun,
  priceOf,
  setPrice,
  stockOf,
  summary,
  tradeDay,
  type Run,
} from "../../src/domain/run";
import { RUN_LENGTH_DAYS, STARTING_CASH_CENTS } from "../../src/domain/rules";
import type { Outcome } from "../../src/domain/result";
import { briefMenu, cafe } from "../helpers";

/** Unwraps an accepted outcome, failing the test loudly if it was rejected. */
function accepted(outcome: Outcome<Run>): Run {
  if (!outcome.ok) {
    throw new Error(`Expected the action to be accepted, got ${outcome.error.kind}`);
  }
  return outcome.value;
}

function rejectedKind(outcome: Outcome<Run>): string {
  if (outcome.ok) {
    throw new Error("Expected the action to be rejected");
  }
  return outcome.error.kind;
}

function tradeDays(run: Run, days: number): Run {
  let current = run;
  for (let day = 0; day < days; day += 1) {
    current = accepted(tradeDay(current, briefMenu));
  }
  return current;
}

describe("newRun (CT01 starting state)", () => {
  it("starts on day 1 with €100, an empty shelf and reference prices", () => {
    const run = newRun(cafe);
    expect(run).toEqual({
      version: 1,
      status: "in_progress",
      currentDay: 1,
      cashCents: STARTING_CASH_CENTS,
      stock: { "flat-white": 0, toastie: 0, brownie: 0 },
      prices: { "flat-white": 280, toastie: 450, brownie: 180 },
      history: [],
    });
    expect(STARTING_CASH_CENTS).toBe(10000);
    expect(RUN_LENGTH_DAYS).toBe(5);
  });
});

describe("buy (CT02)", () => {
  it("A1: 10 units at €2 from €100 leaves €80 and 10 in stock", () => {
    const run = accepted(buy(newRun(briefMenu), briefMenu, "lemonade", 10));
    expect(run.cashCents).toBe(8000);
    expect(stockOf(run, "lemonade")).toBe(10);
  });

  it("A1: a further €82 order is refused and changes nothing", () => {
    const before = accepted(buy(newRun(briefMenu), briefMenu, "lemonade", 10));
    const outcome = buy(before, briefMenu, "lemonade", 41);
    expect(rejectedKind(outcome)).toBe("NotAffordable");
    if (!outcome.ok) {
      expect(outcome.error.message).toBe(
        "Oops, that order comes to €82.00, but you only have €80.00 left.",
      );
    }
    expect(before.cashCents).toBe(8000);
    expect(stockOf(before, "lemonade")).toBe(10);
  });

  it("allows spending exactly all the cash", () => {
    const run = accepted(buy({ ...newRun(briefMenu), cashCents: 1000 }, briefMenu, "lemonade", 5));
    expect(run.cashCents).toBe(0);
  });

  it("refuses an order one cent more than the cash", () => {
    expect(rejectedKind(buy({ ...newRun(briefMenu), cashCents: 999 }, briefMenu, "lemonade", 5))).toBe(
      "NotAffordable",
    );
  });

  it.each([0, -1, 2.5, Number.NaN, Number.POSITIVE_INFINITY, 1001, Number.MAX_SAFE_INTEGER + 2])(
    "refuses quantity %d",
    (quantity) => {
      expect(rejectedKind(buy(newRun(briefMenu), briefMenu, "lemonade", quantity))).toBe(
        "InvalidQuantity",
      );
    },
  );

  it("refuses an unknown product", () => {
    expect(rejectedKind(buy(newRun(cafe), cafe, "espresso", 1))).toBe("UnknownProduct");
  });

  it("never changes the run it was given", () => {
    const original = newRun(cafe);
    const snapshot = structuredClone(original);
    accepted(buy(original, cafe, "toastie", 3));
    expect(original).toEqual(snapshot);
  });
});

describe("setPrice (CT03)", () => {
  it("sets a positive price in cents", () => {
    const run = accepted(setPrice(newRun(cafe), cafe, "brownie", 199));
    expect(priceOf(run, cafe[2]!)).toBe(199);
  });

  it.each([0, -1, -100, 2.5, Number.NaN, 100001])("refuses price %d", (price) => {
    expect(rejectedKind(setPrice(newRun(cafe), cafe, "brownie", price))).toBe("InvalidPrice");
  });

  it("accepts the €1,000.00 ceiling", () => {
    const run = accepted(setPrice(newRun(cafe), cafe, "brownie", 100000));
    expect(run.prices.brownie).toBe(100000);
  });

  it("refuses an unknown product", () => {
    expect(rejectedKind(setPrice(newRun(cafe), cafe, "espresso", 300))).toBe("UnknownProduct");
  });

  it("keeps the price across days until it is changed", () => {
    let run = accepted(setPrice(newRun(briefMenu), briefMenu, "cookie", 175));
    run = tradeDays(run, 2);
    expect(run.prices.cookie).toBe(175);
  });
});

describe("tradeDay (CT04, CT R2, CT R4, CT R5)", () => {
  it("A3: €80 cash, 10 units at €2 priced €4 gives €40 revenue, €20 COGS, €20 profit, €120 cash", () => {
    const start: Run = {
      ...newRun(briefMenu),
      cashCents: 8000,
      stock: { lemonade: 10, cookie: 0, muffin: 0 },
    };
    const run = accepted(tradeDay(start, briefMenu));
    const day = run.history[0]!;
    expect(day.lines[0]).toEqual({
      productId: "lemonade",
      priceCents: 400,
      demand: 10,
      unitsSold: 10,
      revenueCents: 4000,
      cogsCents: 2000,
      grossProfitCents: 2000,
    });
    expect(day.totals).toEqual({
      unitsSold: 10,
      revenueCents: 4000,
      cogsCents: 2000,
      grossProfitCents: 2000,
    });
    expect(day.cashAfterCents).toBe(12000);
    expect(day.stockAfter).toEqual({ lemonade: 0, cookie: 0, muffin: 0 });
    expect(run.cashCents).toBe(12000);
    expect(stockOf(run, "lemonade")).toBe(0);
  });

  it("A4: 3 units with demand 10 sells 3, then 0 with an empty shelf", () => {
    const start: Run = { ...newRun(briefMenu), stock: { lemonade: 3, cookie: 0, muffin: 0 } };
    const afterOne = accepted(tradeDay(start, briefMenu));
    expect(afterOne.history[0]!.lines[0]!.unitsSold).toBe(3);
    expect(stockOf(afterOne, "lemonade")).toBe(0);
    const afterTwo = accepted(tradeDay(afterOne, briefMenu));
    expect(afterTwo.history[1]!.lines[0]!.unitsSold).toBe(0);
    expect(stockOf(afterTwo, "lemonade")).toBe(0);
  });

  it("advances exactly one day per trade and records exactly one result", () => {
    const run = accepted(tradeDay(newRun(cafe), cafe));
    expect(run.currentDay).toBe(2);
    expect(run.history).toHaveLength(1);
    expect(daysCompleted(run)).toBe(1);
    expect(run.history[0]!.day).toBe(1);
  });

  it("does not take the cost of stock out of the till a second time", () => {
    const bought = accepted(buy(newRun(briefMenu), briefMenu, "lemonade", 10));
    const traded = accepted(tradeDay(bought, briefMenu));
    expect(traded.cashCents - bought.cashCents).toBe(traded.history[0]!.totals.revenueCents);
  });

  it("completes the run after day five and keeps the day counter at 5", () => {
    const run = tradeDays(newRun(briefMenu), 5);
    expect(run.status).toBe("completed");
    expect(run.currentDay).toBe(5);
    expect(run.history.map((day) => day.day)).toEqual([1, 2, 3, 4, 5]);
  });

  it("A6: once complete, buying, pricing and trading are refused", () => {
    const run = tradeDays(newRun(briefMenu), 5);
    expect(rejectedKind(buy(run, briefMenu, "lemonade", 1))).toBe("RunCompleted");
    expect(rejectedKind(setPrice(run, briefMenu, "lemonade", 300))).toBe("RunCompleted");
    expect(rejectedKind(tradeDay(run, briefMenu))).toBe("RunCompleted");
  });

  it("lists products in menu order, and totals equal the sum of the lines", () => {
    let run = newRun(cafe);
    run = accepted(buy(run, cafe, "flat-white", 12));
    run = accepted(buy(run, cafe, "brownie", 3));
    run = accepted(setPrice(run, cafe, "brownie", 300));
    run = accepted(tradeDay(run, cafe));
    const day = run.history[0]!;
    expect(day.lines.map((line) => line.productId)).toEqual(["flat-white", "toastie", "brownie"]);
    const sum = (pick: (line: (typeof day.lines)[number]) => number) =>
      day.lines.reduce((total, line) => total + pick(line), 0);
    expect(day.totals.unitsSold).toBe(sum((line) => line.unitsSold));
    expect(day.totals.revenueCents).toBe(sum((line) => line.revenueCents));
    expect(day.totals.cogsCents).toBe(sum((line) => line.cogsCents));
    expect(day.totals.grossProfitCents).toBe(sum((line) => line.grossProfitCents));
  });
});

describe("summary (CT05)", () => {
  it("values remaining stock at unit cost and compares with the starting €100", () => {
    const run = accepted(buy(newRun(cafe), cafe, "toastie", 12));
    const result = summary(run, cafe);
    expect(result).toEqual({
      finalCashCents: 7600,
      remainingStockValueCents: 2400,
      gainLossCents: 0,
    });
  });

  it("reports a loss as a negative number", () => {
    let run = accepted(buy(newRun(briefMenu), briefMenu, "lemonade", 10));
    run = accepted(setPrice(run, briefMenu, "lemonade", 100));
    run = accepted(tradeDay(run, briefMenu));
    expect(summary(run, briefMenu).gainLossCents).toBe(-1000);
  });
});

describe("lookups on incomplete records", () => {
  it("treats a product missing from the shelf as zero stock", () => {
    const run: Run = { ...newRun(cafe), stock: {} };
    expect(stockOf(run, "toastie")).toBe(0);
  });

  it("falls back to the reference price when no price was chosen", () => {
    const run: Run = { ...newRun(cafe), prices: {} };
    expect(priceOf(run, cafe[1]!)).toBe(450);
  });
});
