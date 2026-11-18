import { defineConfig, chromium } from "@playwright/test";
import { existsSync } from "node:fs";
const bundledBrowser = chromium.executablePath();
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 90000,
  expect: { timeout: 15000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3100",
    trace: "off",
    screenshot: "only-on-failure",
    launchOptions: {
      executablePath:
        process.env.CHROME_EXECUTABLE ??
        (existsSync(bundledBrowser)
          ? bundledBrowser
          : "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
    },
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
