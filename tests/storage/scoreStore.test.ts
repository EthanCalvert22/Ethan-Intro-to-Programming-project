import { describe, expect, it } from "vitest";
import type { HighScore } from "../../src/domain/highScores";
import { RUN_KEY, type KeyValueStorage } from "../../src/storage/runStore";
import {
  readScores,
  SCORES_BACKUP_KEY,
  SCORES_KEY,
  ScoreStore,
} from "../../src/storage/scoreStore";
import { CountingStorage } from "../helpers";

const best: HighScore = {
  gainLossCents: 4200,
  finalCashCents: 14200,
  withEvents: true,
  date: "2026-11-21",
};
const second: HighScore = {
  gainLossCents: -300,
  finalCashCents: 9500,
  withEvents: false,
  date: "2026-11-20",
};

describe("ScoreStore", () => {
  it("uses its own key, separate from the run", () => {
    expect(SCORES_KEY).toBe("brew-and-byte:scores:v1");
    expect(SCORES_KEY).not.toBe(RUN_KEY);
  });

  it("starts with an empty board when nothing is saved, without writing", () => {
    const storage = new CountingStorage();
    expect(new ScoreStore(storage).load()).toEqual({ kind: "loaded", board: [] });
    expect(storage.writes).toBe(0);
  });

  it("saves the whole board in one write, with a version, and loads it back", () => {
    const storage = new CountingStorage();
    const store = new ScoreStore(storage);
    expect(store.save([best, second])).toEqual({ ok: true });
    expect(storage.writes).toBe(1);
    expect(JSON.parse(storage.getItem(SCORES_KEY) ?? "null")).toEqual({
      version: 1,
      scores: [best, second],
    });
    expect(store.load()).toEqual({ kind: "loaded", board: [best, second] });
  });

  it("reports damaged scores with the raw text, without changing them", () => {
    const storage = new CountingStorage();
    storage.data.set(SCORES_KEY, "not json");
    expect(new ScoreStore(storage).load()).toEqual({
      kind: "damaged",
      problem: "The saved high scores are not readable.",
      raw: "not json",
    });
    expect(storage.writes).toBe(0);
  });

  it("keeps a backup of damaged scores under a separate key", () => {
    const storage = new CountingStorage();
    expect(new ScoreStore(storage).backUpDamaged("broken")).toEqual({ ok: true });
    expect(storage.data.get(SCORES_BACKUP_KEY)).toBe("broken");
  });

  it("explains a full or blocked storage instead of crashing", () => {
    const full = new CountingStorage();
    full.failWrites = true;
    expect(new ScoreStore(full).save([best])).toEqual({
      ok: false,
      problem: "Your browser's storage for this site is full.",
    });
    const blocked: KeyValueStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => undefined,
    };
    expect(new ScoreStore(blocked).load()).toEqual({
      kind: "unavailable",
      problem: "Your browser is not letting this page read its high scores.",
    });
  });
});

describe("readScores refuses damaged boards", () => {
  const valid = { version: 1, scores: [best, second] };

  it("accepts a valid board", () => {
    expect(readScores(JSON.stringify(valid))).toEqual({ ok: true, board: [best, second] });
  });

  it.each<[string, unknown, string]>([
    ["a list instead of a board", [best], "not in the expected format"],
    ["null", null, "not in the expected format"],
    ["a newer version", { ...valid, version: 2 }, "not in the expected format"],
    ["scores that are not a list", { ...valid, scores: {} }, "not in the expected format"],
    ["a score that is not an object", { ...valid, scores: ["top"] }, "A saved high score"],
    [
      "a score with text for a number",
      { ...valid, scores: [{ ...best, gainLossCents: "42" }] },
      "A saved high score",
    ],
    [
      "a score with a missing date",
      { ...valid, scores: [{ ...best, date: undefined }] },
      "A saved high score",
    ],
    [
      "a score with a text tag",
      { ...valid, scores: [{ ...best, withEvents: "yes" }] },
      "A saved high score",
    ],
    ["scores out of order", { ...valid, scores: [second, best] }, "not in order"],
    ["six scores", { ...valid, scores: Array.from({ length: 6 }, () => best) }, "more than 5"],
  ])("%s", (_label, data, wording) => {
    const read = readScores(JSON.stringify(data));
    expect(read.ok).toBe(false);
    expect(read.ok ? "" : read.problem).toContain(wording);
  });
});
