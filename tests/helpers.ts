import acceptance from "../spec/acceptance.json";
import { brewAndByteCatalogue, checkCatalogue, type Catalogue } from "../src/domain/catalogue";
import type { KeyValueStorage } from "../src/storage/runStore";

/** The real café menu, validated exactly as the app does at startup. */
export const cafe: Catalogue = brewAndByteCatalogue();

/** The small menu the brief's acceptance numbers are written for (€2 cost, €4 reference). */
export const briefMenu: Catalogue = (() => {
  const checked = checkCatalogue(acceptance.catalogues.brief);
  if (!checked.ok) {
    throw new Error(checked.problems.join("; "));
  }
  return checked.catalogue;
})();

/**
 * A stand-in for the browser's localStorage that remembers what was written
 * and counts every write, so tests can prove rejected actions save nothing.
 */
export class CountingStorage implements KeyValueStorage {
  readonly data = new Map<string, string>();
  writes = 0;
  failWrites = false;

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failWrites) {
      throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    }
    this.writes += 1;
    this.data.set(key, value);
  }
}
