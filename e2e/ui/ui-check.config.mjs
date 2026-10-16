// Runs the app's own UI regression checks (e2e/ui/*.check.mjs), separately from Codex's smoke
// specification, against a stack already started with `npm run e2e:stack` (see docs/validation.md).
//   npx playwright test -c e2e/ui/ui-check.config.mjs
import base from "../../playwright.config.mjs";

const uiCheckConfig = {
  ...base,
  testDir: ".",
  testMatch: /.*\.check\.mjs$/,
  timeout: 5 * 60_000,
  outputDir: "../../e2e-results/ui-check-output",
  reporter: [["list"], ["json", { outputFile: "../../e2e-results/report-ui-check.json" }]],
};

export default uiCheckConfig;
