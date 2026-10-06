import { describe, expect, it } from "vitest";
import { newRun } from "../../src/domain/run";
import { BACKUP_KEY, RUN_KEY, RunStore, type KeyValueStorage } from "../../src/storage/runStore";
import { openShop, type Opening, type Shop } from "../../src/ui/shop";
import { cafe, CountingStorage } from "../helpers";

function ready(opening: Opening): Shop {
  if (opening.kind !== "ready") {
    throw new Error(`Expected a ready shop, got: ${opening.problem}`);
  }
  return opening.shop;
}

function freshShop(storage = new CountingStorage()): Shop {
  return ready(openShop(cafe, new RunStore(storage)));
}

describe("opening the café", () => {
  it("starts a fresh run on first visit without asking and without writing", () => {
    const storage = new CountingStorage();
    const opening = openShop(cafe, new RunStore(storage));
    expect(opening.kind).toBe("ready");
    expect(ready(opening).run).toEqual(newRun(cafe));
    expect(opening.kind === "ready" && opening.notice).toBeNull();
    expect(storage.writes).toBe(0);
  });

  it("A5: reopening restores the saved run exactly and never replays a day", () => {
    const storage = new CountingStorage();
    const shop = freshShop(storage);
    shop.buy("toastie", 12);
    shop.setPrice("toastie", 500);
    shop.trade();
    const writesAfterPlay = storage.writes;
    const reopened = freshShop(storage);
    expect(reopened.run).toEqual(shop.run);
    expect(reopened.run.history).toHaveLength(1);
    const again = freshShop(storage);
    expect(again.run.history).toHaveLength(1);
    expect(storage.writes).toBe(writesAfterPlay);
  });

  it("stops and explains when the save is damaged, without touching it", () => {
    const storage = new CountingStorage();
    storage.data.set(RUN_KEY, '{"version":1,"cashCents":-5}');
    const opening = openShop(cafe, new RunStore(storage));
    expect(opening.kind).toBe("damaged");
    expect(storage.data.get(RUN_KEY)).toBe('{"version":1,"cashCents":-5}');
    expect(storage.writes).toBe(0);
  });

  it("starting fresh after damage keeps a backup first, then saves a new run", () => {
    const storage = new CountingStorage();
    storage.data.set(RUN_KEY, "garbage");
    const opening = openShop(cafe, new RunStore(storage));
    if (opening.kind !== "damaged") throw new Error("expected damaged");
    const shop = ready(opening.startFresh());
    expect(storage.data.get(BACKUP_KEY)).toBe("garbage");
    expect(JSON.parse(storage.data.get(RUN_KEY) ?? "null")).toEqual(newRun(cafe));
    expect(shop.run).toEqual(newRun(cafe));
  });

  it("refuses to replace a damaged save it could not back up, and lets the player retry", () => {
    const storage = new CountingStorage();
    storage.data.set(RUN_KEY, "garbage");
    storage.failWrites = true;
    const opening = openShop(cafe, new RunStore(storage));
    if (opening.kind !== "damaged") throw new Error("expected damaged");
    const retry = opening.startFresh();
    expect(retry.kind).toBe("damaged");
    expect(retry.kind === "damaged" && retry.problem).toContain("couldn't keep a backup");
    expect(storage.data.get(RUN_KEY)).toBe("garbage");
    storage.failWrites = false;
    if (retry.kind !== "damaged") throw new Error("expected damaged");
    expect(retry.startFresh().kind).toBe("ready");
  });

  it("reports when the backup worked but the fresh run could not be saved", () => {
    let writes = 0;
    const storage: KeyValueStorage = {
      getItem: () => "garbage",
      setItem: () => {
        writes += 1;
        if (writes > 1) throw new DOMException("full", "QuotaExceededError");
      },
    };
    const opening = openShop(cafe, new RunStore(storage));
    if (opening.kind !== "damaged") throw new Error("expected damaged");
    const result = opening.startFresh();
    expect(result.kind === "damaged" && result.problem).toContain("couldn't save a fresh run");
  });

  it("lets the player play with a warning when the save cannot be read at all", () => {
    const storage: KeyValueStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => undefined,
    };
    const opening = openShop(cafe, new RunStore(storage));
    expect(opening.kind).toBe("ready");
    expect(opening.kind === "ready" && opening.notice).toContain("progress may not be kept");
  });
});

describe("Shop actions", () => {
  it("describes accepted actions in plain words", () => {
    const shop = freshShop();
    expect(shop.buy("flat-white", 10)).toEqual({
      ok: true,
      message: "Bought 10 × Flat white for €12.00. €88.00 left in the till.",
    });
    expect(shop.setPrice("flat-white", 300)).toEqual({
      ok: true,
      message: "Flat white now sells for €3.00.",
    });
    expect(shop.trade()).toEqual({ ok: true, message: "Day 1 is done: sold 5 items for €15.00." });
    expect(shop.startNewRun()).toEqual({
      ok: true,
      message: "Fresh start! You have €100.00 and an empty shelf.",
    });
  });

  it("uses the singular for one item and announces the end of the run", () => {
    const shop = freshShop();
    shop.buy("brownie", 1);
    expect(shop.trade().message).toBe("Day 1 is done: sold 1 item for €1.80.");
    shop.trade();
    shop.trade();
    shop.trade();
    expect(shop.trade().message).toBe(
      "Day 5 is done: sold 0 items for €0.00. That was the last day. Here are your final results.",
    );
    expect(shop.summary).toEqual({
      finalCashCents: 10110,
      remainingStockValueCents: 0,
      gainLossCents: 110,
    });
  });

  it("does not write anything when an action is refused", () => {
    const storage = new CountingStorage();
    const shop = freshShop(storage);
    const refusals = [
      shop.buy("flat-white", 0),
      shop.buy("flat-white", 9999),
      shop.buy("flat-white", 84),
      shop.buy("espresso", 1),
      shop.setPrice("toastie", 0),
      shop.setPrice("toastie", -1),
      shop.setPrice("espresso", 100),
    ];
    expect(refusals.every((outcome) => !outcome.ok)).toBe(true);
    expect(storage.writes).toBe(0);
    expect(shop.run).toEqual(newRun(cafe));
  });

  it("is atomic: if saving fails, neither the screen nor storage sees a half-done trade", () => {
    const storage = new CountingStorage();
    const shop = freshShop(storage);
    shop.buy("toastie", 10);
    const savedBefore = storage.data.get(RUN_KEY);
    const runBefore = structuredClone(shop.run);

    // The rules work out the new day, then the save fails before anything is shown.
    storage.failWrites = true;
    const outcome = shop.trade();

    expect(outcome).toEqual({
      ok: false,
      kind: "SaveFailed",
      message:
        "I couldn't save that, so nothing has changed. Your browser's storage for this site is full.",
    });
    expect(shop.run).toEqual(runBefore);
    expect(storage.data.get(RUN_KEY)).toBe(savedBefore);
    expect(freshShop(storage).run).toEqual(runBefore);

    // Once saving works again, the same trade happens exactly once.
    storage.failWrites = false;
    expect(shop.trade().ok).toBe(true);
    expect(shop.run.history).toHaveLength(1);
  });

  it("does not half-apply a purchase or a new run when saving fails", () => {
    const storage = new CountingStorage();
    const shop = freshShop(storage);
    shop.buy("brownie", 4);
    const before = structuredClone(shop.run);
    storage.failWrites = true;
    expect(shop.buy("brownie", 1).ok).toBe(false);
    expect(shop.setPrice("brownie", 200).ok).toBe(false);
    expect(shop.startNewRun().ok).toBe(false);
    expect(shop.run).toEqual(before);
  });
});
