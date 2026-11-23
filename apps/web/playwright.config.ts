import { defineConfig } from "@playwright/test";

/** Browser tests of the money flows against a local mainnet fork. Run them through e2e/run.sh. */
export default defineConfig({
  testDir: "e2e",
  timeout: 240_000, // a cold mainnet fork fetches remote state on first touch
  expect: { timeout: 90_000 },
  workers: 1,
  reporter: [["list"], ["html", { open: "never", outputFolder: "e2e/report" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3320",
    viewport: { width: 1280, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {},
  },
});
