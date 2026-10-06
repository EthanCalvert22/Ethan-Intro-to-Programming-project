import { expect, test } from "@playwright/test";
import { buy, card, freshStart, openForTheDay, receipt, savedRun, RUN_KEY } from "./helpers";

test("A1: an order within budget is accepted; one costing more than the cash is refused", async ({
  page,
}) => {
  await freshStart(page);
  // Toasties cost €2.00 each, as in the brief's example.
  await buy(page, "Toastie", 10);
  await expect(page.getByTestId("cash")).toHaveText("€80.00");
  await expect(page.getByTestId("stock-toastie")).toHaveText("10");

  const toastie = card(page, "Toastie");
  await toastie.getByLabel("How many to order").fill("41");
  await expect(toastie).toContainText("Oops, that comes to €82.00, but you only have €80.00 left.");
  await expect(toastie.getByRole("button", { name: "Buy Toastie" })).toBeDisabled();
  await toastie.getByLabel("How many to order").press("Enter");
  await expect(page.getByTestId("cash")).toHaveText("€80.00");
  await expect(page.getByTestId("stock-toastie")).toHaveText("10");
  expect((await savedRun(page)).cashCents).toBe(8000);
});

test("bad quantities are refused with a friendly message and the Buy button disabled", async ({
  page,
}) => {
  await freshStart(page);
  const brownie = card(page, "Brownie");
  const quantity = brownie.getByLabel("How many to order");
  const cases: [string, string][] = [
    ["0", "at least 1"],
    ["2.5", "whole number"],
    ["abc", "whole number"],
    ["", "how many"],
    ["5000", "at most 1,000"],
  ];
  for (const [text, wording] of cases) {
    await quantity.fill(text);
    await expect(brownie).toContainText(wording);
    await expect(brownie.getByRole("button", { name: "Buy Brownie" })).toBeDisabled();
    await expect(quantity).toHaveAttribute("aria-invalid", "true");
  }
  expect(await page.evaluate((key) => localStorage.getItem(key), RUN_KEY)).toBeNull();
});

test("A2: prices are checked, and an invalid price blocks trading until fixed", async ({
  page,
}) => {
  await freshStart(page);
  const toastie = card(page, "Toastie");
  const price = toastie.getByLabel("Selling price (€)");

  await price.fill("0");
  await expect(toastie).toContainText("A price has to be more than €0.00.");
  await expect(page.getByRole("button", { name: "Open for day 1" })).toBeDisabled();
  await price.fill("-1");
  await expect(toastie).toContainText("more than €0.00");
  await price.fill("4.005");
  await expect(toastie).toContainText("at most two decimals");
  await expect(toastie.getByRole("button", { name: "Set price for Toastie" })).toBeDisabled();

  await price.fill("4,51");
  await expect(toastie).toContainText("At €4.51, 5 customers will want one each day.");
  await price.press("Enter");
  await expect(page.getByTestId("message")).toHaveText("Toastie now sells for €4.51.");
  await expect(price).toHaveValue("4.51");
  await expect(page.getByRole("button", { name: "Open for day 1" })).toBeEnabled();
  expect((await savedRun(page)).prices).toMatchObject({ toastie: 451 });
});

test("price nudges move the price by 10 cents and save it straight away", async ({ page }) => {
  await freshStart(page);
  const brownie = card(page, "Brownie");
  await brownie.getByRole("button", { name: "Raise the Brownie price by 10 cents" }).click();
  await expect(brownie.getByLabel("Selling price (€)")).toHaveValue("1.90");
  await brownie.getByRole("button", { name: "Lower the Brownie price by 10 cents" }).click();
  await brownie.getByRole("button", { name: "Lower the Brownie price by 10 cents" }).click();
  await expect(brownie.getByLabel("Selling price (€)")).toHaveValue("1.70");
  expect((await savedRun(page)).prices).toMatchObject({ brownie: 170 });
});

test("a typed price is used when opening, even without pressing Set price", async ({ page }) => {
  await freshStart(page);
  await buy(page, "Flat white", 10);
  await card(page, "Flat white").getByLabel("Selling price (€)").fill("3.00");
  await page.getByRole("button", { name: "Open for day 1" }).click();
  await expect(receipt(page)).toContainText("5 × €3.00");
  await expect(page.getByTestId("cash")).toHaveText("€103.00");
});

test("A3/A4: stock limits sales and an empty shelf still advances the day", async ({ page }) => {
  await freshStart(page);
  await buy(page, "Toastie", 3);
  await openForTheDay(page, 1);
  const line = receipt(page).locator('[data-product="toastie"]');
  await expect(line.locator(".receipt-row", { hasText: "Customers who wanted one" })).toContainText(
    "10",
  );
  await expect(line.locator(".receipt-row", { hasText: "Units sold" })).toContainText("3");
  await expect(page.getByTestId("stock-toastie")).toHaveText("0");
  await openForTheDay(page, 2);
  await expect(page.getByTestId("day-progress")).toHaveText("Day 3 of 5");
  await expect(page.getByTestId("stock-toastie")).toHaveText("0");
});

test("a damaged save is reported, kept as a backup, and replaced only when asked", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate((key) => {
    localStorage.setItem(key, '{"version":1,"cashCents":-500}');
  }, RUN_KEY);
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("I couldn't open your saved café");
  expect(await page.evaluate((key) => localStorage.getItem(key), RUN_KEY)).toBe(
    '{"version":1,"cashCents":-500}',
  );
  await page.getByRole("button", { name: "Start a fresh run" }).click();
  await expect(page.getByTestId("cash")).toHaveText("€100.00");
  expect(
    await page.evaluate(() => localStorage.getItem("brew-and-byte:run:v1:unreadable-backup")),
  ).toBe('{"version":1,"cashCents":-500}');
});
