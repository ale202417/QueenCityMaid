import { expect, login, test } from "./fixture.js";

test("manager can reach every module from the mobile menu without horizontal overflow", async ({ page }) => {
  await login(page);
  for (const [module, heading] of [
    ["Dashboard", "Business overview"], ["Leads", "Leads"],
    ["Quotes", "Quotes"], ["Customers", "Customers"], ["Schedule", "Schedule"],
    ["Employees", "Employees"], ["Payments", "Payments"],
    ["Payroll", "Payroll"], ["Messages", "Messages"],
    ["Reports", "Reports"], ["Settings", "Settings"]
  ]) {
    await page.getByRole("button", { name: "Menu" }).click();
    await page.getByRole("navigation", { name: "Mobile navigation" })
      .getByRole("link", { name: module })
      .click();
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow, `${module} should not overflow the mobile viewport`).toBeLessThanOrEqual(1);
  }
});
