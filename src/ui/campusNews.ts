import { findProduct, type Catalogue } from "../domain/catalogue";
import { ORDINARY_DAY, type CampusEvent } from "../domain/events";
import { RUN_LENGTH_DAYS } from "../domain/rules";
import { eventFor, isComplete, type Run } from "../domain/run";
import { el } from "./dom";

/** "×1.5" or "×0.5": how much an event multiplies the usual number of customers. */
function multiplier(percent: number): string {
  return `×${String(percent / 100)}`;
}

/** One chip per affected item, e.g. "Flat white ×1.5", marked up or down. */
function effectChips(event: CampusEvent, catalogue: Catalogue): HTMLElement {
  const chips = Object.entries(event.effects).map(([productId, percent]) => {
    const name = findProduct(catalogue, productId)?.name ?? productId;
    const direction = percent > 100 ? "up" : "down";
    return el("li", { class: `news-chip news-${direction}` }, [`${name} ${multiplier(percent)}`]);
  });
  return el("ul", { class: "news-chips", "aria-label": "Items affected" }, chips);
}

function forecastCard(label: string, day: number, run: Run, catalogue: Catalogue): HTMLElement {
  const event = eventFor(run, day);
  const ordinary = event.id === ORDINARY_DAY.id;
  return el("article", { class: `news-card${ordinary ? "" : " news-special"}` }, [
    el("p", { class: "news-when" }, [`${label} · Day ${day}`]),
    el("h3", { class: "news-name" }, [event.name]),
    el("p", { class: "news-headline" }, [event.headline]),
    ...(ordinary ? [] : [effectChips(event, catalogue)]),
  ]);
}

/**
 * The campus news strip: today's event and tomorrow's, so the player can stock up a day
 * early. Days further ahead stay a surprise. Hidden once the run is complete.
 */
export class CampusNews {
  readonly element: HTMLElement;
  private readonly cards: HTMLElement;

  constructor(
    private readonly catalogue: Catalogue,
    run: Run,
  ) {
    this.cards = el("div", { class: "news-cards" });
    this.element = el("section", { class: "campus-news", "aria-labelledby": "news-title" }, [
      el("h2", { id: "news-title" }, ["Campus news"]),
      this.cards,
    ]);
    this.update(run);
  }

  update(run: Run): void {
    this.element.hidden = isComplete(run);
    const today = forecastCard("Today", run.currentDay, run, this.catalogue);
    const isLastDay = run.currentDay >= RUN_LENGTH_DAYS;
    const tomorrow = isLastDay
      ? el("article", { class: "news-card news-final" }, [
          el("p", { class: "news-when" }, ["Tomorrow"]),
          el("h3", { class: "news-name" }, ["Last day"]),
          el("p", { class: "news-headline" }, [
            "The run ends after today. Stock left over counts at what it cost you.",
          ]),
        ])
      : forecastCard("Tomorrow", run.currentDay + 1, run, this.catalogue);
    this.cards.replaceChildren(today, tomorrow);
  }
}
