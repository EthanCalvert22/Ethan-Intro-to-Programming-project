import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CLASSIC_WEEK } from "../../src/domain/events";
import {
  findBoardProblem,
  HIGH_SCORE_LIMIT,
  placeScore,
  scoreFromRun,
  type HighScore,
} from "../../src/domain/highScores";
import { buy, newRun, tradeDay, type Run } from "../../src/domain/run";
import type { Outcome } from "../../src/domain/result";
import { cafe } from "../helpers";

function accepted(outcome: Outcome<Run>): Run {
  if (!outcome.ok) {
    throw new Error(outcome.error.message);
  }
  return outcome.value;
}

function score(gainLossCents: number, date = "2026-11-21", withEvents = true): HighScore {
  return { gainLossCents, finalCashCents: 10000 + gainLossCents, withEvents, date };
}

function finishedRun(events: readonly string[] = CLASSIC_WEEK): Run {
  let run = accepted(buy(newRun(cafe, events), cafe, "toastie", 12));
  for (let day = 1; day <= 5; day += 1) {
    run = accepted(tradeDay(run, cafe));
  }
  return run;
}

describe("scoreFromRun", () => {
  it("scores a finished run by its overall gain or loss, with the date given", () => {
    // 12 toasties cost €24.00; 10 sell on day 1 and 2 on day 2 at €4.50: gain €30.00.
    expect(scoreFromRun(finishedRun(), cafe, "2026-11-21")).toEqual({
      gainLossCents: 3000,
      finalCashCents: 13000,
      withEvents: false,
      date: "2026-11-21",
    });
  });

  it("tags a run as 'with events' when any of its days had one", () => {
    const week = ["ordinary-day", "ordinary-day", "bake-sale", "ordinary-day", "ordinary-day"];
    expect(scoreFromRun(finishedRun(week), cafe, "2026-11-21").withEvents).toBe(true);
  });
});

describe("placeScore", () => {
  it("puts the first score at the top of an empty board", () => {
    expect(placeScore([], score(500))).toEqual({ board: [score(500)], rank: 1 });
  });

  it("keeps the board in order, best first", () => {
    const board = [score(900), score(400), score(100)];
    expect(placeScore(board, score(500))).toEqual({
      board: [score(900), score(500), score(400), score(100)],
      rank: 2,
    });
  });

  it("keeps only the best five", () => {
    const board = [score(900), score(800), score(700), score(600), score(500)];
    const placed = placeScore(board, score(650));
    expect(placed.rank).toBe(4);
    expect(placed.board.map((entry) => entry.gainLossCents)).toEqual([900, 800, 700, 650, 600]);
    expect(placed.board).toHaveLength(HIGH_SCORE_LIMIT);
  });

  it("gives no rank to a score that doesn't make the top five, and leaves the board alone", () => {
    const board = [score(900), score(800), score(700), score(600), score(500)];
    expect(placeScore(board, score(100))).toEqual({ board, rank: null });
  });

  it("lets an equal score sit below the older one, so ties never push earlier scores down", () => {
    const older = score(500, "2026-11-01");
    const newer = score(500, "2026-11-21");
    expect(placeScore([older], newer)).toEqual({ board: [older, newer], rank: 2 });
  });

  it("ranks losses too: a loss can still make an empty or short board", () => {
    expect(placeScore([score(200)], score(-300)).rank).toBe(2);
  });

  it("never changes the board it was given", () => {
    const board = [score(900), score(100)];
    const copy = structuredClone(board);
    placeScore(board, score(500));
    expect(board).toEqual(copy);
  });

  it("always keeps a valid board (seeded random test)", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: -10000, max: 50000 }), { maxLength: 30 }), (gains) => {
        let board: readonly HighScore[] = [];
        for (const gain of gains) {
          const placed = placeScore(board, score(gain));
          expect(findBoardProblem(placed.board)).toBeNull();
          if (placed.rank !== null) {
            expect(placed.board[placed.rank - 1]?.gainLossCents).toBe(gain);
          }
          board = placed.board;
        }
        const best = [...gains].sort((a, b) => b - a).slice(0, HIGH_SCORE_LIMIT);
        expect(board.map((entry) => entry.gainLossCents)).toEqual(best);
      }),
      { seed: 20261121, numRuns: 300 },
    );
  });
});

describe("findBoardProblem", () => {
  it("accepts a valid board, including an empty one", () => {
    expect(findBoardProblem([])).toBeNull();
    expect(findBoardProblem([score(900), score(-50, "2025-01-31", false)])).toBeNull();
  });

  it.each<[string, HighScore[]]>([
    ["more than five scores", [score(6), score(5), score(4), score(3), score(2), score(1)]],
    ["scores out of order", [score(100), score(900)]],
    ["a fractional gain", [score(10.5)]],
    // Final cash can be lower than gain + €100 (stock left over), but never higher.
    ["final cash higher than the result allows", [{ ...score(500), finalCashCents: 10501 }]],
    ["negative final cash", [{ ...score(-10001), finalCashCents: -1 }]],
    ["a date in the wrong format", [score(500, "21/11/2026")]],
    ["an impossible date", [score(500, "2026-13-45")]],
  ])("reports %s", (_label, board) => {
    expect(findBoardProblem(board)).toEqual(expect.any(String));
  });
});
