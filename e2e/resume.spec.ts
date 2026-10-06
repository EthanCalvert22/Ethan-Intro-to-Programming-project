import { expect, test } from "@playwright/test";
import { buy, card, freshStart, openForTheDay, savedRun, setPrice } from "./helpers";

test("A5: after a reload everything is unchanged and the day is recorded once", async ({
  page,
}) => {
  await freshStart(page);
  await buy(page, "Flat white", 12);
  await buy(page, "Brownie", 4);
  await setPrice(page, "Flat white", "3.50");
  await openForTheDay(page, 1);

  const before = {
    cash: await page.getByTestId("cash").textContent(),
    day: await page.getByTestId("day-progress").textContent(),
    flatWhite: await page.getByTestId("stock-flat-white").textContent(),
    brownie: await page.getByTestId("stock-brownie").textContent(),
    saved: await savedRun(page),
  };
  expect(before.saved.history).toHaveLength(1);

  for (let visit = 0; visit < 3; visit += 1) {
    await page.reload();
    await expect(page.getByTestId("cash")).toHaveText(before.cash ?? "");
    await expect(page.getByTestId("day-progress")).toHaveText(before.day ?? "");
    await expect(page.getByTestId("stock-flat-white")).toHaveText(before.flatWhite ?? "");
    await expect(page.getByTestId("stock-brownie")).toHaveText(before.brownie ?? "");
    await expect(card(page, "Flat white").getByLabel("Selling price (€)")).toHaveValue("3.50");
    await expect(page.getByRole("button", { name: /Day 1 receipt/ })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Day 2: not traded yet" })).toBeDisabled();
    expect(await savedRun(page)).toEqual(before.saved);
  }
});

test("a purchase and a price change survive a reload before trading", async ({ page }) => {
  await freshStart(page);
  await buy(page, "Toastie", 7);
  await setPrice(page, "Toastie", "5.20");
  await page.reload();
  await expect(page.getByTestId("stock-toastie")).toHaveText("7");
  await expect(page.getByTestId("cash")).toHaveText("€86.00");
  await expect(card(page, "Toastie").getByLabel("Selling price (€)")).toHaveValue("5.20");
  await expect(page.getByTestId("day-progress")).toHaveText("Day 1 of 5");
});
