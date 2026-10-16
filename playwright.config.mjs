// Browser smoke configuration. Runs only the e2e/ specs, against a stack the caller has already
// started (scripts/e2e/local-stack.mjs writes the target manifest the spec reads), so this
// config never starts a server or touches a database itself. See docs/validation.md.
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  testMatch: /.*\.spec\.mjs$/,
  // One workflow, one database: no parallel runs that could interleave against the same stack.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  // The thread runs the Python engine and several model calls end to end.
  timeout: 20 * 60_000,
  expect: { timeout: 30_000 },
  outputDir: "e2e-results/test-output",
  reporter: [["list"], ["json", { outputFile: "e2e-results/report.json" }]],
  use: {
    ...devices["Desktop Chrome"],
    acceptDownloads: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
