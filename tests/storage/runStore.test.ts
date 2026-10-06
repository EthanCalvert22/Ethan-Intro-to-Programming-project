import { describe, expect, it } from "vitest";
import { newRun } from "../../src/domain/run";
import {
  BACKUP_KEY,
  browserStorage,
  MemoryStorage,
  RUN_KEY,
  RunStore,
  type KeyValueStorage,
} from "../../src/storage/runStore";
import { cafe, CountingStorage } from "../helpers";

describe("RunStore", () => {
  it("uses the single namespaced key brew-and-byte:run:v1", () => {
    expect(RUN_KEY).toBe("brew-and-byte:run:v1");
  });

  it("reports an empty store when nothing has been saved", () => {
    expect(new RunStore(new CountingStorage()).load(cafe)).toEqual({ kind: "empty" });
  });

  it("saves the whole run with one write and loads it back", () => {
    const storage = new CountingStorage();
    const store = new RunStore(storage);
    const run = newRun(cafe);
    expect(store.save(run)).toEqual({ ok: true });
    expect(storage.writes).toBe(1);
    expect(store.load(cafe)).toEqual({ kind: "loaded", run });
  });

  it("never writes while loading, however many times it loads", () => {
    const storage = new CountingStorage();
    const store = new RunStore(storage);
    store.save(newRun(cafe));
    const before = storage.writes;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      store.load(cafe);
    }
    expect(storage.writes).toBe(before);
  });

  it("reports a damaged save together with the raw text, without changing it", () => {
    const storage = new CountingStorage();
    storage.data.set(RUN_KEY, "not json at all");
    const loaded = new RunStore(storage).load(cafe);
    expect(loaded).toEqual({
      kind: "damaged",
      problem: "The save is not readable (it is not valid JSON).",
      raw: "not json at all",
    });
    expect(storage.data.get(RUN_KEY)).toBe("not json at all");
    expect(storage.writes).toBe(0);
  });

  it("keeps a backup of a damaged save under a separate key", () => {
    const storage = new CountingStorage();
    const store = new RunStore(storage);
    expect(store.backUpDamaged("broken")).toEqual({ ok: true });
    expect(storage.data.get(BACKUP_KEY)).toBe("broken");
    expect(BACKUP_KEY).not.toBe(RUN_KEY);
  });

  it("explains a full storage instead of crashing", () => {
    const storage = new CountingStorage();
    storage.failWrites = true;
    expect(new RunStore(storage).save(newRun(cafe))).toEqual({
      ok: false,
      problem: "Your browser's storage for this site is full.",
    });
  });

  it("explains a blocked storage instead of crashing", () => {
    const blocked: KeyValueStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    const store = new RunStore(blocked);
    expect(store.load(cafe)).toEqual({
      kind: "unavailable",
      problem: "Your browser is not letting this page read its save.",
    });
    expect(store.save(newRun(cafe))).toEqual({
      ok: false,
      problem: "Your browser is not letting this page save.",
    });
  });
});

describe("MemoryStorage", () => {
  it("remembers values while the page is open", () => {
    const storage = new MemoryStorage();
    expect(storage.getItem("key")).toBeNull();
    storage.setItem("key", "value");
    expect(storage.getItem("key")).toBe("value");
  });
});

describe("browserStorage", () => {
  it("returns localStorage when the browser allows it", () => {
    const localStorage = new MemoryStorage();
    expect(browserStorage({ localStorage })).toBe(localStorage);
  });

  it("returns null when touching localStorage throws", () => {
    const scope = {
      get localStorage(): KeyValueStorage {
        throw new DOMException("denied", "SecurityError");
      },
    };
    expect(browserStorage(scope)).toBeNull();
  });
});
