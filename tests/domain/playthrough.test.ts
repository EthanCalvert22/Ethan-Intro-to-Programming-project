import { describe, expect, it } from "vitest";
import { buy, newRun, setPrice, summary, tradeDay, type Run } from "../../src/domain/run";
import type { Outcome } from "../../src/domain/result";
import { cafe } from "../helpers";

/*
 * A full five-day run of Brew & Byte, worked out by hand first.
 * Unit costs: flat white 120, toastie 200, brownie 70. References: 280, 450, 180 (cents).
 *
 * Start:  cash 10000, empty shelf.
 * Day 1:  buy 20 FW (2400), 10 T (2000), 15 B (1050)              cash 10000 - 5450 = 4550
 *         prices at reference, demand 10 each
 *         sold FW 10 x 280 = 2800, T 10 x 450 = 4500, B 10 x 180 = 1800   revenue 9100
 *         COGS 1200 + 2000 + 700 = 3900, gross profit 5200            cash 4550 + 9100 = 13650
 *         shelf: FW 10, T 0, B 5
 * Day 2:  FW price 400 (above 280, within 560: demand 5); B price 360 (exactly 2x: demand 5)
 *         buy 5 T (1000)                                             cash 12650
 *         sold FW 5 x 400 = 2000, T 5 x 450 = 2250, B 5 x 360 = 1800      revenue 6050
 *         COGS 600 + 1000 + 350 = 1950, gross profit 4100             cash 18700
 *         shelf: FW 5, T 0, B 0
 * Day 3:  T price 901 (above 900: demand 0); buy 4 T (800)           cash 17900
 *         sold FW 5 x 400 = 2000; T none; B none                     revenue 2000
 *         COGS 600, gross profit 1400                                cash 19900
 *         shelf: FW 0, T 4, B 0
 * Day 4:  nothing can sell                                           gross profit 0, cash 19900
 * Day 5:  T price 450, B price 180, buy 12 B (840)                   cash 19060
 *         sold T 4 x 450 = 1800, B 10 x 180 = 1800                   revenue 3600
 *         COGS 800 + 700 = 1500, gross profit 2100                   cash 22660
 *         shelf: B 2
 *
 * Final:  cash 22660, remaining stock 2 x 70 = 140
 *         gain = 22660 + 140 - 10000 = 12800
 *         sum of daily gross profit = 5200 + 4100 + 1400 + 0 + 2100 = 12800
 */

type LoggedAction =
  | { kind: "buy"; productId: string; quantity: number }
  | { kind: "price"; productId: string; priceCents: number }
  | { kind: "trade" };

const script: LoggedAction[] = [
  { kind: "buy", productId: "flat-white", quantity: 20 },
  { kind: "buy", productId: "toastie", quantity: 10 },
  { kind: "buy", productId: "brownie", quantity: 15 },
  { kind: "trade" },
  { kind: "price", productId: "flat-white", priceCents: 400 },
  { kind: "price", productId: "brownie", priceCents: 360 },
  { kind: "buy", productId: "toastie", quantity: 5 },
  { kind: "trade" },
  { kind: "price", productId: "toastie", priceCents: 901 },
  { kind: "buy", productId: "toastie", quantity: 4 },
  { kind: "trade" },
  { kind: "trade" },
  { kind: "price", productId: "toastie", priceCents: 450 },
  { kind: "price", productId: "brownie", priceCents: 180 },
  { kind: "buy", productId: "brownie", quantity: 12 },
  { kind: "trade" },
];

/** The units the hand calculation above says each day sells, per product. */
const handSales = [
  { "flat-white": 10, toastie: 10, brownie: 10 },
  { "flat-white": 5, toastie: 5, brownie: 5 },
  { "flat-white": 5, toastie: 0, brownie: 0 },
  { "flat-white": 0, toastie: 0, brownie: 0 },
  { "flat-white": 0, toastie: 4, brownie: 10 },
];

function run(action: LoggedAction, current: Run): Outcome<Run> {
  switch (action.kind) {
    case "buy":
      return buy(current, cafe, action.productId, action.quantity);
    case "price":
      return setPrice(current, cafe, action.productId, action.priceCents);
    case "trade":
      return tradeDay(current, cafe);
  }
}

function play(): Run {
  return script.reduce((current, action) => {
    const outcome = run(action, current);
    if (!outcome.ok) {
      throw new Error(outcome.error.message);
    }
    return outcome.value;
  }, newRun(cafe));
}

describe("a full five-day Brew & Byte run", () => {
  const finished = play();

  it("matches the hand-calculated daily gross profit and cash", () => {
    expect(finished.history.map((day) => day.totals.grossProfitCents)).toEqual([
      5200, 4100, 1400, 0, 2100,
    ]);
    expect(finished.history.map((day) => day.cashAfterCents)).toEqual([
      13650, 18700, 19900, 19900, 22660,
    ]);
    expect(
      finished.history.map((day) =>
        Object.fromEntries(day.lines.map((line) => [line.productId, line.unitsSold])),
      ),
    ).toEqual(handSales);
  });

  it("ends complete with the hand-calculated final result", () => {
    expect(finished.status).toBe("completed");
    expect(summary(finished, cafe)).toEqual({
      finalCashCents: 22660,
      remainingStockValueCents: 140,
      gainLossCents: 12800,
    });
  });

  it("reconciles against the action log, computed without the code under test", () => {
    // Everything below uses only the script, the hand-counted sales and the menu prices.
    const unitCost: Record<string, number> = { "flat-white": 120, toastie: 200, brownie: 70 };
    let spentOnStock = 0;
    const bought: Record<string, number> = { "flat-white": 0, toastie: 0, brownie: 0 };
    const price: Record<string, number> = { "flat-white": 280, toastie: 450, brownie: 180 };
    let revenue = 0;
    let costOfGoodsSold = 0;
    let day = 0;
    for (const action of script) {
      if (action.kind === "buy") {
        spentOnStock += action.quantity * (unitCost[action.productId] ?? 0);
        bought[action.productId] = (bought[action.productId] ?? 0) + action.quantity;
      } else if (action.kind === "price") {
        price[action.productId] = action.priceCents;
      } else {
        const sales: Record<string, number> = handSales[day] ?? {};
        for (const [productId, units] of Object.entries(sales)) {
          revenue += units * (price[productId] ?? 0);
          costOfGoodsSold += units * (unitCost[productId] ?? 0);
        }
        day += 1;
      }
    }
    const sold = (productId: string) =>
      handSales.reduce((total, sales) => total + sales[productId as keyof typeof sales], 0);
    const unsoldValue = Object.keys(unitCost).reduce(
      (total, productId) =>
        total + ((bought[productId] ?? 0) - sold(productId)) * (unitCost[productId] ?? 0),
      0,
    );
    const expectedCash = 10000 - spentOnStock + revenue;
    const sumOfGrossProfit = revenue - costOfGoodsSold;

    const result = summary(finished, cafe);
    expect(result.finalCashCents).toBe(expectedCash);
    expect(result.remainingStockValueCents).toBe(unsoldValue);
    expect(result.gainLossCents).toBe(expectedCash + unsoldValue - 10000);
    expect(result.gainLossCents).toBe(sumOfGrossProfit);
    // Cash alone moved by the gross profit minus what is still sitting on the shelf.
    expect(result.finalCashCents - 10000).toBe(sumOfGrossProfit - unsoldValue);
    expect(
      finished.history.reduce((total, record) => total + record.totals.grossProfitCents, 0),
    ).toBe(sumOfGrossProfit);
  });
});
