import { findProduct, type Catalogue } from "../domain/catalogue";
import type { ShopErrorKind } from "../domain/errors";
import { formatEuros } from "../domain/money";
import type { Outcome } from "../domain/result";
import {
  buy,
  isComplete,
  newRun,
  setPrice,
  summary,
  tradeDay,
  type FinalSummary,
  type Run,
} from "../domain/run";
import { RunStore } from "../storage/runStore";

/*
 * The Shop is the counter between the screen and the rulebook. The screen asks it to do
 * things; it asks the rules for the new run, saves that run, and only then shows it.
 * If the rules refuse, or saving fails, the run on screen and in storage stays as it was.
 */

export type ActionOutcome =
  | { readonly ok: true; readonly message: string }
  | { readonly ok: false; readonly kind: ShopErrorKind | "SaveFailed"; readonly message: string };

export type Opening =
  | { readonly kind: "ready"; readonly shop: Shop; readonly notice: string | null }
  | { readonly kind: "damaged"; readonly problem: string; readonly startFresh: () => Opening };

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export class Shop {
  private current: Run;

  constructor(
    readonly catalogue: Catalogue,
    private readonly store: RunStore,
    run: Run,
  ) {
    this.current = run;
  }

  get run(): Run {
    return this.current;
  }

  get summary(): FinalSummary {
    return summary(this.current, this.catalogue);
  }

  buy(productId: string, quantity: number): ActionOutcome {
    return this.commit(buy(this.current, this.catalogue, productId, quantity), (run) => {
      const product = findProduct(this.catalogue, productId);
      const cost = formatEuros(this.current.cashCents - run.cashCents);
      return `Bought ${quantity} × ${product?.name ?? productId} for ${cost}. ${formatEuros(run.cashCents)} left in the till.`;
    });
  }

  setPrice(productId: string, priceCents: number): ActionOutcome {
    return this.commit(setPrice(this.current, this.catalogue, productId, priceCents), () => {
      const product = findProduct(this.catalogue, productId);
      return `${product?.name ?? productId} now sells for ${formatEuros(priceCents)}.`;
    });
  }

  trade(): ActionOutcome {
    return this.commit(tradeDay(this.current, this.catalogue), (run) => {
      const day = run.history[run.history.length - 1];
      const sold =
        day === undefined
          ? ""
          : `sold ${plural(day.totals.unitsSold, "item")} for ${formatEuros(day.totals.revenueCents)}`;
      const ending = isComplete(run) ? " That was the last day. Here are your final results." : "";
      return `Day ${day?.day ?? run.currentDay} is done: ${sold}.${ending}`;
    });
  }

  /** Only called after the player has confirmed they want to replace the current run. */
  startNewRun(): ActionOutcome {
    const fresh: Outcome<Run> = { ok: true, value: newRun(this.catalogue) };
    return this.commit(fresh, () => "Fresh start! You have €100.00 and an empty shelf.");
  }

  /** Save first, then show: the screen never shows a state that is not safely stored. */
  private commit(outcome: Outcome<Run>, describe: (run: Run) => string): ActionOutcome {
    if (!outcome.ok) {
      return { ok: false, ...outcome.error };
    }
    const saved = this.store.save(outcome.value);
    if (!saved.ok) {
      return {
        ok: false,
        kind: "SaveFailed",
        message: `I couldn't save that, so nothing has changed. ${saved.problem}`,
      };
    }
    const message = describe(outcome.value);
    this.current = outcome.value;
    return { ok: true, message };
  }
}

function startFreshAfterDamage(catalogue: Catalogue, store: RunStore, raw: string): Opening {
  const retry = (problem: string): Opening => ({
    kind: "damaged",
    problem,
    startFresh: () => startFreshAfterDamage(catalogue, store, raw),
  });
  const backedUp = store.backUpDamaged(raw);
  if (!backedUp.ok) {
    return retry(
      `I couldn't keep a backup of the old save, so I haven't replaced it. ${backedUp.problem}`,
    );
  }
  const run = newRun(catalogue);
  const saved = store.save(run);
  if (!saved.ok) {
    return retry(`I couldn't save a fresh run. ${saved.problem}`);
  }
  return {
    kind: "ready",
    shop: new Shop(catalogue, store, run),
    notice:
      "I started a fresh run. A copy of the unreadable save is kept in this browser as a backup.",
  };
}

/**
 * Opens the café: loads the saved run if there is a good one, starts fresh if there is none,
 * and stops to ask the player if the save cannot be read. Opening never trades or saves.
 */
export function openShop(catalogue: Catalogue, store: RunStore): Opening {
  const loaded = store.load(catalogue);
  switch (loaded.kind) {
    case "empty":
      return { kind: "ready", shop: new Shop(catalogue, store, newRun(catalogue)), notice: null };
    case "loaded":
      return { kind: "ready", shop: new Shop(catalogue, store, loaded.run), notice: null };
    case "unavailable":
      return {
        kind: "ready",
        shop: new Shop(catalogue, store, newRun(catalogue)),
        notice: `${loaded.problem} You can still play, but your progress may not be kept.`,
      };
    case "damaged":
      return {
        kind: "damaged",
        problem: loaded.problem,
        startFresh: () => startFreshAfterDamage(catalogue, store, loaded.raw),
      };
  }
}
