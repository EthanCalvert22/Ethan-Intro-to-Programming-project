import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { buy, freshStart, openForTheDay, setPrice } from "./helpers";

test("the dashboard follows the week and matches the final result", async ({ page }) => {
  await freshStart(page);
  const dashboard = page.getByRole("region", { name: "Your week so far" });
  await expect(dashboard).toContainText("Open for your first day");

  await buy(page, "Toastie", 12);
  await openForTheDay(page, 1);
  await expect(dashboard.getByTestId("week-profit")).toHaveText("+€25.00");
  await expect(dashboard.getByRole("img", { name: "Gross profit by day" })).toBeVisible();

  await setPrice(page, "Toastie", "1.00");
  await openForTheDay(page, 2);
  // 2 toasties at €1.00 cost €4.00: a €2.00 loss on day 2.
  await expect(dashboard.getByTestId("week-best-day")).toHaveText("Day 1 · +€25.00");
  await expect(dashboard.locator(".chart-loss")).toHaveCount(1);

  await page.reload();
  await expect(dashboard.getByTestId("week-result")).toHaveText("+€23.00");
  for (let day = 3; day <= 5; day += 1) {
    await openForTheDay(page, day);
  }
  await expect(page.getByTestId("gain-loss")).toHaveText("Overall gain of €23.00");
  await expect(dashboard.getByTestId("week-result")).toHaveText("+€23.00");
});

for (const colorScheme of ["light", "dark"] as const) {
  test(`the dashboard has no serious accessibility issues (${colorScheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await freshStart(page);
    await buy(page, "Toastie", 12);
    await openForTheDay(page, 1);
    await setPrice(page, "Toastie", "1.00");
    await openForTheDay(page, 2);
    const violations = (
      await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()
    ).violations
      .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
      .map((violation) => violation.id);
    expect(violations).toEqual([]);
  });
}
