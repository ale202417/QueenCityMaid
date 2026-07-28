import { expect, login, test } from "./fixture.js";

test("dashboard renders every operational total with a usable value", async ({ page }) => {
  await login(page);
  await expect(page.getByRole("heading", { name: "Company snapshot" })).toBeVisible();
  for (const label of [
    "Active employees",
    "Active clients",
    "Services this week",
    "Revenue this pay period",
    "Wages this pay period",
    "Client balances due"
  ]) {
    const metric = page.locator(".metric").filter({ hasText: label });
    await expect(metric).toBeVisible();
    await expect(metric.locator("strong")).not.toHaveText(/^(?:-|NaN|undefined)$/);
  }
  await expect(page.getByRole("heading", { name: "Needs attention" })).toBeVisible();
});
