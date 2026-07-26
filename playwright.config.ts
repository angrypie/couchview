import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const externalBaseURL = process.env.PLAYWRIGHT_BASE_URL;
const fixtureHost = process.env.E2E_HOST || "127.0.0.1";
const fixturePort = Number(process.env.E2E_PORT || 4174);
const baseURL = externalBaseURL || `http://${fixtureHost}:${fixturePort}`;
const defaultBunPath = join(
  homedir(),
  ".bun",
  "bin",
  process.platform === "win32" ? "bun.exe" : "bun",
);
const bunExecutable =
  process.env.BUN_EXECUTABLE ||
  (typeof Bun !== "undefined"
    ? process.execPath
    : existsSync(defaultBunPath)
      ? defaultBunPath
      : "bun");
const bunCommand = JSON.stringify(bunExecutable);

export default defineConfig({
  testDir: "./tests/e2e",
  // The local fixture models mutations (comments, reviews, and staging) in
  // memory. Run the mobile projects serially so every test can reset to the
  // same repository revision without another worker racing that reset.
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    locale: "en-US",
    timezoneId: "Europe/Lisbon",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: externalBaseURL
    ? undefined
    : {
        command: `${bunCommand} run build && ${bunCommand} run scripts/e2e-fixture.ts`,
        url: `${baseURL}/api/bootstrap`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: {
          E2E_HOST: fixtureHost,
          E2E_PORT: String(fixturePort),
        },
      },
  projects: [
    {
      name: "desktop-terminal-chromium",
      testMatch: /(desktop-layout|terminal-workspace)\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      name: "mobile-320-chromium",
      testIgnore: /(desktop-layout|terminal-workspace)\.spec\.ts/,
      use: { ...devices["Pixel 7"], viewport: { width: 320, height: 720 } },
    },
    {
      name: "mobile-375-webkit",
      testIgnore: /(desktop-layout|terminal-workspace)\.spec\.ts/,
      use: { ...devices["iPhone 13"], viewport: { width: 375, height: 812 } },
    },
    {
      name: "mobile-430-chromium",
      testIgnore: /(desktop-layout|terminal-workspace)\.spec\.ts/,
      use: { ...devices["Pixel 7"], viewport: { width: 430, height: 932 } },
    },
    {
      name: "mobile-landscape-chromium",
      testIgnore: /(desktop-layout|terminal-workspace)\.spec\.ts/,
      use: { ...devices["Pixel 7"], viewport: { width: 844, height: 390 } },
    },
  ],
});
