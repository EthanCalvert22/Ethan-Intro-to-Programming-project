// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { newRun } from "../../src/domain/run";
import { BACKUP_KEY, RUN_KEY, type KeyValueStorage } from "../../src/storage/runStore";
import { startApp } from "../../src/ui/app";
import { productIcon } from "../../src/ui/icons";
import { renderReceipt } from "../../src/ui/receipt";
import { cafe, CountingStorage } from "../helpers";

/*
 * These tests drive the real screen code in a simulated browser (jsdom).
 * The Playwright suite in e2e/ repeats the important journeys in real Chromium.
 */

beforeAll(() => {
  // jsdom does not implement modal dialogs; this stand-in behaves like the browser's for our use.
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & Record<string, unknown>;
  if (typeof proto.showModal !== "function") {
    proto.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
  }
  if (typeof proto.close !== "function") {
    proto.close = function close(this: HTMLDialogElement, value?: string) {
      if (value !== undefined) this.returnValue = value;
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    };
  }
});

let root: HTMLElement;
let storage: CountingStorage;

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  root = document.getElementById("app") as HTMLElement;
  storage = new CountingStorage();
});

afterEach(() => {
  vi.doUnmock("../../src/domain/catalogue");
  vi.resetModules();
});

const $ = <T extends Element = HTMLElement>(selector: string): T => {
  const found = root.querySelector<T>(selector);
  if (found === null) throw new Error(`Nothing matches ${selector}`);
  return found;
};
const text = (selector: string) => $(selector).textContent;
const testId = (id: string) => text(`[data-testid="${id}"]`);

function button(name: RegExp | string, scope: ParentNode = root): HTMLButtonElement {
  const match = [...scope.querySelectorAll("button")].find((candidate) =>
    typeof name === "string"
      ? candidate.textContent.trim() === name
      : name.test(candidate.textContent),
  );
  if (match === undefined) throw new Error(`No button ${String(name)}`);
  return match;
}

function type(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function submit(form: HTMLFormElement): void {
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

function quantityInput(productId: string) {
  return $<HTMLInputElement>(`#quantity-${productId}`);
}
function priceInput(productId: string) {
  return $<HTMLInputElement>(`#price-${productId}`);
}

function buy(productId: string, quantity: number): void {
  type(quantityInput(productId), String(quantity));
  submit(quantityInput(productId).form as HTMLFormElement);
}

function setPrice(productId: string, value: string): void {
  type(priceInput(productId), value);
  submit(priceInput(productId).form as HTMLFormElement);
}

function openButton(): HTMLButtonElement {
  return $<HTMLButtonElement>(".button-open");
}

function start(): void {
  startApp(root, { localStorage: storage });
}

function closeDialog(value: string): void {
  $<HTMLDialogElement>("dialog").close(value);
}

describe("first visit", () => {
  it("shows a fresh café without asking anything and without saving", () => {
    start();
    expect(testId("cash")).toBe("€100.00");
    expect(testId("day")).toBe("1 of 5");
    expect(testId("day-progress")).toBe("Day 1 of 5");
    expect(testId("shelf-total")).toBe("0");
    expect(text("#next-step")).toContain("stock your shelf");
    expect(text(".receipt-empty")).toContain("No receipts yet");
    expect(root.querySelector(".notice")).toBeNull();
    expect(root.querySelectorAll("article.shelf-card")).toHaveLength(3);
    expect(text("#demand-title")).toBe("How customers decide");
    expect(storage.writes).toBe(0);
  });

  it("marks today on the chalkboard", () => {
    start();
    const steps = root.querySelectorAll(".chalk-step");
    expect(steps[0]?.getAttribute("aria-current")).toBe("step");
    expect(steps[1]?.className).toContain("chalk-upcoming");
  });
});

describe("buying stock", () => {
  it("shows the live total and buys on submit, saving immediately", () => {
    start();
    type(quantityInput("toastie"), "10");
    expect(text("#order-total-toastie")).toBe("Total cost: €20.00");
    submit(quantityInput("toastie").form as HTMLFormElement);
    expect(testId("message")).toBe("Bought 10 × Toastie for €20.00. €80.00 left in the till.");
    expect(testId("cash")).toBe("€80.00");
    expect(testId("stock-toastie")).toBe("10");
    expect(storage.writes).toBe(1);
    expect(openButton().classList.contains("is-next-step")).toBe(true);
    expect(text("#next-step")).toContain("happy with your prices");
  });

  it("disables Buy and explains when the order costs more than the cash", () => {
    start();
    buy("toastie", 10);
    type(quantityInput("toastie"), "41");
    expect(text("#order-total-toastie")).toBe(
      "Oops, that comes to €82.00, but you only have €80.00 left.",
    );
    expect(button(/^Buy Toastie/).disabled).toBe(true);
    expect(quantityInput("toastie").getAttribute("aria-invalid")).toBe("true");
  });

  it("refuses a malformed quantity without saving", () => {
    start();
    type(quantityInput("brownie"), "2.5");
    expect(text("#order-total-brownie")).toContain("whole number");
    expect(button(/^Buy Brownie/).disabled).toBe(true);
    submit(quantityInput("brownie").form as HTMLFormElement);
    expect(testId("message")).toBe(
      "Brownie: I can only order whole items, so please use a whole number like 5.",
    );
    expect(storage.writes).toBe(0);
  });

  it("steps the quantity with the - and + buttons, within 1 to 1,000", () => {
    start();
    const less = button(/One fewer Flat white/);
    const more = button(/One more Flat white/);
    more.click();
    expect(quantityInput("flat-white").value).toBe("11");
    type(quantityInput("flat-white"), "1");
    expect(less.disabled).toBe(true);
    type(quantityInput("flat-white"), "1000");
    expect(more.disabled).toBe(true);
    type(quantityInput("flat-white"), "oops");
    more.click();
    expect(quantityInput("flat-white").value).toBe("2");
    less.click();
    expect(quantityInput("flat-white").value).toBe("1");
  });
});

describe("setting prices", () => {
  it("describes demand live and sets the price on submit", () => {
    start();
    type(priceInput("toastie"), "4.51");
    expect(text("#price-hint-toastie")).toBe(
      "At €4.51, 5 customers will want one each day. Press Set price or Enter to use it.",
    );
    submit(priceInput("toastie").form as HTMLFormElement);
    expect(testId("message")).toBe("Toastie now sells for €4.51.");
    expect(priceInput("toastie").value).toBe("4.51");
    expect(text("#price-hint-toastie")).toBe("At €4.51, 5 customers will want one each day.");
    expect(storage.writes).toBe(1);
  });

  it("says when nobody will buy", () => {
    start();
    type(priceInput("brownie"), "3.61");
    expect(text("#price-hint-brownie")).toContain("no customers will want one");
  });

  it("blocks trading while a price box holds an invalid price", () => {
    start();
    type(priceInput("toastie"), "0");
    expect(text("#price-hint-toastie")).toBe("A price has to be more than €0.00.");
    expect(openButton().disabled).toBe(true);
    expect(text("#next-step")).toContain("fix the price");
    submit(priceInput("toastie").form as HTMLFormElement);
    expect(testId("message")).toBe("Toastie: A price has to be more than €0.00.");
    expect(storage.writes).toBe(0);
    type(priceInput("toastie"), "4.50");
    expect(openButton().disabled).toBe(false);
  });

  it("keeps a price the player is still typing when something else changes", () => {
    start();
    type(priceInput("toastie"), "5.1");
    buy("brownie", 2);
    expect(priceInput("toastie").value).toBe("5.1");
    expect(text("#price-hint-toastie")).toContain("Press Set price or Enter to use it.");
  });

  it("re-entering the current price changes nothing and saves nothing", () => {
    start();
    setPrice("flat-white", "2.8");
    expect(priceInput("flat-white").value).toBe("2.80");
    expect(storage.writes).toBe(0);
  });

  it("nudges by 10 cents, and will not nudge to zero", () => {
    start();
    button(/Raise the Brownie price/).click();
    expect(priceInput("brownie").value).toBe("1.90");
    setPrice("brownie", "0.10");
    expect(button(/Lower the Brownie price/).disabled).toBe(true);
    type(priceInput("brownie"), "0.50");
    button(/Lower the Brownie price/).click();
    expect(priceInput("brownie").value).toBe("0.40");
    type(priceInput("brownie"), "bad");
    button(/Raise the Brownie price/).click();
    expect(priceInput("brownie").value).toBe("0.50");
    setPrice("brownie", "999.95");
    expect(button(/Raise the Brownie price/).disabled).toBe(true);
  });
});

describe("trading", () => {
  it("uses a typed price that was not set yet, then prints a receipt", () => {
    start();
    buy("flat-white", 10);
    type(priceInput("flat-white"), "3.00");
    openButton().click();
    expect(testId("message")).toBe("Day 1 is done: sold 5 items for €15.00.");
    const receipt = $("article.receipt");
    expect(receipt.textContent).toContain("Day 1 receipt");
    expect(receipt.textContent).toContain("5 × €3.00");
    expect(receipt.textContent).toContain("thanks for trading!");
    expect(testId("day")).toBe("2 of 5");
    expect(testId("cash")).toBe("€103.00");
  });

  it("does not trade if the typed price cannot be saved", () => {
    start();
    type(priceInput("flat-white"), "3.00");
    storage.failWrites = true;
    openButton().click();
    expect(testId("message")).toContain("I couldn't save that");
    expect(testId("day")).toBe("1 of 5");
  });

  it("keeps everything as it was when the day cannot be saved", () => {
    start();
    buy("toastie", 5);
    storage.failWrites = true;
    openButton().click();
    expect(testId("message")).toContain("nothing has changed");
    expect($('[data-testid="message"]').dataset.tone).toBe("problem");
    expect(testId("day")).toBe("1 of 5");
    expect(testId("stock-toastie")).toBe("5");
  });

  it("tells the player when the shelf is empty after a day", () => {
    start();
    openButton().click();
    expect(text("#next-step")).toContain("your shelf is empty");
  });

  it("lets the player reopen any traded day's receipt from its chip", () => {
    start();
    buy("brownie", 15);
    openButton().click();
    openButton().click();
    const chips = root.querySelectorAll<HTMLButtonElement>(".day-chip");
    expect(chips[1]?.getAttribute("aria-pressed")).toBe("true");
    expect(chips[2]?.disabled).toBe(true);
    chips[0]?.click();
    expect(text("article.receipt h3")).toBe("Day 1 receipt");
    expect(root.querySelectorAll(".day-chip")[0]?.getAttribute("aria-pressed")).toBe("true");
  });
});

function playFiveDays(): void {
  for (let day = 1; day <= 5; day += 1) {
    openButton().click();
  }
}

describe("the end of the run", () => {
  it("shows a gain, switches the controls off and moves focus to the results", () => {
    start();
    buy("toastie", 10);
    playFiveDays();
    expect(text("[data-testid='final-results'] h2")).toBe("Final results");
    expect(testId("gain-loss")).toBe("Overall gain of €25.00");
    expect(text(".final-amount")).toBe("+€25.00");
    expect(testId("final-cash")).toBe("€125.00");
    expect(testId("day")).toBe("Complete");
    expect(testId("day-progress")).toBe("5 of 5 days complete");
    expect(document.activeElement?.id).toBe("final-title");
    expect(openButton().disabled).toBe(true);
    expect(openButton().textContent).toBe("Café closed: run complete");
    expect(quantityInput("toastie").disabled).toBe(true);
    expect(priceInput("toastie").disabled).toBe(true);
    expect(button(/^Buy Toastie/).disabled).toBe(true);
    expect(text("#order-total-toastie")).toBe("The café is closed for this run.");
    expect(text("#price-hint-toastie")).toBe("Final price: €4.50.");
    expect(text("#next-step")).toContain("That's a wrap");
  });

  it("shows a loss with its own message", () => {
    start();
    buy("toastie", 10);
    setPrice("toastie", "1.00");
    playFiveDays();
    expect(testId("gain-loss")).toBe("Overall loss of €10.00");
    expect(text(".final-card")).toContain("A tough week");
  });

  it("shows breaking even with its own message", () => {
    start();
    playFiveDays();
    expect(testId("gain-loss")).toBe("You broke exactly even");
    expect(text(".final-card")).toContain("Not a cent lost");
  });
});

describe("starting a new run", () => {
  it("asks first; cancelling keeps the run", () => {
    start();
    buy("brownie", 5);
    button("New run").click();
    const dialog = $<HTMLDialogElement>("dialog");
    expect(dialog.open).toBe(true);
    expect(text("#new-run-details")).toContain("day 1 of 5, €96.50 in the till");
    expect(button("Cancel", dialog).hasAttribute("autofocus")).toBe(true);
    closeDialog("cancel");
    expect(testId("stock-brownie")).toBe("5");
    expect(storage.writes).toBe(1);
  });

  it("confirming resets everything, including the boxes, and saves once", () => {
    start();
    buy("brownie", 5);
    setPrice("brownie", "2.00");
    playFiveDays();
    button("Start a new run").click();
    expect(text("#new-run-details")).toContain("all 5 days traded");
    const writes = storage.writes;
    closeDialog("confirm");
    expect(testId("cash")).toBe("€100.00");
    expect(testId("day")).toBe("1 of 5");
    expect(priceInput("brownie").value).toBe("1.80");
    expect(quantityInput("brownie").value).toBe("10");
    expect(root.querySelector("[data-testid='final-results']")).toBeNull();
    expect(storage.writes).toBe(writes + 1);
    expect(JSON.parse(storage.getItem(RUN_KEY) ?? "null")).toEqual(newRun(cafe));
  });

  it("keeps the old run if the fresh one cannot be saved", () => {
    start();
    buy("brownie", 5);
    button("New run").click();
    storage.failWrites = true;
    closeDialog("confirm");
    expect(testId("stock-brownie")).toBe("5");
    expect(testId("message")).toContain("I couldn't save that");
  });
});

describe("returning players and unusual browsers", () => {
  it("restores a saved run exactly, without saving again", () => {
    start();
    buy("toastie", 12);
    openButton().click();
    const writes = storage.writes;
    start();
    expect(testId("cash")).toBe("€121.00");
    expect(testId("day")).toBe("2 of 5");
    expect(text("article.receipt h3")).toBe("Day 1 receipt");
    expect(storage.writes).toBe(writes);
  });

  it("explains a damaged save and starts fresh only when asked, keeping a backup", () => {
    storage.data.set(RUN_KEY, "{broken");
    start();
    expect(text("[role='alert']")).toContain("I couldn't open your saved café");
    expect(document.activeElement?.id).toBe("damaged-title");
    expect(storage.writes).toBe(0);
    button("Start a fresh run").click();
    expect(storage.getItem(BACKUP_KEY)).toBe("{broken");
    expect(testId("cash")).toBe("€100.00");
    expect(text(".notice")).toContain("A copy of the unreadable save is kept");
  });

  it("stays on the warning if the backup cannot be made", () => {
    storage.data.set(RUN_KEY, "{broken");
    storage.failWrites = true;
    start();
    button("Start a fresh run").click();
    expect(text("[role='alert']")).toContain("couldn't keep a backup");
  });

  it("plays in memory with a warning when the browser blocks storage", () => {
    const scope = {
      get localStorage(): KeyValueStorage {
        throw new DOMException("denied", "SecurityError");
      },
    };
    startApp(root, scope);
    expect(text(".notice")).toContain("only last until you close this page");
    buy("toastie", 1);
    expect(testId("stock-toastie")).toBe("1");
  });

  it("shows a clear message if the shipped menu is broken", async () => {
    vi.doMock("../../src/domain/catalogue", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../../src/domain/catalogue")>()),
      brewAndByteCatalogue: () => {
        throw new Error("The Brew & Byte menu is invalid: test.");
      },
    }));
    const { startApp: startWithBrokenMenu } = await import("../../src/ui/app");
    startWithBrokenMenu(root, { localStorage: storage });
    expect(text("[role='alert']")).toContain("The Brew & Byte menu is invalid: test.");
  });

  it("reports a non-Error failure from the menu too", async () => {
    vi.doMock("../../src/domain/catalogue", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../../src/domain/catalogue")>()),
      brewAndByteCatalogue: () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw "menu missing";
      },
    }));
    const { startApp: startWithBrokenMenu } = await import("../../src/ui/app");
    startWithBrokenMenu(root, { localStorage: storage });
    expect(text("[role='alert']")).toContain("menu missing");
  });
});

describe("small building blocks", () => {
  it("names an unknown product by its id on a receipt", () => {
    const receipt = renderReceipt(
      {
        day: 1,
        lines: [
          {
            productId: "mystery",
            priceCents: 100,
            demand: 10,
            unitsSold: 0,
            revenueCents: 0,
            cogsCents: 0,
            grossProfitCents: 0,
          },
        ],
        totals: { unitsSold: 0, revenueCents: 0, cogsCents: 0, grossProfitCents: 0 },
        cashAfterCents: 0,
        stockAfter: {},
      },
      cafe,
    );
    expect(receipt.textContent).toContain("mystery");
  });

  it("draws a plain icon for a product without its own picture", () => {
    expect(productIcon("mystery")).toContain("<circle");
  });

  it("main.ts starts the app in the #app element", async () => {
    localStorage.clear();
    vi.resetModules();
    await import("../../src/main");
    expect(document.querySelector(".brand-name")?.textContent).toBe("Brew & Byte");
  });
});
