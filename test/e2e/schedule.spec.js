import { addDays, expect, login, nextMonday, test } from "./fixture.js";

test("manager schedules multiple individual dates and moves the future series", async ({ page }) => {
  await login(page);
  await page.getByRole("navigation", { name: "Primary navigation" })
    .getByRole("link", { name: "Schedule" })
    .click();
  await page.getByRole("tab", { name: "Others" }).click();
  await page.getByRole("button", { name: "Add recurring service" }).click();
  const dialog = page.getByRole("dialog");

  const firstDate = nextMonday(addDays(new Date().toISOString().slice(0, 10), 0));
  const secondDate = addDays(firstDate, 14);
  const movedDate = addDays(firstDate, 1);
  const singleMovedDate = addDays(movedDate, 1);

  await dialog.getByLabel("Find client").fill("Jordan");
  const clientSelect = dialog.getByRole("combobox").first();
  await expect(clientSelect.locator("option")).toHaveCount(2);
  await clientSelect.selectOption({ index: 1 });
  const propertySelect = dialog.locator("label.form-field")
    .filter({ hasText: "Property" })
    .locator("select");
  await expect(propertySelect.locator("option")).toHaveCount(2);
  await propertySelect.selectOption({ index: 1 });
  await dialog.getByLabel("Frequency").selectOption("individual_dates");
  await dialog.getByRole("button", { name: /^Remove / }).click();
  const individualDate = dialog.locator(".individual-date-picker input[type=date]");
  await individualDate.fill(firstDate);
  await dialog.getByRole("button", { name: "Add date" }).click();
  await individualDate.fill(secondDate);
  await dialog.getByRole("button", { name: "Add date" }).click();
  await dialog.getByRole("spinbutton", { name: "Flat fee", exact: true }).fill("235");
  await dialog.getByRole("button", { name: "Add recurring service" }).click();

  await expect(page.getByText("Recurring service added.")).toBeVisible();
  const row = page.locator(".other-services-table .data-row").filter({ hasText: "Jordan Ellis" });
  await expect(row).toContainText("2 individual dates");
  const scheduleLabel = await row.locator('[data-label="Schedule"]').textContent();
  await row.getByRole("button", { name: "Place" }).click();
  await expect(page.getByRole("button", { name: "Place visit" })).toBeEnabled();
  await page.getByRole("button", { name: "Place visit" }).click();
  await expect(page.getByText("Recurring visit placed on the crew schedule.")).toBeVisible();

  await page.getByRole("tab", { name: scheduleLabel.trim() }).click();
  await page.getByRole("button", { name: "Edit service" }).click();
  await page.getByLabel("Apply changes to").selectOption("future");
  await page.getByLabel("Service date").fill(movedDate);
  await page.getByLabel("Special instructions").fill("Future series moved by browser test");
  await page.getByRole("button", { name: "Save service" }).click();
  await expect(page.getByText("Recurring service and future visits updated.")).toBeVisible();

  await page.getByRole("tab", { name: /Tuesday/ }).click();
  await expect(page.locator(".time-block-table")).toContainText("Jordan Ellis");
  await expect(page.locator(".time-block-table")).toContainText("Future series moved by browser test");

  await page.getByRole("button", { name: "Edit service" }).click();
  await page.getByLabel("Apply changes to").selectOption("single");
  await page.getByLabel("Service date").fill(singleMovedDate);
  await page.getByLabel("Special instructions").fill("Only this visit moved by browser test");
  await page.getByRole("button", { name: "Save service" }).click();
  await expect(page.getByText("Scheduled service updated.")).toBeVisible();

  await page.getByRole("tab", { name: /Wednesday/ }).click();
  await expect(page.locator(".time-block-table")).toContainText("Only this visit moved by browser test");
});

test("manager pauses, resumes, and ends a recurring service plan", async ({ page }) => {
  await login(page);
  await page.getByRole("navigation", { name: "Primary navigation" })
    .getByRole("link", { name: "Schedule" })
    .click();
  await page.getByRole("tab", { name: "Service plans" }).click();

  let row = page.locator(".recurring-plan-table .data-row").filter({ hasText: "Jordan Ellis" });
  page.once("dialog", (confirmation) => confirmation.accept());
  await row.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByText("Service plan paused.")).toBeVisible();

  await page.reload();
  await page.getByRole("tab", { name: "Service plans" }).click();
  await page.getByLabel("Plan status").selectOption("paused");
  row = page.locator(".recurring-plan-table .data-row").filter({ hasText: "Jordan Ellis" });
  await expect(row).toContainText(/paused/i);
  await row.getByRole("button", { name: "Resume" }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Resume plan" }).click();
  await expect(page.getByText("Service plan resumed from the selected date.")).toBeVisible();

  await page.getByLabel("Plan status").selectOption("active");
  row = page.locator(".recurring-plan-table .data-row").filter({ hasText: "Jordan Ellis" });
  await expect(row).toContainText(/active/i);
  page.once("dialog", (confirmation) => confirmation.accept());
  await row.getByRole("button", { name: "End plan" }).click();
  await expect(page.getByText("Service plan ended.")).toBeVisible();

  await page.getByLabel("Plan status").selectOption("ended");
  row = page.locator(".recurring-plan-table .data-row").filter({ hasText: "Jordan Ellis" });
  await expect(row).toContainText(/ended/i);
  await expect(row.getByText("Closed")).toBeVisible();
});
