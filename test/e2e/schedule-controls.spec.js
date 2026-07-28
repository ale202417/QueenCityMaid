import { expect, login, test } from "./fixture.js";

function currentSchedule() {
  const anchor = new Date("2026-07-27T12:00:00");
  const today = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const weeks = Math.round((monday - anchor) / (7 * 24 * 60 * 60 * 1000));
  return ((weeks % 2) + 2) % 2 === 0 ? "Schedule A" : "Schedule B";
}

test("manager adds, edits, finalizes, and cancels a one-time scheduled visit", async ({ page }) => {
  await login(page);
  await page.getByRole("navigation", { name: "Primary navigation" })
    .getByRole("link", { name: "Schedule" })
    .click();
  await page.getByRole("tab", { name: currentSchedule() }).click();
  await page.getByRole("tab", { name: "Charlotte" }).click();
  await page.getByRole("button", { name: "Add booking" }).click();
  let dialog = page.getByRole("dialog");

  await dialog.getByLabel("Find client").fill("Jordan");
  const client = dialog.getByRole("combobox").first();
  await expect(client.locator("option")).toHaveCount(2);
  await client.selectOption({ index: 1 });
  const property = dialog.locator("label.form-field")
    .filter({ hasText: "Property" })
    .locator("select");
  await expect(property.locator("option")).toHaveCount(2);
  await property.selectOption({ index: 1 });
  const service = dialog.locator("label.form-field")
    .filter({ hasText: "Service" })
    .locator("select");
  await service.selectOption({ label: "Deep Cleaning" });
  await dialog.getByLabel("Cleaning crew").selectOption({ label: "Charlotte" });
  await dialog.getByLabel("Time block").selectOption("15:00");
  await dialog.getByRole("spinbutton", { name: "Flat fee", exact: true }).fill("310");
  await dialog.getByLabel("Special instructions").fill("Browser one-time booking");
  await dialog.getByRole("button", { name: "Add booking" }).click();
  await expect(page.getByText("Booking added to the schedule.")).toBeVisible();

  let row = page.locator(".time-block-row").filter({ hasText: "Browser one-time booking" });
  await expect(row).toContainText("Jordan Ellis");
  await expect(page.getByText("draft", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Finalize crew route" }).click();
  await expect(page.getByText("Crew route finalized and ready for the captain.")).toBeVisible();
  await expect(page.getByText("finalized", { exact: true })).toBeVisible();

  row = page.locator(".time-block-row").filter({ hasText: "Browser one-time booking" });
  await row.getByRole("button", { name: "Edit service" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("spinbutton", { name: "Flat fee", exact: true }).fill("325");
  await dialog.getByLabel("Special instructions").fill("Browser edited booking");
  await dialog.getByRole("button", { name: "Save service" }).click();
  await expect(page.getByText("Scheduled service updated.")).toBeVisible();
  await expect(page.locator(".time-block-row").filter({ hasText: "Browser edited booking" }))
    .toContainText("$325.00");

  row = page.locator(".time-block-row").filter({ hasText: "Browser edited booking" });
  await row.getByRole("button", { name: "Duplicate" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Cleaning crew").selectOption("");
  await dialog.getByLabel("Time block").selectOption("13:00");
  await dialog.getByLabel("Special instructions").fill("Browser duplicated booking");
  await dialog.getByRole("button", { name: "Duplicate booking" }).click();
  await expect(page.getByText("Booking duplicated on the schedule.")).toBeVisible();
  await page.getByRole("tab", { name: "Unassigned" }).click();
  await expect(page.locator(".time-block-row").filter({ hasText: "Browser duplicated booking" }))
    .toContainText("$325.00");

  await page.getByRole("tab", { name: "Charlotte" }).click();
  row = page.locator(".time-block-row").filter({ hasText: "Browser edited booking" });
  page.once("dialog", (confirmation) => confirmation.accept());
  await row.getByRole("button", { name: "Unassign" }).click();
  await expect(page.getByText("Visit unassigned and kept on the schedule.")).toBeVisible();
  await page.getByRole("tab", { name: "Unassigned" }).click();
  row = page.locator(".time-block-row").filter({ hasText: "Browser edited booking" });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Cancel visit" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Cancellation reason").fill("Browser cancellation check");
  await dialog.getByRole("button", { name: "Cancel visit" }).click();
  await expect(page.getByText(/Visit cancelled/)).toBeVisible();
  await expect(page.locator(".time-block-row").filter({ hasText: "Browser edited booking" }))
    .toHaveCount(0);

  await page.getByRole("tab", { name: "Past services" }).click();
  const cancelled = page.locator(".service-history-table .data-row")
    .filter({ hasText: "Jordan Ellis" })
    .filter({ hasText: /cancelled/i });
  await expect(cancelled).toBeVisible();
  await cancelled.getByRole("button", { name: "Restore visit" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Restore visit" }).click();
  await expect(page.getByText("Visit restored to the schedule.")).toBeVisible();
});
