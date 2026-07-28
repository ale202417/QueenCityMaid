import { readFile } from "node:fs/promises";
import { expect, login, test } from "./fixture.js";

async function openManagerPage(page, name) {
  await page.getByRole("navigation", { name: "Primary navigation" })
    .getByRole("link", { name })
    .click();
}

test("manager exports all records matching active filters", async ({ page }) => {
  await login(page);
  await openManagerPage(page, "Leads");
  await page.getByLabel("Search leads").fill("Taylor");
  await expect(page.locator(".lead-table .data-row").filter({ hasText: "Taylor Morgan" }))
    .toBeVisible();
  let [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export filtered CSV" }).click()
  ]);
  let contents = await readFile(await download.path(), "utf8");
  expect(contents).toContain("Taylor Morgan");
  expect(contents).not.toContain("Jordan Ellis");

  await openManagerPage(page, "Customers");
  await page.getByLabel("Search customers").fill("Jordan");
  [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export filtered CSV" }).click()
  ]);
  contents = await readFile(await download.path(), "utf8");
  expect(contents).toContain("Jordan Ellis");
  expect(contents).toContain("Properties");

  await openManagerPage(page, "Employees");
  await page.getByLabel("Search employees").fill("Angela");
  [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export filtered CSV" }).click()
  ]);
  contents = await readFile(await download.path(), "utf8");
  expect(contents).toContain("Angela");
  expect(contents).toContain("Hourly rate");
});

test("manager creates, edits, searches, and records activity for a lead", async ({ page }) => {
  await login(page);
  await openManagerPage(page, "Leads");
  await page.getByRole("button", { name: "Add lead" }).click();
  let dialog = page.getByRole("dialog");

  await dialog.getByLabel("Name").fill("Browser Test Lead");
  await dialog.getByLabel("Source").fill("Website");
  await dialog.getByLabel("Phone").fill("7045557771");
  await dialog.getByLabel("Inquiry").fill("Monthly residential cleaning");
  await dialog.getByRole("button", { name: "Add lead" }).click();
  await expect(page.getByText("Lead added.")).toBeVisible();

  await page.getByLabel("Search leads").fill("Browser Test Lead");
  const row = page.locator(".lead-table .data-row").filter({ hasText: "Browser Test Lead" });
  await expect(row).toBeVisible();
  await expect(row).toContainText("Website");
  await row.getByRole("button", { name: "Edit" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Status").selectOption("contacted");
  await dialog.getByLabel("Inquiry").fill("Monthly cleaning, client contacted");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Lead updated.")).toBeVisible();
  await expect(row).toContainText(/contacted/i);

  await row.getByRole("button", { name: "Activity" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Activity type").selectOption("call");
  await dialog.getByLabel("Details").fill("Discussed square footage and pets");
  await dialog.getByRole("button", { name: "Record activity" }).click();
  await expect(dialog).toContainText("Discussed square footage and pets");
  await dialog.getByRole("button", { name: "Close" }).click();

  await page.reload();
  await page.getByLabel("Search leads").fill("Browser Test Lead");
  await expect(
    page.locator(".lead-table .data-row").filter({ hasText: "Browser Test Lead" })
  ).toContainText(/contacted/i);

  let currentRow = page.locator(".lead-table .data-row")
    .filter({ hasText: "Browser Test Lead" });
  await currentRow.getByRole("button", { name: "Close lead" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Outcome").selectOption("unresponsive");
  await dialog.getByLabel("Reason").fill("Browser lifecycle verification");
  await dialog.getByRole("button", { name: "Close lead" }).click();
  await expect(page.getByText("Lead closed.")).toBeVisible();
  currentRow = page.locator(".lead-table .data-row")
    .filter({ hasText: "Browser Test Lead" });
  await expect(currentRow).toContainText(/unresponsive/i);
  page.once("dialog", (confirmation) => confirmation.accept());
  await currentRow.getByRole("button", { name: "Reopen" }).click();
  await expect(page.getByText("Lead reopened.")).toBeVisible();

  currentRow = page.locator(".lead-table .data-row")
    .filter({ hasText: "Browser Test Lead" });
  await currentRow.getByRole("button", { name: "Convert" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Service frequency").selectOption("monthly");
  await dialog.getByLabel("Payment method").selectOption("zelle");
  await dialog.getByLabel("Internal notes").fill("Converted during browser verification");
  await dialog.getByRole("checkbox", { name: "Add the first property" }).check();
  await dialog.getByLabel("Address", { exact: true }).fill("204 Browser Lane");
  await dialog.getByLabel("Postal code").fill("28202");
  await dialog.getByRole("button", { name: "Convert lead" }).click();
  await expect(page.getByText("Lead converted to an active customer.")).toBeVisible();
  await expect(page.locator(".lead-table .data-row")
    .filter({ hasText: "Browser Test Lead" })).toContainText(/converted/i);

  await openManagerPage(page, "Customers");
  await page.getByLabel("Search customers").fill("Browser Test Lead");
  await expect(page.locator(".customer-table .data-row")
    .filter({ hasText: "Browser Test Lead" })).toContainText("Monthly");
});

test("manager creates, revises, sends, and approves a quote", async ({ page }) => {
  await login(page);
  await openManagerPage(page, "Quotes");
  await page.getByRole("button", { name: "Create quote" }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Find customer").fill("Jordan");
  const customer = dialog.getByRole("combobox").first();
  await expect(customer.locator("option")).toHaveCount(2);
  await customer.selectOption({ index: 1 });
  await dialog.getByLabel("Property").selectOption({ index: 1 });
  await dialog.getByLabel("Service").selectOption({ label: "Deep Cleaning" });
  await dialog.getByLabel("Quoted amount").fill("285");
  await dialog.getByLabel("Quote notes").fill("Browser quote verification");
  await dialog.getByRole("button", { name: "Create quote" }).click();
  await expect(page.getByText("Quote created.")).toBeVisible();

  let quote = page.locator(".quote-table .data-row").filter({ hasText: "Jordan Ellis" }).first();
  await expect(quote).toContainText("$285.00");
  await quote.getByRole("button", { name: "Manage" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Service").selectOption({ label: "Patio" });
  await dialog.getByLabel("Item amount").fill("45");
  await dialog.getByRole("button", { name: "Add item" }).click();
  await expect(dialog).toContainText("$330.00");
  page.once("dialog", (confirmation) => confirmation.accept());
  await dialog.getByRole("button", { name: "Mark sent" }).click();
  await expect(page.getByText("Quote marked as sent.")).toBeVisible();

  quote = page.locator(".quote-table .data-row").filter({ hasText: "Jordan Ellis" }).first();
  await expect(quote).toContainText(/sent/i);
  await quote.getByRole("button", { name: "Manage" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Record approval" }).click();
  await dialog.getByLabel("Customer reply").fill("Customer approved by text");
  await dialog.getByRole("button", { name: "Approve quote" }).click();
  await expect(page.getByText("Quote approved.")).toBeVisible();
  await expect(page.locator(".quote-table .data-row")
    .filter({ hasText: "Jordan Ellis" }).first()).toContainText(/approved/i);
});

test("manager persists customer preferences and controls the property lifecycle", async ({ page }) => {
  await login(page);
  await openManagerPage(page, "Customers");
  await page.getByRole("button", { name: "Add customer" }).click();
  let dialog = page.getByRole("dialog");

  await dialog.getByLabel("Name").fill("Browser Test Customer");
  await dialog.getByRole("textbox", { name: "Phone", exact: true }).fill("7045557772");
  await dialog.getByRole("textbox", { name: "Email", exact: true })
    .fill("browser.customer@example.com");
  await dialog.getByLabel("Service frequency").selectOption("other");
  await dialog.getByLabel("Payment method").selectOption("zelle");
  await dialog.getByLabel("Internal notes").fill("Every five weeks when requested");
  await dialog.getByRole("button", { name: "Add customer" }).click();
  await expect(page.getByText("Customer added.")).toBeVisible();

  let row = page.locator(".customer-table .data-row")
    .filter({ hasText: "Browser Test Customer" });
  await expect(row).toContainText("Every five weeks when requested");
  await expect(row).toContainText("Zelle");

  await row.getByRole("button", { name: /properties/ }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Add property" }).click();
  await dialog.getByLabel("Label").fill("Test Home");
  await dialog.getByLabel("Address").fill("900 Browser Lane");
  await dialog.getByLabel("Postal code").fill("28202");
  await dialog.getByLabel("Square feet").fill("2100");
  await dialog.getByLabel("Pets").fill("One dog");
  await dialog.getByRole("button", { name: "Add property" }).click();
  await expect(dialog).toContainText("900 Browser Lane");

  await dialog.locator(".stack-row").filter({ hasText: "900 Browser Lane" })
    .getByRole("button", { name: "Edit" }).click();
  await dialog.getByLabel("City").fill("Indian Land");
  await dialog.getByLabel("Access instructions").fill("Use side door");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog).toContainText("Indian Land");

  page.once("dialog", (confirmation) => confirmation.accept());
  await dialog.locator(".stack-row").filter({ hasText: "900 Browser Lane" })
    .getByRole("button", { name: "Delete" }).click();
  await expect(dialog.getByText("No properties")).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).click();

  await page.getByLabel("Search customers").fill("Browser Test Customer");
  row = page.locator(".customer-table .data-row")
    .filter({ hasText: "Browser Test Customer" });
  await expect(row.getByRole("button", { name: "0 properties" })).toBeVisible();
  await row.getByRole("button", { name: "Text consent" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Consent status").selectOption("granted");
  await dialog.getByLabel("How consent was received").fill("Browser QA confirmation");
  await dialog.getByRole("button", { name: "Record consent" }).click();
  await expect(page.getByText(/Text consent granted/)).toBeVisible();

  await row.getByRole("button", { name: "Cancel customer" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Cancellation reason").fill("Browser QA lifecycle test");
  await dialog.getByRole("button", { name: "Cancel customer" }).click();
  await expect(page.getByText("Browser Test Customer was cancelled.")).toBeVisible();

  await page.getByLabel("Filter customer status").selectOption("cancelled");
  await expect(
    page.locator(".customer-table .data-row").filter({ hasText: "Browser Test Customer" })
  ).toContainText(/cancelled/i);
  await page.reload();
  await page.getByLabel("Filter customer status").selectOption("cancelled");
  row = page.locator(".customer-table .data-row").filter({ hasText: "Browser Test Customer" });
  await expect(row).toContainText(/cancelled/i);
  page.once("dialog", (confirmation) => confirmation.accept());
  await row.getByRole("button", { name: "Reactivate customer" }).click();
  await expect(page.getByText("Browser Test Customer was reactivated.")).toBeVisible();
  await page.getByLabel("Filter customer status").selectOption("active");
  row = page.locator(".customer-table .data-row")
    .filter({ hasText: "Browser Test Customer" });
  await expect(row).toContainText(/active/i);
  page.once("dialog", (confirmation) => confirmation.accept());
  await row.getByRole("button", { name: "Pause services" }).click();
  await expect(page.getByText("Browser Test Customer was paused and future visits were stopped.")).toBeVisible();
  await page.getByLabel("Filter customer status").selectOption("paused");
  row = page.locator(".customer-table .data-row")
    .filter({ hasText: "Browser Test Customer" });
  await expect(row).toContainText(/paused/i);
  page.once("dialog", (confirmation) => confirmation.accept());
  await row.getByRole("button", { name: "Resume customer" }).click();
  await expect(page.getByText(/Browser Test Customer was resumed/)).toBeVisible();
});

test("manager queues a balance reminder for a consented customer", async ({ page }) => {
  await login(page);
  await openManagerPage(page, "Customers");
  const row = page.locator(".customer-table .data-row").filter({ hasText: "Jordan Ellis" });
  await row.getByRole("button", { name: "Payment reminder" }).click();
  await expect(page.getByText("Payment reminder queued for Jordan Ellis.")).toBeVisible();
});
