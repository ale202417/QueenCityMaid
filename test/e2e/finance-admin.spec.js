import { expect, login, test } from "./fixture.js";

async function openManagerPage(page, name) {
  await page.getByRole("navigation", { name: "Primary navigation" })
    .getByRole("link", { name })
    .click();
}

function currentMonday() {
  const date = new Date();
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

test("manager queues, filters, and cancels a customer message", async ({ page }) => {
  await login(page);
  await openManagerPage(page, "Customers");
  const customer = page.locator(".customer-table .data-row").filter({ hasText: "Jordan Ellis" });
  await customer.getByRole("button", { name: "Payment reminder" }).click();
  await expect(page.getByText("Payment reminder queued for Jordan Ellis.")).toBeVisible();

  await openManagerPage(page, "Messages");
  await page.getByLabel("Filter message status").selectOption("queued");
  const message = page.locator(".message-table .data-row")
    .filter({ hasText: "Jordan Ellis" })
    .filter({ hasText: "$220.00" });
  await expect(message).toContainText("$220.00");
  await message.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText("Message cancelled.")).toBeVisible();
  await page.getByLabel("Filter message status").selectOption("cancelled");
  await expect(page.locator(".message-table .data-row").filter({ hasText: "Jordan Ellis" }))
    .toContainText(/cancelled/i);
  await page.reload();
  await expect(page.locator(".message-table .data-row").filter({ hasText: "Jordan Ellis" }))
    .toContainText(/cancelled/i);
});

test("manager composes a message and retries a failed delivery", async ({ page }) => {
  await login(page);
  await openManagerPage(page, "Messages");
  await page.getByRole("button", { name: "Compose message" }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Find customer").fill("Jordan");
  const customer = dialog.locator("select").first();
  await expect(customer.locator("option")).toHaveCount(2);
  await customer.selectOption({ index: 1 });
  await dialog.getByLabel("Message").fill("Browser QA failed delivery");
  await dialog.getByRole("button", { name: "Queue message" }).click();
  await expect(page.getByText("Customer message queued.")).toBeVisible();

  await page.getByRole("button", { name: "Send due messages" }).click();
  await expect(page.getByText(/queued message.*processed/i)).toBeVisible();
  await page.getByLabel("Filter message status").selectOption("failed");
  const failed = page.locator(".message-table .data-row")
    .filter({ hasText: "Browser QA failed delivery" });
  await expect(failed).toContainText("SMS provider is not configured");
  await failed.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText("Message queued for another delivery attempt.")).toBeVisible();

  await page.getByLabel("Filter message status").selectOption("queued");
  await expect(page.locator(".message-table .data-row")
    .filter({ hasText: "Browser QA failed delivery" })).toContainText(/queued/i);
});

test("manager approves the daily service payment and sees persisted standing", async ({ page }) => {
  await login(page);
  await openManagerPage(page, "Payments");
  const ledgerRow = page.locator(".daily-ledger-table .data-row")
    .filter({ hasText: "Jordan Ellis" });
  await expect(ledgerRow).toContainText("$220.00");
  await ledgerRow.getByRole("button", { name: "Record tip" }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Tip amount").fill("20");
  await dialog.getByRole("button", { name: "Record tip" }).click();
  await expect(page.getByText("Service tip recorded and split across the assigned cleaners.")).toBeVisible();
  await expect(ledgerRow).toContainText("$20.00");

  await ledgerRow.getByRole("button", { name: "Edit tip" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Tip amount").fill("24");
  await dialog.getByRole("button", { name: "Save tip" }).click();
  await expect(page.getByText("Service tip updated.")).toBeVisible();
  await expect(ledgerRow).toContainText("$24.00");

  await ledgerRow.getByRole("button", { name: "Approve" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Payment method").selectOption("venmo");
  await dialog.getByRole("button", { name: "Approve payment" }).click();
  await expect(page.getByText("Payment approved and recorded.")).toBeVisible();
  await expect(ledgerRow).toContainText(/paid/i);

  await page.reload();
  await expect(page.locator(".daily-ledger-table .data-row")
    .filter({ hasText: "Jordan Ellis" })).toContainText(/paid/i);
  await page.getByRole("tab", { name: "Payments", exact: true }).click();
  await expect(page.locator(".payment-record-table .data-row")
    .filter({ hasText: "Jordan Ellis" })).toContainText("Venmo");
  await page.getByRole("tab", { name: "Overview" }).click();
  const overviewRow = page.locator(".payment-overview-table .data-row")
    .filter({ hasText: "Jordan Ellis" });
  await expect(overviewRow).toContainText("$220.00");
  await expect(overviewRow).toContainText(/good standing/i);

  await page.getByRole("tab", { name: "Payments", exact: true }).click();
  let payment = page.locator(".payment-record-table .data-row")
    .filter({ hasText: "Jordan Ellis" });
  await payment.getByRole("button", { name: "Reverse" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Reason").fill("Browser QA incorrect confirmation");
  await dialog.getByRole("button", { name: "Reverse payment" }).click();
  await expect(page.getByText("Payment reversed and customer balance updated.")).toBeVisible();
  payment = page.locator(".payment-record-table .data-row")
    .filter({ hasText: "Jordan Ellis" });
  await expect(payment).toContainText(/reversed/i);
  await expect(payment).toContainText("Browser QA incorrect confirmation");

  await page.getByRole("tab", { name: "Credits" }).click();
  const charge = page.locator(".payment-record-table .data-row")
    .filter({ hasText: "Jordan Ellis" });
  await charge.getByRole("button", { name: "Waive" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Reason").fill("Browser QA courtesy waiver");
  await dialog.getByRole("button", { name: "Waive charge" }).click();
  await expect(page.getByText("Charge waived and customer balance updated.")).toBeVisible();
  await expect(page.locator(".payment-record-table .data-row")
    .filter({ hasText: "Jordan Ellis" })).toHaveCount(0);

  await page.reload();
  await page.getByRole("tab", { name: "Payments", exact: true }).click();
  await expect(page.locator(".payment-record-table .data-row")
    .filter({ hasText: "Jordan Ellis" })).toContainText(/reversed/i);
});

test("manager generates payroll, records hours and tips, and locks the approved period", async ({ page }) => {
  await login(page);
  await openManagerPage(page, "Payroll");
  await page.getByLabel("Pay period starts Monday").fill(currentMonday());
  await page.getByRole("button", { name: "Generate payroll" }).click();
  await expect(page.getByText("Payroll period generated for review.")).toBeVisible();

  await page.getByRole("button", { name: "Add employee hours" }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Employee").selectOption({ label: "Angela Brooks" });
  await dialog.getByLabel("First-house check-in").fill("08:00");
  await dialog.getByLabel("Last-house check-out").fill("17:00");
  await dialog.getByLabel("Tips").fill("18");
  await dialog.getByRole("button", { name: "Add hours" }).click();
  await expect(page.getByText("Employee hours added.")).toBeVisible();

  let employee = page.locator(".payroll-week-table tbody tr").filter({ hasText: "Angela Brooks" });
  await expect(employee).toContainText("9.00 hr");
  await expect(employee).toContainText("$30.00");
  await expect(employee).toContainText("$217.00");
  await page.reload();
  employee = page.locator(".payroll-week-table tbody tr").filter({ hasText: "Angela Brooks" });
  await expect(employee).toContainText("$217.00");

  await page.getByRole("tab", { name: "Payroll Report" }).click();
  await expect(page.locator(".payroll-report-table tbody tr")
    .filter({ hasText: "Angela Brooks" })).toContainText("$217.00");
  await page.getByRole("button", { name: "Approve payroll" }).click();
  await expect(page.getByText("Payroll approved.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add employee hours" })).toHaveCount(0);
  await page.getByRole("button", { name: "Create CSV export" }).click();
  await expect(page.getByText(/Payroll export version 1 created/)).toBeVisible();
});

test("manager records an expense and compares report periods", async ({ page }) => {
  await login(page);
  await openManagerPage(page, "Reports");
  await page.getByRole("button", { name: "Record expense" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Category").selectOption("supplies");
  await dialog.getByLabel("Amount").fill("42.50");
  await dialog.getByLabel("Description").fill("Browser QA supplies");
  await dialog.getByRole("button", { name: "Record expense" }).click();
  await expect(page.getByText("Expense recorded.")).toBeVisible();
  await expect(page.locator(".expense-record-table .data-row")
    .filter({ hasText: "Browser QA supplies" })).toContainText("$42.50");
  await page.reload();
  let expense = page.locator(".expense-record-table .data-row")
    .filter({ hasText: "Browser QA supplies" });
  await expect(expense).toContainText("$42.50");
  await expense.getByRole("button", { name: "Edit" }).click();
  let editDialog = page.getByRole("dialog");
  await editDialog.getByLabel("Amount").fill("47.25");
  await editDialog.getByRole("button", { name: "Save expense" }).click();
  await expect(page.getByText("Expense updated.")).toBeVisible();
  expense = page.locator(".expense-record-table .data-row")
    .filter({ hasText: "Browser QA supplies" });
  await expect(expense).toContainText("$47.25");

  page.once("dialog", (prompt) => prompt.accept("Browser QA duplicate receipt"));
  await expense.getByRole("button", { name: "Void" }).click();
  await expect(page.getByText("Expense voided.")).toBeVisible();
  await expect(expense).toContainText(/voided/i);
  await expect(expense).toContainText("Browser QA duplicate receipt");

  await page.getByRole("tab", { name: "Analytics" }).click();
  await page.getByRole("button", { name: "Compare periods" }).click();
  await expect(page.getByText("Business trend")).toBeVisible();
  await expect(page.locator(".comparison-table")).toContainText("Revenue");
});

test("manager persists business settings and controls an account", async ({ page }) => {
  await login(page);
  await openManagerPage(page, "Settings");
  const quoteAge = page.getByRole("spinbutton", { name: "Quote review age" });
  await quoteAge.fill("9");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Business settings saved.")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("spinbutton", { name: "Quote review age" })).toHaveValue("9");

  await page.getByRole("button", { name: "Services" }).click();
  await page.getByRole("button", { name: "Add service" }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Service name").fill("Browser Turnover Cleaning");
  await dialog.getByLabel("Category").selectOption("residential");
  await dialog.getByLabel("Default duration").fill("240");
  await dialog.getByLabel("Reference checklist").fill("Kitchen\nBathrooms\nFloors");
  await dialog.getByRole("button", { name: "Add service" }).click();
  await expect(page.getByText("Service added.")).toBeVisible();
  const service = page.locator(".service-type-table .data-row")
    .filter({ hasText: "Browser Turnover Cleaning" });
  await expect(service).toContainText("240 min");
  page.once("dialog", (confirmation) => confirmation.accept());
  await service.getByRole("button", { name: "Deactivate" }).click();
  await expect(page.getByText("Browser Turnover Cleaning deactivated.")).toBeVisible();

  await page.getByRole("button", { name: "Accounts" }).click();
  await page.getByRole("button", { name: "Add account" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill("Browser Manager");
  await dialog.getByLabel("Email").fill("browser.manager@example.com");
  await dialog.getByLabel("Account type").selectOption("manager");
  await dialog.getByLabel("Temporary password").fill("BrowserPass123!");
  await dialog.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Account created.")).toBeVisible();

  let account = page.locator(".account-table .data-row")
    .filter({ has: page.getByText("browser.manager@example.com", { exact: true }) });
  await expect(account).toContainText(/active/i);
  await account.getByRole("button", { name: "Edit" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Status").selectOption("false");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Account updated.")).toBeVisible();
  account = page.locator(".account-table .data-row")
    .filter({ has: page.getByText("browser.manager@example.com", { exact: true }) });
  await expect(account).toContainText(/inactive/i);
  await page.reload();
  await page.getByRole("button", { name: "Accounts" }).click();
  await expect(page.locator(".account-table .data-row")
    .filter({ has: page.getByText("browser.manager@example.com", { exact: true }) }))
    .toContainText(/inactive/i);
  account = page.locator(".account-table .data-row")
    .filter({ has: page.getByText("browser.manager@example.com", { exact: true }) });
  await account.getByRole("button", { name: "Edit" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Status").selectOption("true");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator(".account-table .data-row")
    .filter({ has: page.getByText("browser.manager@example.com", { exact: true }) }))
    .toContainText(/active/i);

  await page.getByRole("button", { name: "Activity" }).click();
  await page.getByLabel("Filter entity type").fill("serviceType");
  await page.getByRole("button", { name: "Filter" }).click();
  await expect(page.locator(".audit-table .data-row")
    .filter({ hasText: "Service Type" }).first()).toBeVisible();
});

test("manager sees import validation and persists an accepted customer import", async ({ page }) => {
  await login(page);
  await openManagerPage(page, "Settings");
  await page.getByRole("button", { name: "Imports" }).click();
  const rows = page.getByLabel("Rows JSON");
  await rows.fill('[{"name":"Invalid Browser Import","type":"residential"}]');
  await page.getByRole("button", { name: "Run import" }).click();
  await expect(page.getByRole("status")).toContainText(/row 1 phone.*required/i);

  await rows.fill(JSON.stringify([{
    type: "residential",
    name: "Imported Browser Customer",
    phone: "7045557779",
    serviceFrequency: "monthly",
    paymentMethod: "check",
    addressLine1: "100 Import Way",
    city: "Charlotte",
    postalCode: "28202"
  }]));
  await page.getByRole("button", { name: "Run import" }).click();
  await expect(page.getByText("1 rows imported.")).toBeVisible();
  await expect(page.locator(".import-result")).toContainText("Created");

  await openManagerPage(page, "Customers");
  await page.getByLabel("Search customers").fill("Imported Browser Customer");
  await expect(page.locator(".customer-table .data-row")
    .filter({ hasText: "Imported Browser Customer" })).toContainText("Check");
});
