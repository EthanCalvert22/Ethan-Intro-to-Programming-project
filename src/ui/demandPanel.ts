import { FULL_DEMAND, NO_DEMAND, REDUCED_DEMAND } from "../domain/rules";
import { el, svgFromMarkup } from "./dom";

/** A row of little customer heads; an empty row shows a "nobody" sign instead. */
function crowd(count: number): string {
  if (count === 0) {
    return `
<svg viewBox="0 0 110 44" aria-hidden="true" focusable="false" class="crowd">
  <circle cx="55" cy="22" r="14" fill="none" stroke="currentColor" stroke-width="3"/>
  <path d="M45 32 65 12" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
</svg>`;
  }
  const heads = Array.from({ length: count }, (_unused, index) => {
    const column = index % 5;
    const rowIndex = Math.floor(index / 5);
    const x = 11 + column * 22;
    const y = 12 + rowIndex * 20;
    return `<circle cx="${x}" cy="${y}" r="5"/><path d="M${x - 7} ${y + 13}a7 6 0 0 1 14 0Z"/>`;
  }).join("");
  return `<svg viewBox="0 0 110 44" aria-hidden="true" focusable="false" class="crowd" fill="currentColor">${heads}</svg>`;
}

const tiers = [
  { count: FULL_DEMAND, rule: "Your price is at or below the fair price", tone: "tier-full" },
  { count: REDUCED_DEMAND, rule: "Above the fair price, up to twice it", tone: "tier-half" },
  { count: NO_DEMAND, rule: "More than twice the fair price", tone: "tier-none" },
];

/** The always-visible "How customers decide" panel, with a three-step picture of the demand rule. */
export function renderDemandPanel(): HTMLElement {
  return el("section", { class: "panel demand-panel", "aria-labelledby": "demand-title" }, [
    el("h2", { id: "demand-title" }, ["How customers decide"]),
    el("p", {}, ["Each day, for each item, customers compare your price with its fair price:"]),
    el(
      "ol",
      { class: "demand-steps" },
      tiers.map((tier, index) =>
        el("li", { class: `demand-step ${tier.tone}` }, [
          el("span", { class: "demand-step-number", "aria-hidden": "true" }, [String(index + 1)]),
          svgFromMarkup(crowd(tier.count)),
          el("p", {}, [el("strong", {}, [`${tier.count} customers`]), el("span", {}, [tier.rule])]),
        ]),
      ),
    ),
    el("p", { class: "hint" }, [
      "You sell the smaller of: customers who want it, or what is on your shelf. Prices are compared to the exact cent, and nothing is random. Leftover stock waits on the shelf for tomorrow.",
    ]),
  ]);
}
