import { expect, type Locator, type Page } from "@playwright/test";

export const RUN_KEY = "brew-and-byte:run:v1";

/** Opens the app with an empty save, like a first-time player. */
export async function freshStart(page: Page): Promise<void> {
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.clear();
  });
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
