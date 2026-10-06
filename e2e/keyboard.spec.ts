import { expect, test, type Page } from "@playwright/test";
import { freshStart, savedRun } from "./helpers";

/** Presses Tab until the element with this accessible check has focus. Keyboard only. */
async function tabTo(page: Page, isTarget: () => Promise<boolean>): Promise<void> {
  for (let presses = 0; presses < 60; presses += 1) {
    await page.keyboard.press("Tab");
    if (await isTarget()) {
      return;
    }
  }
  throw new Error("Could not reach the control with the Tab key");
}

test("a player can buy and trade with the keyboard alone", async ({ page }) => {
  await freshStart(page);
  await page.locator("body").focus();

  const quantity = page.locator("#quantity-flat-white");
  await tabTo(page, () => quantity.evaluate((node) => node === document.activeElement));
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("6");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("message")).toHaveText(
    "Bought 6 × Flat white for €7.20. €92.80 left in the till.",
  );

  // The + stepper works from the keyboard too.
  const more = page.getByRole("button", { name: "One more Brownie" });
  await tabTo(page, () => more.evaluate((node) => node === document.activeElement));
  await page.keyboard.press("Enter");
  await expect(page.locator("#quantity-brownie")).toHaveValue("11");

  const open = page.getByRole("button", { name: "Open for day 1" });
  await tabTo(page, () => open.evaluate((node) => node === document.activeElement));
  await expect(open).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("message")).toHaveText("Day 1 is done: sold 6 items for €16.80.");
  expect((await savedRun(page)).history).toHaveLength(1);
});

test("focus is always visible", async ({ page }) => {
  await freshStart(page);
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  const outline = await page.evaluate(() => {
    const focused = document.activeElement as HTMLElement;
    return getComputedStyle(focused).outlineStyle;
  });
  expect(outline).not.toBe("none");
});
