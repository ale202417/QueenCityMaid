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
  await expect(page.getByRole("heading", { name: "Action center" })).toBeVisible();
  await expect(
    page.locator(".exception-list, .state-panel").last()
  ).toBeVisible();
});

test("manager configures and runs daily operations automation", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Automation" }).click();

  const schedule = page.getByRole("checkbox", { name: /Schedule upkeep/ });
  const serviceReminders = page.getByRole("checkbox", { name: /Service reminders/ });
  await expect(schedule).toBeChecked();
  await expect(serviceReminders).not.toBeChecked();
  await serviceReminders.check();
  await expect(page.getByText(/SMS delivery is not configured/)).toBeVisible();
  await page.getByRole("button", { name: "Save automation" }).click();
  await expect(page.getByText("Automation settings saved.")).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "Automation" }).click();
  await expect(serviceReminders).toBeChecked();
  await serviceReminders.uncheck();
  await page.getByRole("button", { name: "Save automation" }).click();
  await expect(page.getByText("Automation settings saved.")).toBeVisible();

  await page.getByRole("button", { name: "Run now" }).click();
  await expect(page.getByText(/Automation finished:/)).toBeVisible();
  const latestRun = page.locator(".automation-history .data-row").nth(1);
  await expect(latestRun).toContainText("Manual");
  await expect(latestRun).toContainText("completed");
});
