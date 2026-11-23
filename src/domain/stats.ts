import type { Catalogue } from "./catalogue";
import type { Run } from "./run";
import { upgrades } from "./upgrades";

/*
 * The week at a glance: figures for the results dashboard, worked out from the run's
 * recorded days. Pure, like the rest of the rulebook: it only reads the run.
 */

export interface DayFigures {
  readonly day: number;
  readonly eventId: string;
  readonly unitsSold: number;
  readonly revenueCents: number;
  readonly grossProfitCents: number;
}

export interface WeekStats {
  readonly days: readonly DayFigures[];
  readonly totalUnitsSold: number;
  readonly totalRevenueCents: number;
  readonly totalGrossProfitCents: number;
  /** What the upgrades bought this run cost. */
  readonly upgradeSpendCents: number;
  /**
   * Gross profit so far minus upgrade spending. Buying stock swaps cash for stock at the
   * same value, so this always equals the overall gain or loss on the €100.
   */
  readonly resultSoFarCents: number;
  /** The item with the most units sold; a tie goes to the item first on the menu. */
  readonly bestSeller: { readonly productId: string; readonly units: number } | null;
  /** The day with the highest gross profit; a tie goes to the earlier day. */
  readonly bestDay: { readonly day: number; readonly grossProfitCents: number } | null;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

export function weekStats(run: Run, catalogue: Catalogue): WeekStats {
  const days = run.history.map((record) => ({
    day: record.day,
    eventId: record.eventId,
    unitsSold: record.totals.unitsSold,
    revenueCents: record.totals.revenueCents,
    grossProfitCents: record.totals.grossProfitCents,
  }));
  const totalGrossProfitCents = sum(days.map((day) => day.grossProfitCents));
  const upgradeSpendCents = sum(
    upgrades
      .filter((upgrade) => run.purchasedUpgrades.includes(upgrade.id))
      .map((upgrade) => upgrade.costCents),
  );

  const unitsByProduct = catalogue.map((product) => ({
    productId: product.id,
    units: sum(
      run.history.flatMap((record) =>
        record.lines.filter((line) => line.productId === product.id).map((line) => line.unitsSold),
      ),
    ),
  }));
  // Strictly greater, so the first item on the menu keeps a tie. A menu always has items.
  const topSeller = unitsByProduct.reduce((best, entry) =>
    entry.units > best.units ? entry : best,
  );
  // Strictly greater, so the earlier day keeps a tie.
  const topDay = days.reduce<DayFigures | null>(
    (best, day) => (best === null || day.grossProfitCents > best.grossProfitCents ? day : best),
    null,
  );

  return {
    days,
    totalUnitsSold: sum(days.map((day) => day.unitsSold)),
    totalRevenueCents: sum(days.map((day) => day.revenueCents)),
    totalGrossProfitCents,
    upgradeSpendCents,
    resultSoFarCents: totalGrossProfitCents - upgradeSpendCents,
    bestSeller: topSeller.units === 0 ? null : topSeller,
    bestDay:
      topDay === null ? null : { day: topDay.day, grossProfitCents: topDay.grossProfitCents },
  };
}
