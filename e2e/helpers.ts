import { expect, type Locator, type Page } from "@playwright/test";

export const RUN_KEY = "brew-and-byte:run:v1";

export const CLASSIC_WEEK = Array.from({ length: 5 }, () => "ordinary-day");

/**
 * Opens the app on a brand-new run with a known week of campus events. Most tests use the
 * classic week (five ordinary days), so their hand-checked numbers follow the original rules.
 * The saved run is exactly what the game itself writes when a new run starts.
 */
export async function freshStart(
  page: Page,
  events: readonly string[] = CLASSIC_WEEK,
): Promise<void> {
  await page.goto("/");
  await page.evaluate(
    ({ key, plannedEvents }) => {
      localStorage.clear();
      const run = {
        version: 2,
        status: "in_progress",
        currentDay: 1,
        cashCents: 10000,
        stock: { "flat-white": 0, toastie: 0, brownie: 0 },
        prices: { "flat-white": 280, toastie: 450, brownie: 180 },
        events: plannedEvents,
        history: [],
      };
      localStorage.setItem(key, JSON.stringify(run));
    },
    { key: RUN_KEY, plannedEvents: [...events] },
  );
  await page.reload();
  await expect(page.getByTestId("cash")).toHaveText("€100.00");
}

export function card(page: Page, name: string): Locator {
  return page.getByRole("article", { name });
}

export async function buy(page: Page, name: string, quantity: number): Promise<void> {
  const product = card(page, name);
  await product.getByLabel("How many to order").fill(String(quantity));
  await product.getByRole("button", { name: `Buy ${name}` }).click();
  await expect(page.getByTestId("message")).toContainText(`Bought ${quantity} × ${name}`);
}

export async function setPrice(page: Page, name: string, text: string): Promise<void> {
  const product = card(page, name);
  await product.getByLabel("Selling price (€)").fill(text);
  await product.getByLabel("Selling price (€)").press("Enter");
  await expect(page.getByTestId("message")).toContainText(`${name} now sells for`);
}

export async function openForTheDay(page: Page, day: number): Promise<void> {
  await page.getByRole("button", { name: `Open for day ${day}` }).click();
  await expect(page.getByTestId("message")).toContainText(`Day ${day} is done`);
}

export function receipt(page: Page): Locator {
  return page.locator("article.receipt");
}

/** Reads a "label → value" row from the visible till receipt totals. */
export async function receiptTotal(page: Page, label: string): Promise<string> {
  const row = receipt(page).locator(".receipt-totals .receipt-row", { hasText: label });
  return (await row.locator("dd").textContent()) ?? "";
}

export async function savedRun(page: Page): Promise<Record<string, unknown>> {
  const text = await page.evaluate((key) => localStorage.getItem(key), RUN_KEY);
  return JSON.parse(text ?? "null") as Record<string, unknown>;
}
