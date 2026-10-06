import { describe, expect, it } from "vitest";
import acceptanceFile from "../spec/acceptance.json";
import type { Catalogue } from "../src/domain/catalogue";
import { demand } from "../src/domain/demand";
import { parsePriceText, parseQuantityText } from "../src/domain/input";
import { findRunProblem } from "../src/domain/invariants";
import { daysCompleted, newRun, priceOf, summary, type Run } from "../src/domain/run";
import { RUN_KEY, RunStore } from "../src/storage/runStore";
import { openShop, type ActionOutcome, type Shop } from "../src/ui/shop";
import { briefMenu, cafe, CountingStorage } from "./helpers";

/*
 * Runs every case in spec/acceptance.json through the same Shop the app uses,
 * with a counting stand-in for localStorage. The behaviour is defined by the data file.
 */

type Expect = { ok: true } | { error: string };

interface StateCheck {
  cashCents?: number;
  stock?: Record<string, number>;
  prices?: Record<string, number>;
  currentDay?: number;
  status?: string;
  daysCompleted?: number;
}

interface Step {
  do: "buy" | "buyText" | "setPrice" | "setPriceText" | "trade" | "restart" | "newRun";
  product?: string;
  quantity?: number;
  priceCents?: number;
  text?: string;
  confirm?: boolean;
  expect: Expect;
  state?: StateCheck;
  day?: Record<string, unknown>;
  demand?: Record<string, number>;
  summary?: Record<string, number>;
}

interface Scenario {
  id: string;
  title: string;
  catalogue: "brief" | "brew-and-byte";
  start?: { cashCents?: number; stock?: Record<string, number> };
  steps: Step[];
}

interface AcceptanceSpec {
  demandCases: { case: string; referenceCents: number; priceCents: number; demand: number }[];
  priceInputCases: { text: string; cents?: number; error?: string }[];
  quantityInputCases: { text: string; quantity?: number; error?: string }[];
  scenarios: Scenario[];
}

const spec = acceptanceFile as unknown as AcceptanceSpec;

const catalogues: Record<Scenario["catalogue"], Catalogue> = {
  brief: briefMenu,
  "brew-and-byte": cafe,
};

function openReady(catalogue: Catalogue, storage: CountingStorage): Shop {
  const opening = openShop(catalogue, new RunStore(storage));
  if (opening.kind !== "ready") {
    throw new Error(`Expected the shop to open, got: ${opening.problem}`);
  }
  return opening.shop;
}

function startingRun(scenario: Scenario, catalogue: Catalogue): Run {
  const fresh = newRun(catalogue);
  return {
    ...fresh,
    cashCents: scenario.start?.cashCents ?? fresh.cashCents,
    stock: { ...fresh.stock, ...scenario.start?.stock },
  };
}

function perform(shop: Shop, step: Step): ActionOutcome | "no-action" {
  const product = step.product ?? "";
  switch (step.do) {
    case "buy":
      return shop.buy(product, step.quantity ?? Number.NaN);
    case "buyText": {
      const parsed = parseQuantityText(step.text ?? "");
      return parsed.ok ? shop.buy(product, parsed.value) : { ok: false, ...parsed.error };
    }
    case "setPrice":
      return shop.setPrice(product, step.priceCents ?? Number.NaN);
    case "setPriceText": {
      const parsed = parsePriceText(step.text ?? "");
      return parsed.ok ? shop.setPrice(product, parsed.value) : { ok: false, ...parsed.error };
    }
    case "trade":
      return shop.trade();
    case "newRun":
      // Cancelling the confirmation dialog means the shop is never asked to do anything.
      return step.confirm === true ? shop.startNewRun() : "no-action";
    case "restart":
      return "no-action";
  }
}

function checkState(run: Run, check: StateCheck): void {
  const actual = {
    cashCents: run.cashCents,
    stock: run.stock,
    prices: run.prices,
    currentDay: run.currentDay,
    status: run.status,
    daysCompleted: daysCompleted(run),
  };
  expect(actual).toMatchObject(check);
}

describe("spec/acceptance.json: demand cases", () => {
  it.each(spec.demandCases)(
    "$case: price $priceCents vs reference $referenceCents gives $demand",
    (entry) => {
      expect(demand(entry.priceCents, entry.referenceCents)).toBe(entry.demand);
    },
  );
});

describe("spec/acceptance.json: price input cases", () => {
  it.each(spec.priceInputCases)("price text $text", (entry) => {
    const parsed = parsePriceText(entry.text);
    if (entry.error === undefined) {
      expect(parsed).toEqual({ ok: true, value: entry.cents });
    } else {
      expect(parsed.ok ? "accepted" : parsed.error.kind).toBe(entry.error);
    }
  });
});

describe("spec/acceptance.json: quantity input cases", () => {
  it.each(spec.quantityInputCases)("quantity text $text", (entry) => {
    const parsed = parseQuantityText(entry.text);
    if (entry.error === undefined) {
      expect(parsed).toEqual({ ok: true, value: entry.quantity });
    } else {
      expect(parsed.ok ? "accepted" : parsed.error.kind).toBe(entry.error);
    }
  });
});

describe("spec/acceptance.json: scenarios", () => {
  it("contains every scenario from the brief", () => {
    const ids = spec.scenarios.map((scenario) => scenario.id);
    expect(ids).toEqual(expect.arrayContaining(["A1", "A2", "A3", "A4", "A5", "A6"]));
  });

  it.each(spec.scenarios.map((scenario) => [scenario.id, scenario.title, scenario] as const))(
    "%s: %s",
    (_id, _title, scenario) => {
      const catalogue = catalogues[scenario.catalogue];
      const storage = new CountingStorage();
      const start = startingRun(scenario, catalogue);
      expect(findRunProblem(start, catalogue)).toBeNull();
      if (scenario.start !== undefined) {
        expect(new RunStore(storage).save(start)).toEqual({ ok: true });
      }
      let shop = openReady(catalogue, storage);
      expect(shop.run).toEqual(start);

      scenario.steps.forEach((step, index) => {
        const label = `${scenario.id} step ${index + 1} (${step.do})`;
        const before = structuredClone(shop.run);
        const writesBefore = storage.writes;

        if (step.do === "restart") {
          // A brand new Shop reading only what is in storage, like reopening the app.
          shop = openReady(catalogue, storage);
          expect(shop.run, label).toEqual(before);
        }
        const outcome = perform(shop, step);
        const writes = storage.writes - writesBefore;

        if ("error" in step.expect) {
          expect(
            outcome === "no-action" ? "accepted" : outcome.ok ? "accepted" : outcome.kind,
            label,
          ).toBe(step.expect.error);
          expect(shop.run, `${label}: a rejected action must change nothing`).toEqual(before);
          expect(writes, `${label}: a rejected action must save nothing`).toBe(0);
        } else if (outcome === "no-action") {
          expect(shop.run, label).toEqual(before);
          expect(writes, `${label}: nothing to save`).toBe(0);
        } else {
          expect(outcome.ok ? "accepted" : `${outcome.kind}: ${outcome.message}`, label).toBe(
            "accepted",
          );
          expect(writes, `${label}: an accepted action is saved exactly once`).toBe(1);
          expect(JSON.parse(storage.getItem(RUN_KEY) ?? "null"), `${label}: saved at once`).toEqual(
            shop.run,
          );
        }

        expect(findRunProblem(shop.run, catalogue), label).toBeNull();
        if (step.state !== undefined) {
          checkState(shop.run, step.state);
        }
        if (step.day !== undefined) {
          const lastDay = shop.run.history[shop.run.history.length - 1];
          const { lines, ...rest } = step.day as { lines?: Record<string, object> };
          expect(lastDay, label).toMatchObject(rest);
          for (const [productId, line] of Object.entries(lines ?? {})) {
            const actualLine = lastDay?.lines.find((entry) => entry.productId === productId);
            expect(actualLine, `${label}: ${productId}`).toMatchObject(line);
          }
        }
        if (step.demand !== undefined) {
          for (const [productId, expected] of Object.entries(step.demand)) {
            const product = catalogue.find((entry) => entry.id === productId);
            expect(product, label).toBeDefined();
            if (product !== undefined) {
              expect(demand(priceOf(shop.run, product), product.referencePriceCents)).toBe(
                expected,
              );
            }
          }
        }
        if (step.summary !== undefined) {
          expect(summary(shop.run, catalogue), label).toEqual(step.summary);
        }
      });
    },
  );
});
