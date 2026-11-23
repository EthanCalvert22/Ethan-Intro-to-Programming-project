import { findBoardProblem, type HighScore } from "../domain/highScores";
import { writeItem, type KeyValueStorage, type SaveResult } from "./runStore";

/*
 * Where the high scores are written down. They live under their own key, separate from the
 * run, so starting a new run never touches them. Like the run, the whole board is one value
 * written in one go, and saved text is checked carefully before it is trusted.
 */

export const SCORES_KEY = "brew-and-byte:scores:v1";

/** Where unreadable scores are copied before a new board replaces them. */
export const SCORES_BACKUP_KEY = "brew-and-byte:scores:v1:unreadable-backup";

const SCORES_FORMAT_VERSION = 1;

export type ScoresLoad =
  | { readonly kind: "loaded"; readonly board: readonly HighScore[] }
  | { readonly kind: "damaged"; readonly problem: string; readonly raw: string }
  | { readonly kind: "unavailable"; readonly problem: string };

type ReadScores =
  | { readonly ok: true; readonly board: readonly HighScore[] }
  | { readonly ok: false; readonly problem: string };

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeScore(value: unknown): HighScore | null {
  if (!isRecord(value)) {
    return null;
  }
  const { gainLossCents, finalCashCents, withEvents, date } = value;
  if (
    typeof gainLossCents !== "number" ||
    typeof finalCashCents !== "number" ||
    typeof withEvents !== "boolean" ||
    typeof date !== "string"
  ) {
    return null;
  }
  return { gainLossCents, finalCashCents, withEvents, date };
}

/** Turns saved text back into a board, or explains in plain words why it cannot. */
export function readScores(text: string): ReadScores {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, problem: "The saved high scores are not readable." };
  }
  if (!isRecord(data) || data.version !== SCORES_FORMAT_VERSION || !Array.isArray(data.scores)) {
    return { ok: false, problem: "The saved high scores are not in the expected format." };
  }
  const board = data.scores.map(decodeScore);
  if (board.some((score) => score === null)) {
    return { ok: false, problem: "A saved high score is not in the expected format." };
  }
  const checked = board as HighScore[];
  const problem = findBoardProblem(checked);
  return problem === null ? { ok: true, board: checked } : { ok: false, problem };
}

export class ScoreStore {
  constructor(private readonly storage: KeyValueStorage) {}

  /** Reads the board. Read-only: nothing is written while loading. */
  load(): ScoresLoad {
    let raw: string | null;
    try {
      raw = this.storage.getItem(SCORES_KEY);
    } catch {
      return {
        kind: "unavailable",
        problem: "Your browser is not letting this page read its high scores.",
      };
    }
    if (raw === null) {
      return { kind: "loaded", board: [] };
    }
    const read = readScores(raw);
    return read.ok
      ? { kind: "loaded", board: read.board }
      : { kind: "damaged", problem: read.problem, raw };
  }

  save(board: readonly HighScore[]): SaveResult {
    return writeItem(
      this.storage,
      SCORES_KEY,
      JSON.stringify({ version: SCORES_FORMAT_VERSION, scores: board }),
    );
  }

  /** Keeps a copy of unreadable scores before they are replaced, so nothing is lost silently. */
  backUpDamaged(raw: string): SaveResult {
    return writeItem(this.storage, SCORES_BACKUP_KEY, raw);
  }
}
