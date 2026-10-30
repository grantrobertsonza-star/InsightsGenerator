// Codex AN500-F01 (2026-10-24), in a real browser on the disposable stack, through the real upload,
// Python reader and driver engine: predictors X1, X2, X3 labelled "Service", "Service", "Service (X2)"
// were shown as "Service", "Service (X2)", "Service (X2)", and the importance-against-performance
// chart plotted X3 (the strongest driver, mean about 106) at X2's mean of about 16. Now:
//   1. The chart's horizontal axis reaches X3's mean (its top tick is about 106, not 16), and the three
//      points sit at three different horizontal positions.
//   2. Posted findings carry each predictor's code under three different names, and the strongest is X3.
import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
if (target.disposable !== true) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
const SHOT = process.env.SHOT;

test.use({ viewport: { width: 1440, height: 900 } });

/** A seeded SAV: X1 about 6, X2 about 16, X3 about 106, each with more than 11 distinct values (so the
 * chart plots means, not top-two shares); Y moves mostly with X3 and least with X2. */
function savFile(dir) {
  const script = String.raw`
import sys, random
import pandas as pd, pyreadstat
random.seed(11)
rows = []
for i in range(240):
    x1 = 6 + random.randint(-6, 6); x2 = 16 + random.randint(-6, 6); x3 = 106 + random.randint(-10, 10)
    rows.append({"Y": 1 + 0.3*x1 + 0.05*x2 + 0.5*x3 + random.uniform(-1.5, 1.5), "X1": x1, "X2": x2, "X3": x3})
df = pd.DataFrame(rows)
pyreadstat.write_sav(df, sys.argv[1], column_labels=["Satisfaction", "Service", "Service", "Service (X2)"])
`;
  const file = path.join(dir, "driver-labels.sav");
  execFileSync("python3", ["-I", "-c", script, file]);
  return file;
}

test("colliding driver labels keep each predictor's own performance and attribution", async ({ page }, testInfo) => {
  test.setTimeout(6 * 60_000);
  const db = new pg.Client({ connectionString: target.databaseUrlWithoutCredentials.replace("postgres://", "postgres://postgres@") });
  await db.connect();
  try {
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const run = await ui.createRun({ name: `driver-labels-${Date.now()}` });
    await ui.upload(run, savFile(mkdtempSync(path.join(tmpdir(), "driver-labels-"))), "table");

    await page.goto(run.url, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^Analytics/ }).first().click();
    const section = page.getByTestId("analytics-section").filter({ visible: true });
    await section.getByRole("list", { name: "Analyses" }).getByRole("button", { name: /^Driver analysis/ }).click({ timeout: 60_000 });
    const ws = page.getByRole("dialog", { name: "Analytics workspace" });
    await expect(ws.getByLabel("Outcome variable")).toBeVisible({ timeout: 60_000 });
    await ws.getByLabel("Outcome variable").selectOption("Y");
    for (const v of ["X1", "X2", "X3"]) {
      await ws.getByTestId("driver-predictor-list").locator("label", { hasText: new RegExp(`^${v}\\b`) }).locator("input[type=checkbox]").check();
    }
    await ws.getByRole("button", { name: "Run driver analysis" }).click();
    const report = ws.getByTestId("driver-report");
    await expect(report).toBeVisible({ timeout: 2 * 60_000 });

    // 1. The chart: the horizontal axis reaches about 106, and three distinct positions.
    const chart = report.locator('svg[aria-label="Importance against performance by question"]');
    await expect(chart).toBeVisible({ timeout: 60_000 });
    const ticks = await chart.locator("text").evaluateAll((els) =>
      els.filter((e) => e.getAttribute("text-anchor") === "middle" && e.getAttribute("font-size") === "9").map((e) => Number(e.textContent)),
    );
    expect(Math.max(...ticks.filter(Number.isFinite))).toBeGreaterThan(100);
    const xs = await chart.locator("circle").evaluateAll((els) => els.map((e) => e.getAttribute("cx")));
    expect(new Set(xs).size).toBe(3);
    if (SHOT) await page.screenshot({ path: SHOT.replace(".png", "-driver-labels.png") });

    // 2. Posted findings name each predictor by its code; the strongest is X3.
    await report.getByRole("button", { name: "Post to findings" }).click();
    await expect
      .poll(async () => (await db.query("select count(*)::int as n from findings where run_id=$1 and pattern_type='driver' and stated_stats->>'kind'='driver'", [run.id])).rows[0].n, { timeout: 60_000 })
      .toBe(3);
    const drivers = (await db.query("select stated_stats from findings where run_id=$1 and pattern_type='driver' and stated_stats->>'kind'='driver'", [run.id])).rows.map((r) => r.stated_stats);
    expect(drivers.map((s) => s.variable).sort()).toEqual(["X1", "X2", "X3"]);
    expect(new Set(drivers.map((s) => s.question)).size).toBe(3);
    expect(drivers.find((s) => s.rank === 1)?.variable).toBe("X3");
  } finally {
    await db.end();
  }
});
