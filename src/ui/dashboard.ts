import { findProduct, type Catalogue } from "../domain/catalogue";
import { findEvent, ORDINARY_DAY } from "../domain/events";
import { formatEuros, formatSignedEuros } from "../domain/money";
import { RUN_LENGTH_DAYS } from "../domain/rules";
import type { Run } from "../domain/run";
import { weekStats, type DayFigures, type WeekStats } from "../domain/stats";
import { el, svgFromMarkup, type Child } from "./dom";

/* Chart geometry, in the SVG's own units (it scales to the panel's width). */
const WIDTH = 300;
const TOP = 24;
const PLOT_HEIGHT = 100;
const SLOT = WIDTH / RUN_LENGTH_DAYS;
const BAR = 26;
const BOTTOM_LABELS = 22;
const HEIGHT = TOP + PLOT_HEIGHT + BOTTOM_LABELS;
const RADIUS = 4;
/** Room under the lowest bar for its label, so it never touches the day names. */
const LOSS_LABEL_SPACE = 16;

/** A bar with a rounded far end and a square end on the zero line. */
function barPath(x: number, base: number, end: number): string {
  const up = end < base;
  const r = Math.min(RADIUS, Math.abs(base - end));
  // Stop short of the far end by the corner radius, then curve round to it.
  const tip = up ? end + r : end - r;
  return [
    `M${x} ${base}`,
    `V${tip}`,
    `Q${x} ${end} ${x + r} ${end}`,
    `H${x + BAR - r}`,
    `Q${x + BAR} ${end} ${x + BAR} ${tip}`,
    `V${base}`,
    "Z",
  ].join(" ");
}

/**
 * The daily gross profit chart: one bar per traded day, up for a profit and down for a loss,
 * each labelled with its signed amount. Direction and sign carry the meaning; colour repeats it.
 */
function renderChart(days: readonly DayFigures[]): Element {
  const highest = Math.max(0, ...days.map((day) => day.grossProfitCents));
  const lowest = Math.min(0, ...days.map((day) => day.grossProfitCents));
  const range = highest - lowest;
  // The zero line sits at the bottom when nothing lost money, and moves up when something did.
  const barSpace = PLOT_HEIGHT - (lowest < 0 ? LOSS_LABEL_SPACE : 0);
  const scale = range === 0 ? 0 : barSpace / range;
  const base = TOP + highest * scale;

  const slots = Array.from({ length: RUN_LENGTH_DAYS }, (_unused, index) => {
    const dayNumber = index + 1;
    const x = index * SLOT + (SLOT - BAR) / 2;
    const centre = index * SLOT + SLOT / 2;
    const label = `<text class="chart-day" x="${centre}" y="${HEIGHT - 6}" text-anchor="middle">Day ${dayNumber}</text>`;
    const day = days[index];
    if (day === undefined) {
      return `<g class="chart-future"><rect x="${x}" y="${base - 2}" width="${BAR}" height="2" rx="1"/>${label}</g>`;
    }
    const profit = day.grossProfitCents;
    const end = base - profit * scale;
    const tone = profit < 0 ? "chart-loss" : "chart-gain";
    const valueY = profit < 0 ? end + 14 : end - 6;
    const amount = formatSignedEuros(profit);
    const bar = profit === 0 ? "" : `<path class="${tone}" d="${barPath(x, base, end)}"/>`;
    return `<g class="chart-bar" data-day="${dayNumber}"><title>Day ${dayNumber}: gross profit ${amount}</title>${bar}<text class="chart-value" x="${centre}" y="${valueY}" text-anchor="middle">${amount}</text>${label}</g>`;
  }).join("");

  return svgFromMarkup(
    `<svg class="profit-chart" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-labelledby="chart-title" focusable="false">
      <line class="chart-zero" x1="0" x2="${WIDTH}" y1="${base}" y2="${base}"/>
      ${slots}
    </svg>`,
  );
}

/**
 * The same numbers as the chart, as a table for screen readers. The hidden wrapper matters:
 * a table ignores the 1px width that visually-hidden elements use, and would widen the page.
 */
function renderTable(days: readonly DayFigures[]): HTMLElement {
  return el("div", { class: "sr-only" }, [renderTableRows(days)]);
}

function renderTableRows(days: readonly DayFigures[]): HTMLElement {
  return el("table", {}, [
    el("caption", {}, ["Gross profit by day"]),
    el("thead", {}, [
      el("tr", {}, [
        el("th", { scope: "col" }, ["Day"]),
        el("th", { scope: "col" }, ["Event"]),
        el("th", { scope: "col" }, ["Units sold"]),
        el("th", { scope: "col" }, ["Revenue"]),
        el("th", { scope: "col" }, ["Gross profit"]),
      ]),
    ]),
    el(
      "tbody",
      {},
      days.map((day) =>
        el("tr", {}, [
          el("th", { scope: "row" }, [`Day ${day.day}`]),
          el("td", {}, [findEvent(day.eventId)?.name ?? ORDINARY_DAY.name]),
          el("td", {}, [String(day.unitsSold)]),
          el("td", {}, [formatEuros(day.revenueCents)]),
          el("td", {}, [formatSignedEuros(day.grossProfitCents)]),
        ]),
      ),
    ),
  ]);
}

/** An amount that never breaks across lines (so "+€24.00" stays together). */
function amount(text: string): HTMLElement {
  return el("span", { class: "no-break" }, [text]);
}

function figure(label: string, value: readonly Child[], testId: string, tone = ""): HTMLElement {
  return el("div", {}, [
    el("dt", {}, [label]),
    el("dd", { "data-testid": testId, class: tone }, value),
  ]);
}

function toneOf(cents: number): string {
  if (cents > 0) {
    return "figure-gain";
  }
  return cents < 0 ? "figure-loss" : "";
}

function renderFigures(stats: WeekStats, catalogue: Catalogue): HTMLElement {
  const seller = stats.bestSeller;
  const sellerName = seller === null ? null : findProduct(catalogue, seller.productId)?.name;
  const bestDay = stats.bestDay;
  return el("dl", { class: "week-figures" }, [
    figure(
      "Gross profit so far",
      [amount(formatSignedEuros(stats.totalGrossProfitCents))],
      "week-profit",
    ),
    figure("Spent on upgrades", [amount(formatEuros(stats.upgradeSpendCents))], "week-upgrades"),
    figure(
      "Result so far",
      [amount(formatSignedEuros(stats.resultSoFarCents))],
      "week-result",
      toneOf(stats.resultSoFarCents),
    ),
    figure(
      "Best seller",
      [
        seller === null
          ? "Nothing sold yet"
          : `${sellerName ?? seller.productId} · ${seller.units} sold`,
      ],
      "week-best-seller",
    ),
    figure(
      "Best day",
      bestDay === null
        ? ["-"]
        : [`Day ${bestDay.day} · `, amount(formatSignedEuros(bestDay.grossProfitCents))],
      "week-best-day",
    ),
  ]);
}

/**
 * "Your week so far": the run's results at a glance, updated after every change. The result
 * so far is gross profit minus upgrade spending, which always matches the final gain or loss.
 */
export class ResultsDashboard {
  readonly element: HTMLElement;
  private readonly body: HTMLElement;

  constructor(
    private readonly catalogue: Catalogue,
    run: Run,
  ) {
    this.body = el("div", { class: "dashboard-body" });
    this.element = el(
      "section",
      { class: "panel dashboard", "aria-labelledby": "dashboard-title" },
      [el("h2", { id: "dashboard-title" }, ["Your week so far"]), this.body],
    );
    this.update(run);
  }

  update(run: Run): void {
    const stats = weekStats(run, this.catalogue);
    if (stats.days.length === 0) {
      this.body.replaceChildren(
        el("p", { class: "dashboard-empty" }, [
          "Open for your first day and your results appear here: profit by day, your best seller and your result so far.",
        ]),
      );
      return;
    }
    this.body.replaceChildren(
      renderFigures(stats, this.catalogue),
      el("figure", { class: "chart-figure" }, [
        el("figcaption", { id: "chart-title" }, ["Gross profit by day"]),
        renderChart(stats.days),
        renderTable(stats.days),
      ]),
    );
  }
}
