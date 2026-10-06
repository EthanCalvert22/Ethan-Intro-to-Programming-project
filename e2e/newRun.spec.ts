import { expect, test } from "@playwright/test";
import { buy, freshStart, openForTheDay, savedRun } from "./helpers";

test("A6: cancelling the dialog keeps the run; confirming starts afresh", async ({ page }) => {
  await freshStart(page);
  await buy(page, "Toastie", 12);
  for (let day = 1; day <= 5; day += 1) {
    await openForTheDay(page, day);
  }
  await expect(page.getByTestId("final-results")).toBeVisible();
  const finished = await savedRun(page);

  // Cancel (the default focus) keeps everything.
  await page.getByRole("button", { name: "New run", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Start a new run?" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await expect(dialog).toContainText("all 5 days traded, €130.00 in the till");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("final-results")).toBeVisible();
  expect(await savedRun(page)).toEqual(finished);

  // Escape also cancels.
  await page.getByRole("button", { name: "Start a new run" }).click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  expect(await savedRun(page)).toEqual(finished);

  // Confirming resets to the starting state.
  await page.getByRole("button", { name: "New run", exact: true }).click();
  await dialog.getByRole("button", { name: "Yes, start a new run" }).click();
  await expect(page.getByTestId("cash")).toHaveText("€100.00");
  await expect(page.getByTestId("day-progress")).toHaveText("Day 1 of 5");
  await expect(page.getByTestId("shelf-total")).toHaveText("0");
  await expect(page.getByTestId("final-results")).toHaveCount(0);
  await expect(page.getByText("No receipts yet.")).toBeVisible();
  for (let day = 1; day <= 5; day += 1) {
    await expect(page.getByRole("button", { name: `Day ${day}: not traded yet` })).toBeDisabled();
  }
  const fresh = await savedRun(page);
  expect(fresh).toMatchObject({
    status: "in_progress",
    currentDay: 1,
    cashCents: 10000,
    history: [],
  });

  await page.reload();
  await expect(page.getByTestId("cash")).toHaveText("€100.00");
  await expect(page.getByRole("button", { name: "Buy Toastie" })).toBeEnabled();
});

test("the dialog also guards a run that is still in progress", async ({ page }) => {
  await freshStart(page);
  await buy(page, "Brownie", 5);
  await page.getByRole("button", { name: "New run", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Start a new run?" });
  await expect(dialog).toContainText("day 1 of 5, €96.50 in the till");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByTestId("stock-brownie")).toHaveText("5");
});
