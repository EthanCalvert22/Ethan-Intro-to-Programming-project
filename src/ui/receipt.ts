import { findProduct, type Catalogue } from "../domain/catalogue";
import { formatEuros } from "../domain/money";
import type { DayLine, DayResult } from "../domain/run";
import { el } from "./dom";

/** One "label .... value" row of the receipt. */
function row(label: string, value: string, className = "receipt-row"): HTMLElement {
  return el("div", { class: className }, [el("dt", {}, [label]), el("dd", {}, [value])]);
}

function itemBlock(line: DayLine, catalogue: Catalogue): HTMLElement {
  const name = findProduct(catalogue, line.productId)?.name ?? line.productId;
  return el("li", { class: "receipt-item", "data-product": line.productId }, [
    el("p", { class: "receipt-item-title" }, [
      el("span", {}, [name]),
      el("span", {}, [`${line.unitsSold} × ${formatEuros(line.priceCents)}`]),
    ]),
    el("dl", {}, [
      row("Customers who wanted one", String(line.demand)),
      row("Units sold", String(line.unitsSold)),
      row("Revenue", formatEuros(line.revenueCents)),
      row("Cost of goods sold", formatEuros(line.cogsCents)),
      row("Gross profit", formatEuros(line.grossProfitCents)),
    ]),
  ]);
}

/** A day's results, laid out like a till receipt: one block per item, then the totals. */
export function renderReceipt(day: DayResult, catalogue: Catalogue): HTMLElement {
  return el(
    "article",
    {
      class: "receipt",
      "aria-labelledby": `receipt-title-${day.day}`,
      "data-day": String(day.day),
    },
    [
      el("header", { class: "receipt-header" }, [
        el("p", { class: "receipt-shop", "aria-hidden": "true" }, ["BREW & BYTE"]),
        el("h3", { id: `receipt-title-${day.day}` }, [`Day ${day.day} receipt`]),
      ]),
      el(
        "ul",
        { class: "receipt-items" },
        day.lines.map((line) => itemBlock(line, catalogue)),
      ),
      el("dl", { class: "receipt-totals", "aria-label": `Day ${day.day} totals` }, [
        row("Total units sold", String(day.totals.unitsSold)),
        row("Total revenue", formatEuros(day.totals.revenueCents)),
        row("Total cost of goods sold", formatEuros(day.totals.cogsCents)),
        row(
          "Total gross profit",
          formatEuros(day.totals.grossProfitCents),
          "receipt-row receipt-grand",
        ),
        row("Cash in the till after", formatEuros(day.cashAfterCents)),
      ]),
      el("p", { class: "receipt-thanks" }, ["thanks for trading!"]),
    ],
  );
}
