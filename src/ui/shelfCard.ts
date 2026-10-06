import type { Product } from "../domain/catalogue";
import { demand } from "../domain/demand";
import { parsePriceText, parseQuantityText } from "../domain/input";
import { formatEuros, formatPriceForInput } from "../domain/money";
import { MAX_ORDER_QUANTITY, MAX_PRICE_CENTS } from "../domain/rules";
import { isComplete, priceOf, stockOf, type Run } from "../domain/run";
import { el, srOnly, svgFromMarkup } from "./dom";
import { productIcon } from "./icons";

/** How much one press of a price nudge button changes the price: 10 cents. */
const PRICE_NUDGE_CENTS = 10;

/** The order box starts at 10, the most customers an item can have in a day. */
const DEFAULT_ORDER_QUANTITY = "10";

export interface ShelfCardActions {
  /** Returns true when the purchase was accepted and saved. */
  buy(productId: string, quantity: number): boolean;
  /** Returns true when the price was accepted and saved. */
  setPrice(productId: string, priceCents: number): boolean;
  /** Tells the screen that a typed (not yet set) price changed, so it can re-check the trade button. */
  draftChanged(): void;
  /** Shows a refusal message without changing anything. */
  refuse(message: string): void;
}

function customers(count: number): string {
  if (count === 0) {
    return "no customers";
  }
  return `${count} customers`;
}

/**
 * One product on the shelf: what it costs, how many are in stock, an order stepper with a
 * live total, and a price box with 10-cent nudges and a live demand hint.
 */
export class ShelfCard {
  readonly element: HTMLElement;
  private run: Run;
  private priceDraftActive = false;

  private readonly stockValue: HTMLElement;
  private readonly quantityInput: HTMLInputElement;
  private readonly quantityLess: HTMLButtonElement;
  private readonly quantityMore: HTMLButtonElement;
  private readonly buyButton: HTMLButtonElement;
  private readonly orderTotal: HTMLElement;
  private readonly priceInput: HTMLInputElement;
  private readonly priceLess: HTMLButtonElement;
  private readonly priceMore: HTMLButtonElement;
  private readonly setPriceButton: HTMLButtonElement;
  private readonly priceHint: HTMLElement;

  constructor(
    private readonly product: Product,
    run: Run,
    private readonly actions: ShelfCardActions,
  ) {
    this.run = run;
    const id = product.id;
    const twiceReference = formatEuros(product.referencePriceCents * 2);

    this.stockValue = el("span", { class: "stock-count", "data-testid": `stock-${id}` });

    this.quantityInput = el("input", {
      id: `quantity-${id}`,
      class: "number-input",
      type: "text",
      inputmode: "numeric",
      autocomplete: "off",
      "aria-describedby": `order-total-${id}`,
    });
    this.quantityInput.value = DEFAULT_ORDER_QUANTITY;
    this.quantityLess = el("button", { type: "button", class: "step-button" }, [
      el("span", { "aria-hidden": "true" }, ["−"]),
      srOnly(`One fewer ${product.name}`),
    ]);
    this.quantityMore = el("button", { type: "button", class: "step-button" }, [
      el("span", { "aria-hidden": "true" }, ["+"]),
      srOnly(`One more ${product.name}`),
    ]);
    this.buyButton = el("button", { type: "submit", class: "button button-secondary" }, [
      "Buy",
      srOnly(` ${product.name}`),
    ]);
    this.orderTotal = el("p", { id: `order-total-${id}`, class: "hint", "aria-live": "polite" });

    this.priceInput = el("input", {
      id: `price-${id}`,
      class: "number-input price-input",
      type: "text",
      inputmode: "decimal",
      autocomplete: "off",
      "aria-describedby": `price-hint-${id}`,
    });
    this.priceLess = el("button", { type: "button", class: "step-button" }, [
      el("span", { "aria-hidden": "true" }, ["−"]),
      srOnly(`Lower the ${product.name} price by 10 cents`),
    ]);
    this.priceMore = el("button", { type: "button", class: "step-button" }, [
      el("span", { "aria-hidden": "true" }, ["+"]),
      srOnly(`Raise the ${product.name} price by 10 cents`),
    ]);
    this.setPriceButton = el("button", { type: "submit", class: "button button-quiet" }, [
      "Set price",
      srOnly(` for ${product.name}`),
    ]);
    this.priceHint = el("p", { id: `price-hint-${id}`, class: "hint", "aria-live": "polite" });

    const orderForm = el("form", { class: "card-form", "aria-label": `Order ${product.name}` }, [
      el("label", { for: `quantity-${id}` }, ["How many to order"]),
      el("div", { class: "stepper" }, [this.quantityLess, this.quantityInput, this.quantityMore]),
      this.buyButton,
      this.orderTotal,
    ]);
    const priceForm = el(
      "form",
      { class: "card-form", "aria-label": `Price for ${product.name}` },
      [
        el("label", { for: `price-${id}` }, ["Selling price (€)"]),
        el("div", { class: "stepper" }, [this.priceLess, this.priceInput, this.priceMore]),
        this.setPriceButton,
        this.priceHint,
      ],
    );

    this.element = el(
      "article",
      { class: "shelf-card", "aria-labelledby": `name-${id}`, "data-product": id },
      [
        el("header", { class: "shelf-card-header" }, [
          el("span", { class: "product-icon" }, [svgFromMarkup(productIcon(id))]),
          el("div", {}, [
            el("h3", { id: `name-${id}` }, [product.name]),
            el("p", { class: "product-facts" }, [
              `Costs you ${formatEuros(product.unitCostCents)} · Fair price ${formatEuros(product.referencePriceCents)}`,
            ]),
          ]),
        ]),
        el("p", { class: "stock-line" }, ["On the shelf: ", this.stockValue]),
        orderForm,
        priceForm,
        el("p", { class: "hint tier-note" }, [
          `Above ${formatEuros(product.referencePriceCents)} only 5 customers come; above ${twiceReference} nobody does.`,
        ]),
      ],
    );

    this.quantityInput.addEventListener("input", () => {
      this.refreshOrder();
    });
    this.quantityLess.addEventListener("click", () => {
      this.stepQuantity(-1);
    });
    this.quantityMore.addEventListener("click", () => {
      this.stepQuantity(1);
    });
    orderForm.addEventListener("submit", (event) => {
      event.preventDefault();
      this.submitOrder();
    });

    this.priceInput.addEventListener("input", () => {
      this.priceDraftActive = true;
      this.refreshPrice();
      this.actions.draftChanged();
    });
    this.priceLess.addEventListener("click", () => {
      this.nudgePrice(-PRICE_NUDGE_CENTS);
    });
    this.priceMore.addEventListener("click", () => {
      this.nudgePrice(PRICE_NUDGE_CENTS);
    });
    priceForm.addEventListener("submit", (event) => {
      event.preventDefault();
      this.commitPriceDraft();
    });

    this.update(run);
  }

  /** Redraws the card from the saved run. A price the player is still typing is left alone. */
  update(run: Run): void {
    this.run = run;
    this.stockValue.textContent = String(stockOf(run, this.product.id));
    if (!this.priceDraftActive) {
      this.priceInput.value = formatPriceForInput(priceOf(run, this.product));
    }
    this.refreshOrder();
    this.refreshPrice();
  }

  /** Called when a new run starts: the boxes go back to their starting values. */
  reset(run: Run): void {
    this.quantityInput.value = DEFAULT_ORDER_QUANTITY;
    this.priceDraftActive = false;
    this.update(run);
  }

  /** True when the price box holds text that is not a valid price. Trading waits until it is fixed. */
  hasInvalidPrice(): boolean {
    return this.priceDraftActive && !parsePriceText(this.priceInput.value).ok;
  }

  /**
   * Sets a typed price that has not been set yet. Returns false only if a valid
   * typed price could not be saved, so the caller knows not to trade with the old one.
   */
  commitPriceDraft(): boolean {
    if (!this.priceDraftActive) {
      return true;
    }
    const parsed = parsePriceText(this.priceInput.value);
    if (!parsed.ok) {
      this.actions.refuse(`${this.product.name}: ${parsed.error.message}`);
      return true;
    }
    this.priceDraftActive = false;
    if (parsed.value === priceOf(this.run, this.product)) {
      this.update(this.run);
      this.actions.draftChanged();
      return true;
    }
    return this.actions.setPrice(this.product.id, parsed.value);
  }

  private get closed(): boolean {
    return isComplete(this.run);
  }

  private refreshOrder(): void {
    const parsed = parseQuantityText(this.quantityInput.value);
    const quantity = parsed.ok ? parsed.value : null;
    this.quantityLess.disabled = this.closed || quantity === null || quantity <= 1;
    this.quantityMore.disabled =
      this.closed || (quantity !== null && quantity >= MAX_ORDER_QUANTITY);
    this.quantityInput.disabled = this.closed;
    if (this.closed) {
      this.setOrderHint("The café is closed for this run.", false);
      this.buyButton.disabled = true;
      return;
    }
    if (!parsed.ok) {
      this.setOrderHint(parsed.error.message, true);
      this.buyButton.disabled = true;
      return;
    }
    const costCents = parsed.value * this.product.unitCostCents;
    const affordable = costCents <= this.run.cashCents;
    this.buyButton.disabled = !affordable;
    this.setOrderHint(
      affordable
        ? `Total cost: ${formatEuros(costCents)}`
        : `Oops, that comes to ${formatEuros(costCents)}, but you only have ${formatEuros(this.run.cashCents)} left.`,
      !affordable,
    );
  }

  private setOrderHint(text: string, isProblem: boolean): void {
    this.orderTotal.textContent = text;
    this.orderTotal.classList.toggle("hint-problem", isProblem);
    this.quantityInput.setAttribute("aria-invalid", String(isProblem && !this.closed));
  }

  private refreshPrice(): void {
    const saved = priceOf(this.run, this.product);
    const parsed = parsePriceText(this.priceInput.value);
    const shown = parsed.ok ? parsed.value : saved;
    this.priceInput.disabled = this.closed;
    this.priceLess.disabled = this.closed || shown - PRICE_NUDGE_CENTS < 1;
    this.priceMore.disabled = this.closed || shown + PRICE_NUDGE_CENTS > MAX_PRICE_CENTS;
    this.setPriceButton.disabled = this.closed || !parsed.ok || parsed.value === saved;
    this.priceInput.setAttribute("aria-invalid", String(!parsed.ok && !this.closed));
    this.priceHint.classList.toggle("hint-problem", !parsed.ok && !this.closed);
    if (this.closed) {
      this.priceHint.textContent = `Final price: ${formatEuros(saved)}.`;
    } else if (!parsed.ok) {
      this.priceHint.textContent = parsed.error.message;
    } else {
      const wanted = customers(demand(parsed.value, this.product.referencePriceCents));
      const pending = parsed.value === saved ? "" : " Press Set price or Enter to use it.";
      this.priceHint.textContent = `At ${formatEuros(parsed.value)}, ${wanted} will want one each day.${pending}`;
    }
  }

  private stepQuantity(change: number): void {
    const parsed = parseQuantityText(this.quantityInput.value);
    const current = parsed.ok ? parsed.value : 1;
    const next = Math.min(MAX_ORDER_QUANTITY, Math.max(1, current + change));
    this.quantityInput.value = String(next);
    this.refreshOrder();
  }

  private submitOrder(): void {
    const parsed = parseQuantityText(this.quantityInput.value);
    if (!parsed.ok) {
      this.actions.refuse(`${this.product.name}: ${parsed.error.message}`);
      return;
    }
    this.actions.buy(this.product.id, parsed.value);
  }

  private nudgePrice(change: number): void {
    const parsed = parsePriceText(this.priceInput.value);
    const base = parsed.ok ? parsed.value : priceOf(this.run, this.product);
    this.priceDraftActive = false;
    this.actions.setPrice(this.product.id, base + change);
  }
}
