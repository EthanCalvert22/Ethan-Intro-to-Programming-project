import { expect, test, type Page } from "@playwright/test";
import { buy, freshStart, openForTheDay, setPrice } from "./helpers";

/* Regenerates the README screenshots in docs/screenshots. Run with: npm run screenshots */

const DIR = "docs/screenshots";

async function playTwoDays(page: Page): Promise<void> {
  await buy(page, "Flat white", 15);
  await buy(page, "Toastie", 8);
  await buy(page, "Brownie", 12);
  await openForTheDay(page, 1);
  await setPrice(page, "Flat white", "3.40");
  await openForTheDay(page, 2);
}

for (const [label, viewport] of [
  ["desktop", { width: 1280, height: 900 }],
  ["mobile", { width: 360, height: 780 }],
] as const) {
  test.describe(label, () => {
    test.use({ viewport });

    test(`${label} screenshots`, async ({ page }) => {
      await freshStart(page);
      await page.screenshot({ path: `${DIR}/${label}-1-start.png`, fullPage: label === "desktop" });

      await playTwoDays(page);
      await page.locator("article.receipt").scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${DIR}/${label}-2-receipt.png`, fullPage: true });

      for (let day = 3; day <= 5; day += 1) {
        await openForTheDay(page, day);
      }
      await expect(page.getByTestId("final-results")).toBeVisible();
      await page.getByTestId("final-results").scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${DIR}/${label}-3-final.png` });

      await page.getByRole("button", { name: "New run", exact: true }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.screenshot({ path: `${DIR}/${label}-4-new-run-dialog.png` });
    });
  });
}

test.describe("dark", () => {
  test.use({ colorScheme: "dark", viewport: { width: 1280, height: 900 } });

  test("dark theme screenshot", async ({ page }) => {
    await freshStart(page);
    await playTwoDays(page);
    await page.screenshot({ path: `${DIR}/desktop-5-dark.png`, fullPage: true });
  });
});
