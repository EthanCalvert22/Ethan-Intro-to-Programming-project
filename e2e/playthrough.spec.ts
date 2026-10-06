import { expect, test } from "@playwright/test";
import {
  buy,
  card,
  freshStart,
  openForTheDay,
  receipt,
  receiptTotal,
  savedRun,
  setPrice,
} from "./helpers";

// The same hand-calculated five-day run as spec/acceptance.json case E11,
// played through the real interface, with a real page reload in the middle.
test("a full five-day run through the interface, with a reload mid-run", async ({ page }) => {
  await freshStart(page);
  await expect(page.getByTestId("day-progress")).toHaveText("Day 1 of 5");

  // Day 1
  await buy(page, "Flat white", 20);
  await buy(page, "Toastie", 10);
  await buy(page, "Brownie", 15);
  await expect(page.getByTestId("cash")).toHaveText("€45.50");
  await expect(page.getByRole("button", { name: "Open for day 1" })).toHaveClass(/is-next-step/);
  await openForTheDay(page, 1);
  expect(await receiptTotal(page, "Total revenue")).toBe("€91.00");
  expect(await receiptTotal(page, "Total cost of goods sold")).toBe("€39.00");
  expect(await receiptTotal(page, "Total gross profit")).toBe("€52.00");
  await expect(page.getByTestId("cash")).toHaveText("€136.50");

  // Day 2
  await setPrice(page, "Flat white", "4.00");
  await setPrice(page, "Brownie", "3,60");
  await buy(page, "Toastie", 5);
  await openForTheDay(page, 2);
  expect(await receiptTotal(page, "Total gross profit")).toBe("€41.00");
  await expect(page.getByTestId("cash")).toHaveText("€187.00");

  // Leave and come back: nothing is replayed.
  await page.reload();
  await expect(page.getByTestId("day-progress")).toHaveText("Day 3 of 5");
  await expect(page.getByTestId("cash")).toHaveText("€187.00");
  await expect(card(page, "Flat white").getByLabel("Selling price (€)")).toHaveValue("4.00");
  expect((await savedRun(page)).history).toHaveLength(2);

  // Day 3: toastie priced above twice its reference sells nothing.
  await setPrice(page, "Toastie", "9.01");
  await expect(card(page, "Toastie")).toContainText("no customers will want one");
  await buy(page, "Toastie", 4);
  await openForTheDay(page, 3);
  expect(await receiptTotal(page, "Total gross profit")).toBe("€14.00");

  // Day 4: nothing can sell.
  await openForTheDay(page, 4);
  expect(await receiptTotal(page, "Total units sold")).toBe("0");

  // Day 5
  await setPrice(page, "Toastie", "4.50");
  await setPrice(page, "Brownie", "1.80");
  await buy(page, "Brownie", 12);
  await openForTheDay(page, 5);
  expect(await receiptTotal(page, "Total gross profit")).toBe("€21.00");

  const final = page.getByTestId("final-results");
  await expect(final).toBeVisible();
  await expect(final.getByTestId("final-cash")).toHaveText("€226.60");
  await expect(final.getByTestId("final-stock-value")).toHaveText("€1.40");
  await expect(final.getByTestId("gain-loss")).toHaveText("Overall gain of €128.00");
  await expect(page.getByTestId("day-progress")).toHaveText("5 of 5 days complete");

  // Every day's receipt can be reopened from its chip.
  await page.getByRole("button", { name: /Day 1 receipt/ }).click();
  await expect(receipt(page)).toContainText("Day 1 receipt");
  expect(await receiptTotal(page, "Total gross profit")).toBe("€52.00");
});

test("after day five, buying, pricing and trading are switched off", async ({ page }) => {
  await freshStart(page);
  for (let day = 1; day <= 5; day += 1) {
    await openForTheDay(page, day);
  }
  await expect(page.getByRole("button", { name: "Café closed: run complete" })).toBeDisabled();
  for (const name of ["Flat white", "Toastie", "Brownie"]) {
    const product = card(page, name);
    await expect(product.getByRole("button", { name: `Buy ${name}` })).toBeDisabled();
    await expect(product.getByLabel("How many to order")).toBeDisabled();
    await expect(product.getByLabel("Selling price (€)")).toBeDisabled();
    await expect(product.getByRole("button", { name: /Raise the/ })).toBeDisabled();
    await expect(product.getByRole("button", { name: /Lower the/ })).toBeDisabled();
  }
  // A reload keeps the run closed.
  await page.reload();
  await expect(page.getByTestId("final-results")).toBeVisible();
  await expect(card(page, "Toastie").getByRole("button", { name: "Buy Toastie" })).toBeDisabled();
  expect((await savedRun(page)).history).toHaveLength(5);
});
