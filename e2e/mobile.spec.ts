import { expect, test } from "@playwright/test";
import { buy, freshStart, openForTheDay } from "./helpers";

test.use({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true });

test("works on a 360 px wide phone without sideways scrolling", async ({ page }) => {
  await freshStart(page);
  const fitsWidth = () =>
    page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    );
  expect(await fitsWidth()).toBe(true);

  await expect(page.getByRole("heading", { name: "How customers decide" })).toBeAttached();
  await buy(page, "Flat white", 10);
  await openForTheDay(page, 1);
  await expect(page.locator("article.receipt")).toBeVisible();
  expect(await fitsWidth()).toBe(true);

  for (let day = 2; day <= 5; day += 1) {
    await openForTheDay(page, day);
  }
  await expect(page.getByTestId("final-results")).toBeVisible();
  expect(await fitsWidth()).toBe(true);
});

test("tap targets on the shelf are at least 44 px tall", async ({ page }) => {
  await freshStart(page);
  const buttons = page.locator(".shelf-card button");
  const count = await buttons.count();
  for (let index = 0; index < count; index += 1) {
    const box = await buttons.nth(index).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
});
