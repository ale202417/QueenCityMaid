import { accounts, expect, login, password, test } from "./fixture.js";

const managerPages = [
  ["Dashboard", "Business overview"],
  ["Leads", "Leads"],
  ["Quotes", "Quotes"],
  ["Customers", "Customers"],
  ["Schedule", "Schedule"],
  ["Employees", "Employees"],
  ["Payments", "Payments"],
  ["Payroll", "Payroll"],
  ["Messages", "Messages"],
  ["Reports", "Reports"],
  ["Settings", "Settings"]
];

test("manager can sign in, open every module, refresh, and sign out", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Email").fill(accounts.manager);
  await page.getByLabel("Password").fill("incorrect-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toContainText("incorrect");

  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Business overview" })).toBeVisible();

  for (const [link, heading] of managerPages) {
    await page.getByRole("navigation", { name: "Primary navigation" })
      .getByRole("link", { name: link })
      .click();
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expect(page.getByText("This page could not be displayed")).toHaveCount(0);
  }

  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
});

test("temporary account must create a private password before entering the app", async ({ page }) => {
  await login(page);
  await page.getByRole("navigation", { name: "Primary navigation" })
    .getByRole("link", { name: "Settings" })
    .click();
  await page.getByRole("button", { name: "Accounts" }).click();
  await page.getByRole("button", { name: "Add account" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill("Temporary Browser Manager");
  await dialog.getByLabel("Email").fill("temporary.browser.manager@example.com");
  await dialog.getByLabel("Account type").selectOption("manager");
  await dialog.getByLabel("Temporary password").fill("TemporaryPass123!");
  await dialog.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Account created.")).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();

  await page.getByLabel("Email").fill("temporary.browser.manager@example.com");
  await page.getByLabel("Password").fill("TemporaryPass123!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Create your password" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary navigation" })).toHaveCount(0);

  await page.getByLabel("Temporary password").fill("TemporaryPass123!");
  await page.getByLabel("New password", { exact: true }).fill("PrivateBrowserPass123!");
  await page.getByLabel("Confirm new password").fill("PrivateBrowserPass123!");
  await page.getByRole("button", { name: "Create password" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Business overview" })).toBeVisible();
});

for (const role of ["captain", "cleaner"]) {
  test(`${role} can sign in and is limited to field routes`, async ({ page }) => {
    await login(page, accounts[role]);
    await expect(page.getByRole("heading", { level: 1, name: "My route" })).toBeVisible();
    const navigation = page.getByRole("navigation", { name: "Primary navigation" });
    await expect(navigation.getByRole("link", { name: "Today" })).toBeVisible();
    await expect(navigation.getByRole("link", { name: "Schedule" })).toBeVisible();
    await expect(navigation.getByRole("link", { name: "Customers" })).toHaveCount(0);
    await navigation.getByRole("link", { name: "Schedule" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "My route" })).toBeVisible();
  });
}
