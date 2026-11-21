import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { buy, freshStart, openForTheDay } from "./helpers";

const SCORES_KEY = "brew-and-byte:scores:v1";

async function finishRun(page: Page, toasties: number): Promise<void> {
  await buy(page, "Toastie", toasties);
  for (let day = 1; day <= 5; day += 1) {
    await openForTheDay(page, day);
  }
  await expect(page.getByTestId("final-results")).toBeVisible();
}

async function startNewRun(page: Page): Promise<void> {
  await page.getByRole("button", { name: "New run", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Yes, start a new run" }).click();
  await expect(page.getByTestId("cash")).toHaveText("€100.00");
}

test("a finished run lands on the high scores, once, and stays through a new run", async ({
  page,
}) => {
  await freshStart(page);
  const board = page.getByRole("region", { name: "High scores" });
  await expect(board).toContainText("No finished runs yet");

  await finishRun(page, 12);
  await expect(page.getByTestId("score-note")).toHaveText(
    "New personal best! That's your best result yet.",
  );
  await expect(board.getByTestId("score-row")).toHaveCount(1);
  await expect(board.getByTestId("score-row").first()).toContainText("+€30.00");
  await expect(board.getByTestId("score-row").first()).toContainText("Classic");

  // Reloading the final screen never records the same run again.
  await page.reload();
  await expect(board.getByTestId("score-row")).toHaveCount(1);
  const saved = await page.evaluate((key) => localStorage.getItem(key), SCORES_KEY);
  expect((JSON.parse(saved ?? "null") as { scores: unknown[] }).scores).toHaveLength(1);

  // A new run keeps the board; a weaker run ranks second.
  await startNewRun(page);
  await expect(board.getByTestId("score-row")).toHaveCount(1);
  await finishRun(page, 5);
  await expect(page.getByTestId("score-note")).toHaveText("That's number 2 on your high scores.");
  await expect(board.getByTestId("score-row").nth(1)).toContainText("+€12.50");
});

test("clearing the high scores needs a second click", async ({ page }) => {
  await freshStart(page);
  await finishRun(page, 12);
  const board = page.getByRole("region", { name: "High scores" });
  await board.getByRole("button", { name: "Clear high scores" }).click();
  await expect(board).toContainText("Clear all 1 high score? This can't be undone.");
  await expect(board.getByRole("button", { name: "Cancel" })).toBeFocused();
  await board.getByRole("button", { name: "Cancel" }).click();
  await expect(board.getByTestId("score-row")).toHaveCount(1);
  await board.getByRole("button", { name: "Clear high scores" }).click();
  await board.getByRole("button", { name: "Yes, clear them" }).click();
  await expect(board.getByTestId("score-row")).toHaveCount(0);
  await expect(board).toContainText("High scores cleared.");
  await page.reload();
  await expect(board).toContainText("No finished runs yet");
});

for (const colorScheme of ["light", "dark"] as const) {
  test(`the high scores board has no serious accessibility issues (${colorScheme})`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await freshStart(page);
    await finishRun(page, 12);
    await startNewRun(page);
    await finishRun(page, 1);
    const violations = (
      await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()
    ).violations
      .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
      .map((violation) => violation.id);
    expect(violations).toEqual([]);
    await page.getByRole("button", { name: "Clear high scores" }).click();
    const confirming = (
      await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()
    ).violations
      .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
      .map((violation) => violation.id);
    expect(confirming).toEqual([]);
  });
}
