import { defineConfig, devices } from "@playwright/test";

/** End-to-end tests against the production build (`npm run e2e`). */
export default defineConfig({
  testDir: "e2e",
  timeout: 180_000,
  expect: { timeout: 60_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:4174",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } } },
  ],
  webServer: {
    command: "npm run build && npm run preview -- --port 4174 --strictPort",
    url: "http://localhost:4174",
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
