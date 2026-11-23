import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { buy, card, freshStart, openForTheDay, receipt, savedRun } from "./helpers";

test("an upgrade is paid for, adds its bonus on the next trade, and survives a reload", async ({
  page,
}) => {
  await freshStart(page);
  const shop = page.getByRole("region", { name: "Upgrades Shop" });
  await shop.getByRole("button", { name: /^Buy Student Loyalty Program/ }).click();
  await expect(page.getByTestId("message")).toHaveText(
    "Bought Student Loyalty Program for €15.00. €85.00 left in the till.",
  );
  await expect(shop.getByRole("button", { name: "Bought Student Loyalty Program" })).toBeDisabled();
  await expect(card(page, "Toastie")).toContainText(
    "At €4.50, 12 customers will want one today (Student Loyalty Program +2).",
  );

  await buy(page, "Toastie", 15);
  await openForTheDay(page, 1);
  const toastie = receipt(page).locator('[data-product="toastie"]');
  await expect(
    toastie.locator(".receipt-row", { hasText: "Customers who wanted one" }),
  ).toContainText("12");
  await expect(toastie.locator(".receipt-row", { hasText: "Units sold" })).toContainText("12");

  await page.reload();
  await expect(shop).toContainText("Active for the rest of this run");
  expect((await savedRun(page)).purchasedUpgrades).toEqual(["loyalty-program"]);
});

test("the supplier partnership makes new stock cheaper", async ({ page }) => {
  await freshStart(page);
  await page.getByRole("button", { name: /^Buy Supplier Partnership/ }).click();
  await expect(card(page, "Toastie")).toContainText("Costs you €1.70 (supplier rate)");
  await buy(page, "Toastie", 10);
  await expect(page.getByTestId("cash")).toHaveText("€58.00");
});

test("bonuses never bring customers to an item priced above twice its fair price", async ({
  page,
}) => {
  await freshStart(page);
  await page.getByRole("button", { name: /^Buy Go Viral/ }).click();
  const brownie = card(page, "Brownie");
  await brownie.getByLabel("Selling price (€)").fill("3.61");
  await expect(brownie).toContainText("At €3.61, no customers will want one today.");
});

for (const colorScheme of ["light", "dark"] as const) {
  test(`the upgrades shop has no serious accessibility issues (${colorScheme})`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await freshStart(page);
    await page.getByRole("button", { name: /^Buy Student Loyalty Program/ }).click();
    const violations = (
      await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()
    ).violations
      .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
      .map((violation) => violation.id);
    expect(violations).toEqual([]);
  });
}
