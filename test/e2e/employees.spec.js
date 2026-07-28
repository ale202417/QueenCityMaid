import { addDays, expect, login, test } from "./fixture.js";

test("manager controls employee, feedback, team membership, and availability records", async ({ page }) => {
  await login(page);
  await page.getByRole("navigation", { name: "Primary navigation" })
    .getByRole("link", { name: "Employees" })
    .click();
  await page.getByRole("button", { name: "Add employee" }).click();
  let dialog = page.getByRole("dialog");

  await dialog.getByLabel("First name").fill("Browser");
  await dialog.getByLabel("Last name").fill("Cleaner");
  await dialog.getByLabel("Phone").fill("7045557773");
  await dialog.getByLabel("Hire date").fill(new Date().toISOString().slice(0, 10));
  await dialog.getByRole("spinbutton", { name: "Hourly rate" }).fill("21.50");
  await dialog.getByLabel("Experience level").selectOption("senior");
  await dialog.getByLabel("Can drive").selectOption("true");
  await dialog.getByRole("button", { name: "Add employee" }).click();
  await expect(page.getByText("Employee added.")).toBeVisible();

  await page.getByLabel("Search employees").fill("Browser Cleaner");
  let employeeRow = page.locator(".employee-table .data-row")
    .filter({ hasText: "Browser Cleaner" });
  await expect(employeeRow).toContainText("$21.50/hr");
  await expect(employeeRow).toContainText("Yes");
  await employeeRow.getByRole("button", { name: "Feedback" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Rating").selectOption("4");
  await dialog.getByLabel("Feedback notes").fill("Consistent positive client feedback");
  await dialog.getByRole("button", { name: "Record feedback" }).click();
  await expect(dialog).toContainText("4 of 5");
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(employeeRow).toContainText("4.0 quality rating");

  await employeeRow.getByRole("button", { name: "Feedback" }).click();
  dialog = page.getByRole("dialog");
  page.once("dialog", (confirmation) => confirmation.accept());
  await dialog.locator(".stack-row")
    .filter({ hasText: "Consistent positive client feedback" })
    .getByRole("button", { name: "Delete" })
    .click();
  await expect(dialog.getByText("No feedback")).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).click();

  await employeeRow.getByRole("button", { name: "Edit" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("spinbutton", { name: "Hourly rate" }).fill("22.25");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Employee updated.")).toBeVisible();
  employeeRow = page.locator(".employee-table .data-row")
    .filter({ hasText: "Browser Cleaner" });
  await expect(employeeRow).toContainText("$22.25/hr");

  await page.getByRole("button", { name: "Teams", exact: true }).click();
  await page.getByRole("button", { name: "Add team" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Team name").fill("Browser Crew");
  await dialog.getByRole("button", { name: "Add team" }).click();
  await expect(page.getByText("Team added.")).toBeVisible();
  const teamRow = page.locator(".stack-row").filter({ hasText: "Browser Crew" });
  await teamRow.getByRole("button", { name: "Members" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Employee").selectOption({ label: "Browser Cleaner" });
  await dialog.getByRole("checkbox", { name: "Captain" }).check();
  await dialog.getByRole("button", { name: "Add member" }).click();
  await expect(dialog.locator(".stack-row").filter({ hasText: "Browser Cleaner" }))
    .toContainText("Captain and driver");
  await dialog.getByRole("button", { name: "Close" }).click();

  await teamRow.getByRole("button", { name: "Edit" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Status").selectOption("false");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Team updated.")).toBeVisible();
  await expect(teamRow).toContainText(/inactive/i);
  await teamRow.getByRole("button", { name: "Edit" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Status").selectOption("true");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(teamRow).toContainText(/active/i);

  await page.getByRole("button", { name: "Availability", exact: true }).click();
  await page.getByRole("button", { name: "Add availability" }).click();
  dialog = page.getByRole("dialog");
  const tomorrow = addDays(new Date().toISOString().slice(0, 10), 1);
  await dialog.getByLabel("Employee").selectOption({ label: "Browser Cleaner" });
  await dialog.getByLabel("Unavailable from").fill(`${tomorrow}T08:00`);
  await dialog.getByLabel("Unavailable until").fill(`${tomorrow}T17:00`);
  await dialog.getByLabel("Reason").fill("Approved browser test request");
  await dialog.getByLabel("Status").selectOption("approved");
  await dialog.getByRole("button", { name: "Add availability" }).click();
  await expect(page.getByText("Availability added.")).toBeVisible();

  const availabilityRow = page.locator(".availability-table .data-row")
    .filter({ hasText: "Approved browser test request" });
  await expect(availabilityRow).toContainText(/approved/i);
  await availabilityRow.getByRole("button", { name: "Review" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Status").selectOption("declined");
  await dialog.getByRole("button", { name: "Save decision" }).click();
  await expect(page.getByText("Availability updated.")).toBeVisible();
  await expect(page.locator(".availability-table .data-row")
    .filter({ hasText: "Approved browser test request" })).toContainText(/declined/i);

  await page.getByRole("button", { name: "Employees", exact: true }).click();
  employeeRow = page.locator(".employee-table .data-row")
    .filter({ hasText: "Browser Cleaner" });
  await employeeRow.getByRole("button", { name: "Edit" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Status").selectOption("false");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(employeeRow).toContainText(/inactive/i);
  await employeeRow.getByRole("button", { name: "Edit" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Status").selectOption("true");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(employeeRow).toContainText(/active/i);
});
