import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { buy, card, freshStart, openForTheDay, receipt, savedRun } from "./helpers";

const WEEK = ["exam-week", "rainy-day", "ordinary-day", "open-day", "big-match"];

test("campus news shows today and tomorrow, and events change what sells", async ({ page }) => {
  await freshStart(page, WEEK);
  const news = page.getByRole("region", { name: "Campus news" });
  await expect(news).toContainText("Today · Day 1");
  await expect(news).toContainText("Exam week");
  await expect(news).toContainText("Flat white ×1.5");
  await expect(news).toContainText("Tomorrow · Day 2");
  await expect(news).toContainText("Rainy day");
  await expect(card(page, "Flat white")).toContainText(
    "At €2.80, 15 customers will want one today (Exam week).",
  );

  // Exam week: 15 flat white customers instead of 10.
  await buy(page, "Flat white", 20);
  await openForTheDay(page, 1);
  await expect(page.getByTestId("message")).toHaveText(
    "Day 1 is done (Exam week): sold 15 items for €42.00.",
  );
  await expect(receipt(page)).toContainText("Exam week");
  await expect(page.getByTestId("stock-flat-white")).toHaveText("5");

  // Reloading keeps the same week: no re-roll, no replayed day.
  await page.reload();
  await expect(news).toContainText("Today · Day 2");
  await expect(news).toContainText("Rainy day");
  const saved = await savedRun(page);
  expect(saved.events).toEqual(WEEK);
  expect(saved.history).toHaveLength(1);
});

test("the last day warns there is no tomorrow, and the news disappears when the run ends", async ({
  page,
}) => {
  await freshStart(page, WEEK);
  for (let day = 1; day <= 4; day += 1) {
    await openForTheDay(page, day);
  }
  const news = page.getByRole("region", { name: "Campus news" });
  await expect(news).toContainText("Big match");
  await expect(news).toContainText("Last day");
  await openForTheDay(page, 5);
  await expect(page.getByTestId("final-results")).toBeVisible();
  await expect(news).toBeHidden();
});

test("a new run can be a classic week with no events", async ({ page }) => {
  await freshStart(page, WEEK);
  await page.getByRole("button", { name: "New run", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Start a new run?" });
  const withEvents = dialog.getByLabel(/Include campus events/);
  await expect(withEvents).toBeChecked();
  await withEvents.uncheck();
  await dialog.getByRole("button", { name: "Yes, start a new run" }).click();
  await expect(page.getByTestId("message")).toContainText("classic week with no campus events");
  expect((await savedRun(page)).events).toEqual(Array.from({ length: 5 }, () => "ordinary-day"));
});

test("a first-time player gets a real week of events, saved with the run", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.clear();
  });
  await page.reload();
  await expect(page.getByRole("region", { name: "Campus news" })).toContainText("Today · Day 1");
  await buy(page, "Brownie", 1);
  const saved = await savedRun(page);
  expect(saved.events).toHaveLength(5);
});

for (const colorScheme of ["light", "dark"] as const) {
  test(`event news has no serious accessibility issues (${colorScheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    // Day 1 shows "more customers" chips; day 5 (big match) shows "fewer customers" chips.
    await freshStart(page, ["exam-week", "rainy-day", "ordinary-day", "bake-sale", "big-match"]);
    const scan = async () =>
      (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations
        .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
        .map((violation) => violation.id);
    expect(await scan()).toEqual([]);
    for (let day = 1; day <= 4; day += 1) {
      await openForTheDay(page, day);
    }
    expect(await scan()).toEqual([]);
  });
}
