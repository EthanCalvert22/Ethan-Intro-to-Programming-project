import type { Catalogue } from "../domain/catalogue";
import type { Run } from "../domain/run";
import { readSave, writeSave } from "./saveFormat";

/*
 * The notebook: where the run is written down between visits. The whole run is saved
 * as one value under one key, so a save either happens completely or not at all.
 */

/** The single key that holds the whole run. */
export const RUN_KEY = "brew-and-byte:run:v1";

/** Where an unreadable save is copied before a fresh run replaces it. */
export const BACKUP_KEY = "brew-and-byte:run:v1:unreadable-backup";

/** The part of the browser's localStorage this game uses. Tests pass in a stand-in. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type LoadResult =
  | { readonly kind: "empty" }
  | { readonly kind: "loaded"; readonly run: Run }
  | { readonly kind: "damaged"; readonly problem: string; readonly raw: string }
  | { readonly kind: "unavailable"; readonly problem: string };

export type SaveResult = { readonly ok: true } | { readonly ok: false; readonly problem: string };

function describeWriteFailure(error: unknown): string {
  if (error instanceof DOMException && error.name === "QuotaExceededError") {
    return "Your browser's storage for this site is full.";
  }
  return "Your browser is not letting this page save.";
}

export class RunStore {
  constructor(private readonly storage: KeyValueStorage) {}

  /** Reads the saved run. Read-only: it never writes, so reopening can never replay a day. */
  load(catalogue: Catalogue): LoadResult {
    let raw: string | null;
    try {
      raw = this.storage.getItem(RUN_KEY);
    } catch {
      return {
        kind: "unavailable",
        problem: "Your browser is not letting this page read its save.",
      };
    }
    if (raw === null) {
      return { kind: "empty" };
    }
    const read = readSave(raw, catalogue);
    return read.ok
      ? { kind: "loaded", run: read.run }
      : { kind: "damaged", problem: read.problem, raw };
  }

  /** Saves the whole run in one write. */
  save(run: Run): SaveResult {
    return this.write(RUN_KEY, writeSave(run));
  }

  /** Keeps a copy of an unreadable save so starting fresh never silently destroys it. */
  backUpDamaged(raw: string): SaveResult {
    return this.write(BACKUP_KEY, raw);
  }

  private write(key: string, value: string): SaveResult {
    try {
      this.storage.setItem(key, value);
      return { ok: true };
    } catch (error) {
      return { ok: false, problem: describeWriteFailure(error) };
    }
  }
}

/** A storage that only lasts while the page is open, for browsers that block localStorage. */
export class MemoryStorage implements KeyValueStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

/** The browser's localStorage, or null if the browser refuses access (for example, some private modes). */
export function browserStorage(scope: {
  readonly localStorage: KeyValueStorage;
}): KeyValueStorage | null {
  try {
    const storage = scope.localStorage;
    storage.getItem(RUN_KEY);
    return storage;
  } catch {
    return null;
  }
}
