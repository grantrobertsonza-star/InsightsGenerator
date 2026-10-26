// Runs the adapter's own readiness checks (e2e/adapter/*.check.mjs), separately from Codex's
// smoke specification, with the same settings as playwright.config.mjs.
import base from "../../playwright.config.mjs";

export default {
  ...base,
  testDir: ".",
  testMatch: /.*\.check\.mjs$/,
  outputDir: "../../e2e-results/adapter-check-output",
  reporter: [["list"], ["json", { outputFile: "../../e2e-results/report-adapter-check.json" }]],
};
