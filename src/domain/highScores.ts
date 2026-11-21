import type { Catalogue } from "./catalogue";
import { ORDINARY_DAY } from "./events";
import { STARTING_CASH_CENTS } from "./rules";
import { summary, type Run } from "./run";

/*
 * High scores: the best five finished runs, kept across runs. Like the rest of the rulebook
 * these functions are pure; the screen supplies the date and storage keeps the board.
 */

export interface HighScore {
  /** The run's overall gain or loss on the starting €100, in cents. This is the score. */
  readonly gainLossCents: number;
  readonly finalCashCents: number;
  /** True if any day of the run had a campus event; false for a classic week. */
  readonly withEvents: boolean;
  /** The day the run finished, written YYYY-MM-DD. */
  readonly date: string;
}

export interface Placement {
  readonly board: readonly HighScore[];
  /** 1 to 5 if the score made the board, or null if it didn't. */
  readonly rank: number | null;
}

/** How many scores the board keeps. */
export const HIGH_SCORE_LIMIT = 5;

/** Turns a finished run into a score. */
export function scoreFromRun(run: Run, catalogue: Catalogue, date: string): HighScore {
  const result = summary(run, catalogue);
  return {
    gainLossCents: result.gainLossCents,
    finalCashCents: result.finalCashCents,
    withEvents: run.events.some((eventId) => eventId !== ORDINARY_DAY.id),
    date,
  };
}

/**
 * Finds a new score's place on the board (best first). It goes below every score that is at
 * least as good, so a tie never pushes an earlier score down. Only the best five are kept.
 */
export function placeScore(board: readonly HighScore[], score: HighScore): Placement {
  const position = board.filter((entry) => entry.gainLossCents >= score.gainLossCents).length;
  if (position >= HIGH_SCORE_LIMIT) {
    return { board, rank: null };
  }
  const combined = [...board.slice(0, position), score, ...board.slice(position)];
  return { board: combined.slice(0, HIGH_SCORE_LIMIT), rank: position + 1 };
}

const DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function findScoreProblem(score: HighScore, position: number): string | null {
  const label = `High score ${position + 1}`;
  if (!Number.isSafeInteger(score.gainLossCents)) {
    return `${label} is not a whole number of cents.`;
  }
  if (
    !Number.isSafeInteger(score.finalCashCents) ||
    score.finalCashCents < 0 ||
    score.finalCashCents > score.gainLossCents + STARTING_CASH_CENTS
  ) {
    return `${label} has final cash that doesn't fit its result.`;
  }
  return DATE_PATTERN.test(score.date) ? null : `${label} has a date I can't read.`;
}

/** The promises a saved board must keep. Returns the first one broken, or null. */
export function findBoardProblem(board: readonly HighScore[]): string | null {
  if (board.length > HIGH_SCORE_LIMIT) {
    return `There are more than ${HIGH_SCORE_LIMIT} high scores.`;
  }
  for (const [position, score] of board.entries()) {
    const problem = findScoreProblem(score, position);
    if (problem !== null) {
      return problem;
    }
    const previous = board[position - 1];
    if (previous !== undefined && previous.gainLossCents < score.gainLossCents) {
      return "The high scores are not in order.";
    }
  }
  return null;
}
