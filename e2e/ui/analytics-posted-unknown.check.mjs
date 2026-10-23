// UI-GT1000-01 (Codex, 2026-10-21): a chart card whose posted-state read fails says so and offers
// neither Post nor Remove until a read succeeds. In a real browser on the disposable stack:
//   1. A bar chart is built and posted: the card offers Remove.
//   2. Leaving the workspace, SELECT on findings is revoked from the restricted application role
//      only. Reopening rebuilds the remembered card: the chart is drawn, the card shows the posted
//      state could not be checked, with Retry, and has no Post and no Remove control.
//   3. With the grant restored, Retry shows Remove again; reopening shows Remove too. The posted
//      finding's id, wording and status are unchanged throughout.
// The grant is restored in finally whatever happens. Synthetic data only.
import { expect, test } from "@playwright/test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
if (target.disposable !== true || !/^ie_e2e_app_/.test(target.applicationRole?.name ?? "")) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
const role = target.applicationRole.name;

test.use({ viewport: { width: 1440, height: 900 } });

test("a chart card whose posted state cannot be read offers neither Post nor Remove, and Retry recovers", async ({ page }, testInfo) => {
  test.setTimeout(8 * 60_000);
  const db = new pg.Client({ connectionString: target.databaseUrlWithoutCredentials.replace("postgres://", "postgres://postgres@") });
  await db.connect();
  const canSelect = async () => (await db.query("select has_table_privilege($1, 'public.findings', 'SELECT') as ok", [role])).rows[0].ok;
  try {
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const run = await ui.createRun({ name: `posted-unknown-${Date.now()}` });
    const dir = mkdtempSync(path.join(tmpdir(), "posted-unknown-"));
    const rows = ["id,Q1"];
    for (let i = 1; i <= 120; i++) rows.push(`${i},${1 + (i % 3)}`);
    const file = path.join(dir, "posted-unknown.csv");
    writeFileSync(file, rows.join("\n") + "\n");
    await ui.upload(run, file, "table");

    const section = () => page.getByTestId("analytics-section").filter({ visible: true });
    const openCharts = async () => {
      await page.getByRole("button", { name: /^Analytics/ }).first().click();
      await expect(section().getByRole("list", { name: "Analyses" })).toBeVisible({ timeout: 60_000 });
      await section().getByTestId("analytics-file-select").selectOption({ label: "posted-unknown.csv" });
      await section().getByRole("list", { name: "Analyses" }).getByRole("button", { name: /^Charts/ }).click({ timeout: 60_000 });
      const ws = page.getByRole("dialog", { name: "Analytics workspace" });
      await expect(ws).toBeVisible();
      await expect(ws.getByTestId("analytics-restore-slot")).toHaveCount(0, { timeout: 60_000 });
      return ws;
    };
    const card = (ws) => ws.getByTestId("analytics-card-grid").locator("[data-card-kind=bar]").first();
    const posted = async () => (await db.query("select id, finding_text, status from findings where run_id=$1 and stated_stats->>'source'='chart_tool'", [run.id])).rows;

    // 1. Build and post.
    await page.goto(run.url, { waitUntil: "networkidle" });
    let ws = await openCharts();
    await ws.getByRole("radiogroup", { name: "Chart type" }).getByRole("radio", { name: "Bar" }).click({ timeout: 60_000 });
    await ws.getByLabel("Chart question").selectOption("Q1");
    await ws.getByRole("button", { name: "Build chart" }).click();
    await expect(card(ws)).toBeVisible({ timeout: 60_000 });
    await card(ws).getByRole("button", { name: "Post to findings" }).click();
    await expect(card(ws).getByRole("button", { name: "Remove from findings" })).toBeVisible({ timeout: 60_000 });
    await expect.poll(async () => (await posted()).length).toBe(1);
    const before = await posted();
    await ws.getByRole("button", { name: "← All analytics" }).click();
    // Codex RR-M01: posting refreshes the whole project page, which reads findings too. The fault
    // below is only meant for the card's posted-state read, so it waits until that refresh has
    // finished (no request in flight) and the launcher is back; a page that then fails to render is
    // a failure of this check, never an accepted outcome.
    await page.waitForLoadState("networkidle");
    await expect(section().getByRole("list", { name: "Analyses" })).toBeVisible({ timeout: 60_000 });
    await page.waitForLoadState("networkidle");

    // 2. The posted-state read fails: not known, no Post, no Remove.
    await db.query(`revoke select on public.findings from "${role}"`);
    expect(await canSelect()).toBe(false);
    ws = await openCharts();
    await expect(card(ws)).toBeVisible({ timeout: 60_000 });
    await expect(card(ws).getByTestId("chart-post-unknown")).toBeVisible({ timeout: 60_000 });
    // The fault reached only the posted-state read: the project page is still rendered.
    await expect(page.getByText("This part of the project could not be shown")).toHaveCount(0);
    await expect(card(ws).getByRole("button", { name: "Post to findings" })).toHaveCount(0);
    await expect(card(ws).getByRole("button", { name: "Remove from findings" })).toHaveCount(0);
    expect(await posted()).toEqual(before);

    // 3. Grant restored: Retry recovers Remove; a reopen does too.
    await db.query(`grant select on public.findings to "${role}"`);
    expect(await canSelect()).toBe(true);
    await card(ws).getByTestId("chart-post-unknown").getByRole("button", { name: "Retry" }).click();
    await expect(card(ws).getByRole("button", { name: "Remove from findings" })).toBeVisible({ timeout: 60_000 });
    await expect(card(ws).getByTestId("chart-post-unknown")).toHaveCount(0);
    await ws.getByRole("button", { name: "← All analytics" }).click();
    ws = await openCharts();
    await expect(card(ws).getByRole("button", { name: "Remove from findings" })).toBeVisible({ timeout: 60_000 });
    expect(await posted()).toEqual(before);
  } finally {
    await db.query(`grant select on public.findings to "${role}"`).catch(() => {});
    await db.end();
  }
});
