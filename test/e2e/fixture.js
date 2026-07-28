import { expect, test as base } from "@playwright/test";

export const accounts = {
  manager: "manager@queencitymaid.local",
  captain: "captain@queencitymaid.local",
  cleaner: "cleaner@queencitymaid.local"
};

export const password = "manager123!";

export const test = base.extend({
  page: async ({ page }, use) => {
    const failures = [];
    page.on("pageerror", (error) => failures.push(`Page error: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error"
        && !message.text().startsWith("Failed to load resource:")) {
        failures.push(`Console error: ${message.text()}`);
      }
    });
    page.on("response", (response) => {
      if (response.status() >= 500) {
        failures.push(`${response.status()} ${response.request().method()} ${response.url()}`);
      }
    });
    await use(page);
    expect(failures, failures.join("\n")).toEqual([]);
  }
});

export { expect };

export async function login(page, account = accounts.manager) {
  await page.goto("/");
  await page.getByLabel("Email").fill(account);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator("#main-content h1")).toBeVisible();
}

export function addDays(value, amount) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + amount);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

export function nextMonday(value, weeksAhead = 1) {
  const date = new Date(`${value}T12:00:00`);
  const distance = (8 - date.getDay()) % 7 || 7;
  date.setDate(date.getDate() + distance + (weeksAhead - 1) * 7);
  return addDays(
    [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0")
    ].join("-"),
    0
  );
}
