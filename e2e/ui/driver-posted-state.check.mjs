// Whether a reopened driver analysis is posted (Codex RR-04, 2026-10-21), in a real browser on the
// disposable stack. The findings-count read can be slow or fail; neither may present a posted
// analysis as not posted:
//   1. Run and post: one saved analysis with findings.
//   2. Slow count read: reopened before the count arrives, the result and the saved list say
//      "Checking whether this is posted..." and offer neither Post nor Remove; when the count arrives
//      the open result shows "Remove from findings" without being reselected.
//   3. Failed count read: the result and the saved list show the error with Retry and offer no Post;
//      once the read works again, Retry restores "Remove from findings".
//   4. Known zero: removed from the findings, the reopened result offers Post once its count arrives.
//
// The count read is identified as a server-action POST (it carries a `next-action` header) whose body
// is exactly the one-argument list [runId]: driverFindingCountsAction(runId). The other actions the
// workspace calls on opening take (runId, documentId), so their bodies differ. The check asserts the
// matcher saw at least one such request, so a change in how the action is encoded fails here rather
// than passing without the delay or failure ever applying.
import { expect, test } from "@playwright/test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
if (target.disposable !== true) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);

test.use({ viewport: { width: 1440, height: 900 } });

test("a reopened driver analysis never offers Post while its findings count is loading or unreadable", async ({ page }, testInfo) => {
  test.setTimeout(6 * 60_000);
  const db = new pg.Client({ connectionString: target.databaseUrlWithoutCredentials.replace("postgres://", "postgres://postgres@") });
  await db.connect();
  try {
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const run = await ui.createRun({ name: `driver-posted-state-${Date.now()}` });
    // A seeded synthetic file: Y depends on X1 and X2; X3 is noise (same as driver-reopen.check.mjs).
    const dir = mkdtempSync(path.join(tmpdir(), "driver-posted-state-"));
    const file = path.join(dir, "driver-data.csv");
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const rows = ["id,Y,X1,X2,X3"];
    for (let i = 1; i <= 120; i++) {
      const x1 = 1 + Math.floor(rnd() * 5), x2 = 1 + Math.floor(rnd() * 5), x3 = 1 + Math.floor(rnd() * 5);
      const y = Math.min(10, Math.max(0, Math.round(x1 + 0.6 * x2 + rnd() * 2)));
      rows.push(`${i},${y},${x1},${x2},${x3}`);
    }
    writeFileSync(file, rows.join("\n") + "\n");
    await ui.upload(run, file, "table");

    const findings = async () =>
      Number((await db.query("select count(*) from findings where run_id=$1 and pattern_type='driver' and status<>'rejected'", [run.id])).rows[0].count);
    const openDriver = async () => {
      await page.goto(run.url, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: /^Analytics/ }).first().click();
      const section = page.getByTestId("analytics-section").filter({ visible: true });
      await section.getByRole("list", { name: "Analyses" }).getByRole("button", { name: /^Driver analysis/ }).click({ timeout: 60_000 });
      const workspace = page.getByRole("dialog", { name: "Analytics workspace" });
      await expect(workspace.getByLabel("Outcome variable")).toBeVisible({ timeout: 60_000 });
      return workspace;
    };
    const predictor = (ws, name) => ws.getByTestId("driver-predictor-list").locator("label", { hasText: new RegExp(`^${name}\\b`) }).locator("input[type=checkbox]");

    // The count read: a server action whose arguments are exactly [runId].
    const isCountRead = (request) => {
      if (request.method() !== "POST" || !request.headers()["next-action"]) return false;
      try {
        const args = JSON.parse(request.postData() ?? "");
        return Array.isArray(args) && args.length === 1 && args[0] === run.id;
      } catch {
        return false;
      }
    };

    // 1. Run and post.
    let ws = await openDriver();
    await ws.getByLabel("Outcome variable").selectOption("Y");
    await predictor(ws, "X1").check();
    await predictor(ws, "X2").check();
    await ws.getByRole("button", { name: "Run driver analysis" }).click();
    await expect(ws.getByTestId("driver-report")).toBeVisible({ timeout: 2 * 60_000 });
    await ws.getByTestId("driver-report").getByRole("button", { name: "Post to findings" }).click();
    await expect.poll(findings, { timeout: 60_000 }).toBeGreaterThan(0);

    // 2. Slow count read: held for 3 s, then let through unchanged.
    let delayed = 0;
    await page.route("**/*", async (route) => {
      if (!isCountRead(route.request())) return route.fallback();
      delayed += 1;
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      await route.continue();
    });
    ws = await openDriver();
    const savedEntry = ws.getByRole("button", { name: /^Drivers of / }).filter({ visible: true }).first();
    await savedEntry.click();
    const report = ws.getByTestId("driver-report");
    await expect(report).toBeVisible({ timeout: 60_000 });
    await expect(report.getByTestId("driver-post-checking")).toHaveText("Checking whether this is posted...");
    await expect(report.getByRole("button", { name: /^(Post to|Remove from) findings$/ })).toHaveCount(0);
    await expect(ws.getByTestId("driver-post-checking").filter({ visible: true })).toHaveCount(2); // the report and the saved list
    // The count arrives: the open result updates without being reselected.
    await expect(report.getByRole("button", { name: "Remove from findings" })).toBeVisible({ timeout: 30_000 });
    await expect(ws.getByTestId("driver-post-checking")).toHaveCount(0);
    expect(delayed).toBeGreaterThan(0);
    await page.unrouteAll({ behavior: "wait" });

    // 3. Failed count read: answered with a server error.
    let failed = 0;
    await page.route("**/*", async (route) => {
      if (!isCountRead(route.request())) return route.fallback();
      failed += 1;
      await route.fulfill({ status: 500, contentType: "text/plain", body: "count read failed (test)" });
    });
    ws = await openDriver();
    await ws.getByRole("button", { name: /^Drivers of / }).filter({ visible: true }).first().click();
    await expect(report).toBeVisible({ timeout: 60_000 });
    const unknown = report.getByTestId("driver-post-unknown");
    await expect(unknown).toBeVisible({ timeout: 30_000 });
    await expect(unknown).toContainText("Could not check whether this is posted");
    await expect(unknown.getByRole("button", { name: "Retry" })).toBeVisible();
    // No Post anywhere in the workspace: not in the report, not in the saved list.
    await expect(ws.getByRole("button", { name: "Post to findings" }).filter({ visible: true })).toHaveCount(0);
    await expect(ws.getByTestId("driver-post-unknown").filter({ visible: true })).toHaveCount(2);
    expect(failed).toBeGreaterThan(0);

    // The read works again: Retry restores Remove, on the result and in the saved list.
    await page.unrouteAll({ behavior: "wait" });
    await unknown.getByRole("button", { name: "Retry" }).click();
    await expect(report.getByRole("button", { name: "Remove from findings" })).toBeVisible({ timeout: 30_000 });
    await expect(ws.getByTestId("driver-post-unknown")).toHaveCount(0);
    await expect(ws.getByRole("button", { name: "Post to findings" }).filter({ visible: true })).toHaveCount(0);
    // Nothing was posted or removed along the way.
    expect(await findings()).toBeGreaterThan(0);

    // 4. A known zero: taken out of the findings, the reopened result offers Post once its count
    // has arrived, and only then.
    await report.getByRole("button", { name: "Remove from findings" }).click();
    await expect.poll(findings, { timeout: 60_000 }).toBe(0);
    ws = await openDriver();
    await ws.getByRole("button", { name: /^Drivers of / }).filter({ visible: true }).first().click();
    await expect(report.getByRole("button", { name: "Post to findings" })).toBeVisible({ timeout: 30_000 });
    await expect(ws.getByTestId("driver-post-checking")).toHaveCount(0);
    await expect(ws.getByTestId("driver-post-unknown")).toHaveCount(0);
  } finally {
    await db.end();
  }
});
