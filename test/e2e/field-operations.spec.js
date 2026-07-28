import { accounts, expect, login, test } from "./fixture.js";

test("manager finalizes a route, cleaner reports an issue, and captain completes the day", async ({ browser, page }) => {
  await login(page);
  await page.getByRole("navigation", { name: "Primary navigation" })
    .getByRole("link", { name: "Schedule" })
    .click();
  await page.getByRole("tab", { name: "Crown" }).click();
  const finalize = page.getByRole("button", { name: "Finalize crew route" });
  if (await finalize.isVisible()) {
    await finalize.click();
    await expect(page.getByText("Crew route finalized and ready for the captain.")).toBeVisible();
  }

  const cleanerContext = await browser.newContext();
  const cleanerPage = await cleanerContext.newPage();
  await login(cleanerPage, accounts.cleaner);
  await expect(cleanerPage.getByText("Jordan Ellis")).toBeVisible();
  await expect(cleanerPage.locator(".route-summary").getByText("Cleaner", { exact: true }))
    .toBeVisible();
  await expect(cleanerPage.getByRole("button", { name: "Check in team" })).toHaveCount(0);
  await cleanerPage.getByRole("button", { name: "Report job issue" }).click();
  const issueDialog = cleanerPage.getByRole("dialog");
  await issueDialog.getByLabel("Issue type").selectOption("access");
  await issueDialog.getByLabel("Description").fill("Gate code needs manager confirmation");
  await issueDialog.getByRole("button", { name: "Report issue" }).click();
  await expect(cleanerPage.getByText("Job issue reported to management.")).toBeVisible();
  await cleanerContext.close();

  const captainContext = await browser.newContext();
  const captainPage = await captainContext.newPage();
  await login(captainPage, accounts.captain);
  await expect(captainPage.locator(".route-summary").getByText("Captain", { exact: true }))
    .toBeVisible();
  const checkIn = await captainPage.evaluate(async () => {
    const date = document.querySelector('input[aria-label="Route date"]').value;
    const routeResponse = await fetch(`/api/my-route?date=${date}`, {
      credentials: "include"
    });
    const routeBody = await routeResponse.json();
    const routeId = routeBody.data.route.id;
    const response = await fetch(`/api/routes/${routeId}/check-in`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        occurredAt: new Date(Date.now() - 60 * 60 * 1000).toISOString()
      })
    });
    return { routeId, status: response.status };
  });
  expect(checkIn.status).toBe(200);
  await captainPage.reload();
  await captainPage.getByRole("button", { name: "Check out team" }).click();
  await expect(captainPage.getByText("Team checked out.")).toBeVisible();
  await expect(captainPage.locator(".route-summary").getByText("completed", { exact: true }))
    .toBeVisible();
  await captainContext.close();

  await page.getByRole("tab", { name: "Job issues" }).click();
  const issueRow = page.locator(".job-issue-table .data-row")
    .filter({ hasText: "Gate code needs manager confirmation" });
  await expect(issueRow).toContainText("Maya Collins");
  await issueRow.getByRole("button", { name: "Resolve" }).click();
  const resolutionDialog = page.getByRole("dialog");
  await resolutionDialog.getByLabel("Resolution notes")
    .fill("Manager confirmed the updated gate code");
  await resolutionDialog.getByRole("button", { name: "Resolve issue" }).click();
  await expect(page.getByText("Job issue resolved.")).toBeVisible();
  await page.getByLabel("Issue status").selectOption("resolved");
  await expect(page.locator(".job-issue-table .data-row")
    .filter({ hasText: "Gate code needs manager confirmation" })).toContainText("resolved");
});
