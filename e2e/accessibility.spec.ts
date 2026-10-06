import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { buy, freshStart, openForTheDay } from "./helpers";

async function seriousViolations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  return results.violations
    .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
    .map((violation) => `${violation.id}: ${violation.help} (${violation.nodes.length})`);
}

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`${colorScheme} theme`, () => {
    test.use({ colorScheme });

    test("has no serious or critical accessibility issues on the key screens", async ({ page }) => {
      await freshStart(page);
      expect(await seriousViolations(page)).toEqual([]);

      await buy(page, "Toastie", 3);
      await card(page).fill("0");
      expect(await seriousViolations(page)).toEqual([]);
      await card(page).fill("4.50");

      await openForTheDay(page, 1);
      expect(await seriousViolations(page)).toEqual([]);

      for (let day = 2; day <= 5; day += 1) {
        await openForTheDay(page, day);
      }
      await expect(page.getByTestId("final-results")).toBeVisible();
      expect(await seriousViolations(page)).toEqual([]);

      await page.getByRole("button", { name: "New run", exact: true }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      expect(await seriousViolations(page)).toEqual([]);
    });
  });
}

function card(page: Page) {
  return page.getByRole("article", { name: "Toastie" }).getByLabel("Selling price (€)");
}

test("results and errors are announced through live regions", async ({ page }) => {
  await freshStart(page);
  await expect(page.getByTestId("message")).toHaveAttribute("aria-live", "polite");
  await expect(page.locator("#order-total-toastie")).toHaveAttribute("aria-live", "polite");
  await expect(page.locator("#price-hint-toastie")).toHaveAttribute("aria-live", "polite");
});

test("every input has a visible label", async ({ page }) => {
  await freshStart(page);
  const inputs = page.locator("input");
  const count = await inputs.count();
  expect(count).toBe(6);
  for (let index = 0; index < count; index += 1) {
    const id = await inputs.nth(index).getAttribute("id");
    await expect(page.locator(`label[for="${id ?? ""}"]`)).toBeVisible();
  }
});

test("the next-step glow is switched off when reduced motion is requested", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await freshStart(page);
  await buy(page, "Brownie", 2);
  const open = page.getByRole("button", { name: "Open for day 1" });
  await expect(open).toHaveClass(/is-next-step/);
  expect(await open.evaluate((node) => getComputedStyle(node).animationName)).toBe("none");
});
