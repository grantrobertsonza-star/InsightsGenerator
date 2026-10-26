// Browser smoke configuration. Runs only the e2e/ specs, against a stack the caller has already
// started (scripts/e2e/local-stack.mjs writes the target manifest the spec reads), so this
// config never starts a server or touches a database itself. See docs/validation.md.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

// G6: the app requires sign-in. The stack writes a signed-in browser state for its synthetic
// primary user (manifest authStateFile); every browser context starts from it unless a check
// deliberately opens a fresh, signed-out context.
const manifestPath = path.resolve(process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json");
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : {};
const storageState = manifest.authStateFile && existsSync(manifest.authStateFile) ? manifest.authStateFile : undefined;

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
    storageState,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
