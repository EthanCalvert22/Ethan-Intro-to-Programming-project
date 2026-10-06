import { describe, expect, it } from "vitest";
import { findRunProblem } from "../../src/domain/invariants";
import { buy, newRun, setPrice, tradeDay, type DayResult, type Run } from "../../src/domain/run";
import { briefMenu } from "../helpers";

/** A run with two completed days and some stock left, built only through real actions. */
function playedRun(): Run {
  const steps = [
    (run: Run) => buy(run, briefMenu, "lemonade", 12),
    (run: Run) => buy(run, briefMenu, "cookie", 6),
    (run: Run) => setPrice(run, briefMenu, "cookie", 200),
    (run: Run) => tradeDay(run, briefMenu),
    (run: Run) => tradeDay(run, briefMenu),
  ];
  return steps.reduce((run, step) => {
    const outcome = step(run);
    if (!outcome.ok) {
      throw new Error(outcome.error.message);
    }
    return outcome.value;
  }, newRun(briefMenu));
}

function completedRun(): Run {
  let run = playedRun();
  for (let day = 0; day < 3; day += 1) {
    const outcome = tradeDay(run, briefMenu);
    if (!outcome.ok) {
      throw new Error(outcome.error.message);
    }
    run = outcome.value;
  }
  return run;
}

function withFirstDay(run: Run, change: (day: DayResult) => DayResult): Run {
  const [first, ...rest] = run.history;
  return { ...run, history: [change(first!), ...rest] };
}

function withFirstLine(run: Run, change: (line: DayResult["lines"][number]) => object): Run {
  return withFirstDay(run, (day) => {
    const [first, ...rest] = day.lines;
    return { ...day, lines: [change(first!), ...rest] } as DayResult;
  });
}

describe("findRunProblem", () => {
  it("finds nothing wrong with runs built by the rules", () => {
    expect(findRunProblem(newRun(briefMenu), briefMenu)).toBeNull();
    expect(findRunProblem(playedRun(), briefMenu)).toBeNull();
    expect(findRunProblem(completedRun(), briefMenu)).toBeNull();
  });

  const run = playedRun();
  const completed = completedRun();

  it.each<[string, Run]>([
    ["negative cash", { ...run, cashCents: -1 }],
    ["fractional cash", { ...run, cashCents: 10.5 }],
    ["day 0", { ...run, currentDay: 0, history: [] }],
    ["day 6", { ...run, currentDay: 6 }],
    ["negative stock", { ...run, stock: { ...run.stock, lemonade: -1 } }],
    ["missing stock entry", { ...run, stock: { lemonade: 1, cookie: 1 } }],
    ["stock for an unknown product", { ...run, stock: { ...run.stock, espresso: 1 } }],
    ["a zero price", { ...run, prices: { ...run.prices, cookie: 0 } }],
    ["a price above the ceiling", { ...run, prices: { ...run.prices, cookie: 100001 } }],
    ["a missing price", { ...run, prices: { lemonade: 400, cookie: 150 } }],
    ["a price for an unknown product", { ...run, prices: { ...run.prices, espresso: 100 } }],
    ["history that does not match the day", { ...run, currentDay: 1 }],
    [
      "more than five days of history",
      { ...completed, history: [...completed.history, completed.history[0]!] },
    ],
    ["a completed run with fewer than five days", { ...run, status: "completed" }],
    ["a completed run not on day 5", { ...completed, currentDay: 4 }],
    ["days out of order", { ...run, history: [run.history[1]!, run.history[0]!] }],
    [
      "a day with a missing product line",
      withFirstDay(run, (day) => ({ ...day, lines: day.lines.slice(1) })),
    ],
    [
      "a line for the wrong product",
      withFirstLine(run, (line) => ({ ...line, productId: "espresso" })),
    ],
    ["a line with an invalid price", withFirstLine(run, (line) => ({ ...line, priceCents: 0 }))],
    ["a line with the wrong demand", withFirstLine(run, (line) => ({ ...line, demand: 5 }))],
    ["a line selling more than demand", withFirstLine(run, (line) => ({ ...line, unitsSold: 11 }))],
    [
      "a line selling a negative amount",
      withFirstLine(run, (line) => ({ ...line, unitsSold: -1 })),
    ],
    ["a line with the wrong revenue", withFirstLine(run, (line) => ({ ...line, revenueCents: 1 }))],
    [
      "a line with the wrong cost of goods",
      withFirstLine(run, (line) => ({ ...line, cogsCents: 1 })),
    ],
    [
      "a line with the wrong gross profit",
      withFirstLine(run, (line) => ({ ...line, grossProfitCents: 1 })),
    ],
    [
      "totals that do not add up",
      withFirstDay(run, (day) => ({ ...day, totals: { ...day.totals, unitsSold: 99 } })),
    ],
    [
      "revenue totals that do not add up",
      withFirstDay(run, (day) => ({ ...day, totals: { ...day.totals, revenueCents: 1 } })),
    ],
    [
      "cost totals that do not add up",
      withFirstDay(run, (day) => ({ ...day, totals: { ...day.totals, cogsCents: 1 } })),
    ],
    [
      "profit totals that do not add up",
      withFirstDay(run, (day) => ({ ...day, totals: { ...day.totals, grossProfitCents: 1 } })),
    ],
    ["negative cash after a day", withFirstDay(run, (day) => ({ ...day, cashAfterCents: -5 }))],
    [
      "negative stock after a day",
      withFirstDay(run, (day) => ({ ...day, stockAfter: { ...day.stockAfter, lemonade: -1 } })),
    ],
  ])("reports %s", (_label, broken) => {
    expect(findRunProblem(broken, briefMenu)).toEqual(expect.any(String));
  });
});
