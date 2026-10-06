import { brewAndByteCatalogue, type Catalogue } from "../domain/catalogue";
import { formatEuros } from "../domain/money";
import { RUN_LENGTH_DAYS } from "../domain/rules";
import { daysCompleted, isComplete, summary, type Run } from "../domain/run";
import { browserStorage, MemoryStorage, RunStore, type KeyValueStorage } from "../storage/runStore";
import { Chalkboard } from "./chalkboard";
import { renderDemandPanel } from "./demandPanel";
import { el, svgFromMarkup } from "./dom";
import { renderFinalCard } from "./finalCard";
import { logoIcon } from "./icons";
import { NewRunDialog } from "./newRunDialog";
import { renderReceipt } from "./receipt";
import { ShelfCard } from "./shelfCard";
import { openShop, type ActionOutcome, type Opening, type Shop } from "./shop";

const MEMORY_ONLY_NOTICE =
  "This browser isn't letting me save, so your café will only last until you close this page.";

function masthead(newRunButton: HTMLButtonElement | null): HTMLElement {
  return el("header", { class: "masthead" }, [
    el("div", { class: "brand" }, [
      svgFromMarkup(logoIcon),
      el("div", {}, [
        el("h1", { class: "brand-name" }, ["Brew & Byte"]),
        el("p", { class: "tagline" }, ["Your campus café · five days to make your mark"]),
      ]),
    ]),
    ...(newRunButton === null ? [] : [newRunButton]),
  ]);
}

function howToPlay(): HTMLElement {
  return el("section", { class: "panel how-to", "aria-labelledby": "how-to-title" }, [
    el("h2", { id: "how-to-title" }, ["How to play"]),
    el("ol", {}, [
      el("li", {}, ["You start with €100.00 and an empty shelf."]),
      el("li", {}, ["Order stock for each item: pick a quantity and press Buy."]),
      el("li", {}, ["Set your selling prices. Check “How customers decide” first."]),
      el("li", {}, ["Press Open for the day to trade. Your till receipt shows what sold."]),
      el("li", {}, ["Repeat for five days, then see your final results."]),
    ]),
    el("p", { class: "hint" }, [
      "Your café is saved in this browser after every change, so you can leave and come back between days.",
    ]),
  ]);
}

function describeRun(run: Run): string {
  const where = isComplete(run)
    ? `all ${RUN_LENGTH_DAYS} days traded`
    : `day ${run.currentDay} of ${RUN_LENGTH_DAYS}`;
  return `${where}, ${formatEuros(run.cashCents)} in the till`;
}

/** The café screen: everything the player sees and touches while a run is open. */
class CafeScreen {
  private readonly cards: ShelfCard[];
  private readonly chalkboard: Chalkboard;
  private readonly dialog: NewRunDialog;
  private readonly cashValue = el("dd", { "data-testid": "cash" });
  private readonly dayValue = el("dd", { "data-testid": "day" });
  private readonly shelfValue = el("dd", { "data-testid": "shelf-total" });
  private readonly nextStep = el("p", { class: "next-step", id: "next-step" });
  private readonly message = el("p", {
    class: "message",
    role: "status",
    "aria-live": "polite",
    "data-testid": "message",
  });
  private readonly openButton = el(
    "button",
    { type: "button", class: "button button-primary button-open", "aria-describedby": "next-step" },
    ["Open for the day"],
  );
  private readonly finalSlot = el("div", { class: "final-slot" });
  private readonly chips = el("div", {
    class: "day-chips",
    role: "group",
    "aria-label": "Receipts by day",
  });
  private readonly receiptSlot = el("div", { class: "receipt-slot" });
  private selectedDay: number | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly shop: Shop,
    notice: string | null,
  ) {
    const run = shop.run;
    this.cards = shop.catalogue.map(
      (product) =>
        new ShelfCard(product, run, {
          buy: (productId, quantity) => this.show(this.shop.buy(productId, quantity)),
          setPrice: (productId, priceCents) => this.show(this.shop.setPrice(productId, priceCents)),
          draftChanged: () => {
            this.refreshOpenButton();
          },
          refuse: (text) => {
            this.say(text, "problem");
          },
        }),
    );
    this.chalkboard = new Chalkboard(run);
    this.dialog = new NewRunDialog(() => {
      this.startNewRun();
    });
    const newRunButton = el(
      "button",
      { type: "button", class: "button button-quiet", "aria-haspopup": "dialog" },
      ["New run"],
    );
    newRunButton.addEventListener("click", () => {
      this.askForNewRun();
    });
    this.openButton.addEventListener("click", () => {
      this.trade();
    });
    this.selectedDay = run.history.length > 0 ? run.history.length : null;

    root.replaceChildren(
      el("a", { class: "skip-link", href: "#shelf-title" }, ["Skip to the shelf"]),
      masthead(newRunButton),
      ...(notice === null ? [] : [el("p", { class: "notice", role: "status" }, [notice])]),
      el("main", { id: "main" }, [
        el("section", { class: "till-bar", "aria-labelledby": "till-title" }, [
          el("h2", { id: "till-title", class: "sr-only" }, ["Your café at a glance"]),
          el("dl", { class: "till-stats" }, [
            el("div", {}, [el("dt", {}, ["Day"]), this.dayValue]),
            el("div", {}, [el("dt", {}, ["Cash in the till"]), this.cashValue]),
            el("div", {}, [el("dt", {}, ["Items on the shelf"]), this.shelfValue]),
          ]),
          this.chalkboard.element,
        ]),
        this.nextStep,
        this.message,
        this.finalSlot,
        el("div", { class: "layout" }, [
          el("section", { class: "shelf", "aria-labelledby": "shelf-title" }, [
            el("h2", { id: "shelf-title", tabindex: "-1" }, ["The shelf"]),
            el(
              "div",
              { class: "shelf-cards" },
              this.cards.map((card) => card.element),
            ),
            el("div", { class: "open-bar" }, [this.openButton]),
          ]),
          el("div", { class: "side" }, [
            renderDemandPanel(),
            el("section", { class: "panel till-roll", "aria-labelledby": "receipts-title" }, [
              el("h2", { id: "receipts-title" }, ["Till receipts"]),
              this.chips,
              this.receiptSlot,
            ]),
            howToPlay(),
          ]),
        ]),
      ]),
      el("footer", { class: "footer" }, [
        "Brew & Byte · a Campus Tycoon café · works offline, saved in this browser",
      ]),
      this.dialog.element,
    );
    this.refresh();
  }

  private get run(): Run {
    return this.shop.run;
  }

  /** Shows the result of an action and redraws. Returns whether it was accepted. */
  private show(outcome: ActionOutcome): boolean {
    this.say(outcome.message, outcome.ok ? "success" : "problem");
    this.refresh();
    return outcome.ok;
  }

  private say(text: string, tone: "success" | "problem"): void {
    this.message.textContent = text;
    this.message.dataset.tone = tone;
  }

  private trade(): void {
    // A price typed but not yet set is set first, so the day trades with what is on screen.
    if (!this.cards.every((card) => card.commitPriceDraft())) {
      return;
    }
    const accepted = this.show(this.shop.trade());
    if (accepted) {
      this.selectedDay = this.run.history.length;
      this.refreshReceipts();
      if (isComplete(this.run)) {
        this.root.querySelector<HTMLElement>("#final-title")?.focus();
      }
    }
  }

  private askForNewRun(): void {
    this.dialog.open(describeRun(this.run));
  }

  private startNewRun(): void {
    const outcome = this.shop.startNewRun();
    if (outcome.ok) {
      this.selectedDay = null;
      this.cards.forEach((card) => {
        card.reset(this.run);
      });
    }
    this.show(outcome);
  }

  private refresh(): void {
    const run = this.run;
    this.dayValue.textContent = isComplete(run)
      ? "Complete"
      : `${run.currentDay} of ${RUN_LENGTH_DAYS}`;
    this.cashValue.textContent = formatEuros(run.cashCents);
    const onShelf = Object.values(run.stock).reduce((total, units) => total + units, 0);
    this.shelfValue.textContent = String(onShelf);
    this.chalkboard.update(run);
    this.cards.forEach((card) => {
      card.update(run);
    });
    this.refreshOpenButton();
    this.refreshFinalCard();
    this.refreshReceipts();
  }

  private refreshOpenButton(): void {
    const run = this.run;
    const invalidPrice = this.cards.some((card) => card.hasInvalidPrice());
    const hasStock = Object.values(run.stock).some((units) => units > 0);
    this.openButton.disabled = isComplete(run) || invalidPrice;
    this.openButton.classList.toggle("is-next-step", !isComplete(run) && !invalidPrice && hasStock);
    this.openButton.textContent = isComplete(run)
      ? "Café closed: run complete"
      : `Open for day ${run.currentDay}`;
    this.nextStep.textContent = this.nextStepText(run, invalidPrice, hasStock);
  }

  private nextStepText(run: Run, invalidPrice: boolean, hasStock: boolean): string {
    if (isComplete(run)) {
      return "That's a wrap! All five days are traded. Check your final results, or start a new run.";
    }
    if (invalidPrice) {
      return "Next: fix the price marked in red, then open for the day.";
    }
    if (!hasStock) {
      return daysCompleted(run) === 0
        ? "Next: stock your shelf. Choose how many to order and press Buy."
        : "Next: your shelf is empty. Buy more stock, or open anyway (nothing will sell).";
    }
    return `Next: happy with your prices? Press “Open for day ${run.currentDay}” to trade.`;
  }

  private refreshFinalCard(): void {
    if (!isComplete(this.run)) {
      this.finalSlot.replaceChildren();
      return;
    }
    this.finalSlot.replaceChildren(
      renderFinalCard(summary(this.run, this.shop.catalogue), () => {
        this.askForNewRun();
      }),
    );
  }

  private refreshReceipts(): void {
    const history = this.run.history;
    this.chips.replaceChildren(
      ...Array.from({ length: RUN_LENGTH_DAYS }, (_unused, index) => {
        const day = index + 1;
        const record = history[index];
        const chip = el("button", { type: "button", class: "day-chip", "data-day": String(day) }, [
          el("span", { class: "chip-day" }, [`Day ${day}`]),
          el("span", { class: "chip-detail" }, [
            record === undefined ? "not yet" : formatEuros(record.totals.grossProfitCents),
          ]),
        ]);
        chip.disabled = record === undefined;
        chip.setAttribute("aria-pressed", String(day === this.selectedDay));
        chip.setAttribute(
          "aria-label",
          record === undefined
            ? `Day ${day}: not traded yet`
            : `Day ${day} receipt, gross profit ${formatEuros(record.totals.grossProfitCents)}`,
        );
        chip.addEventListener("click", () => {
          this.selectedDay = day;
          this.refreshReceipts();
        });
        return chip;
      }),
    );
    const selected = this.selectedDay === null ? undefined : history[this.selectedDay - 1];
    this.receiptSlot.replaceChildren(
      selected === undefined
        ? el("p", { class: "receipt-empty" }, [
            "No receipts yet. After you open for the day, the till prints one here.",
          ])
        : renderReceipt(selected, this.shop.catalogue),
    );
  }
}

/** Shown instead of the café when the saved game cannot be read. */
function showDamagedSave(root: HTMLElement, opening: Extract<Opening, { kind: "damaged" }>): void {
  const startFresh = el("button", { type: "button", class: "button button-primary" }, [
    "Start a fresh run",
  ]);
  startFresh.addEventListener("click", () => {
    showOpening(root, opening.startFresh(), null);
  });
  const heading = el("h2", { id: "damaged-title", tabindex: "-1" }, [
    "I couldn't open your saved café",
  ]);
  root.replaceChildren(
    masthead(null),
    el("main", { id: "main" }, [
      el(
        "section",
        { class: "panel damaged-save", role: "alert", "aria-labelledby": "damaged-title" },
        [
          heading,
          el("p", {}, [opening.problem]),
          el("p", {}, [
            "Nothing has been changed or deleted. If you start a fresh run, I'll first keep a copy of the old save in this browser as a backup.",
          ]),
          startFresh,
        ],
      ),
    ]),
  );
  heading.focus();
}

function showOpening(root: HTMLElement, opening: Opening, notice: string | null): void {
  if (opening.kind === "damaged") {
    showDamagedSave(root, opening);
    return;
  }
  new CafeScreen(root, opening.shop, opening.notice ?? notice);
}

function showBrokenMenu(root: HTMLElement, problem: string): void {
  root.replaceChildren(
    masthead(null),
    el("main", { id: "main" }, [
      el("section", { class: "panel damaged-save", role: "alert" }, [
        el("h2", {}, ["The café can't open today"]),
        el("p", {}, [problem]),
      ]),
    ]),
  );
}

/** Starts the game inside `root`, using the browser's storage when it is available. */
export function startApp(
  root: HTMLElement,
  scope: { readonly localStorage: KeyValueStorage },
): void {
  let catalogue: Catalogue;
  try {
    catalogue = brewAndByteCatalogue();
  } catch (error) {
    showBrokenMenu(root, error instanceof Error ? error.message : String(error));
    return;
  }
  const storage = browserStorage(scope);
  const store = new RunStore(storage ?? new MemoryStorage());
  showOpening(root, openShop(catalogue, store), storage === null ? MEMORY_ONLY_NOTICE : null);
}
