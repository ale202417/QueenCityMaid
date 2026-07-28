import { defineConfig, devices } from "@playwright/test";

const port = 4179;

export default defineConfig({
  testDir: "./test/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ["line"],
    ["html", { outputFolder: ".cache/playwright-report", open: "never" }]
  ],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  },
  projects: [
    {
      name: "desktop-chromium",
      testIgnore: /responsive\.spec\.js/,
      use: { ...devices["Desktop Chrome"] }
    },
    {
      name: "mobile-chromium",
      testMatch: /responsive\.spec\.js/,
      use: { ...devices["iPhone 13"], browserName: "chromium" }
    }
  ],
  webServer: {
    command: `"${process.execPath}" src/server/dev-server.js`,
    env: { ...process.env, PORT: String(port) },
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000
  }
});
