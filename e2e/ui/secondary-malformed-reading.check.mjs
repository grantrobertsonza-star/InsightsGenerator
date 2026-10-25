// Codex SEC500-F01 (2026-10-24), in a real browser on the disposable stack (production build, model
// REPLAY): a report read again when the model's answer had no findings list was published as a
// complete, empty reading. Its previous unreviewed finding left the active findings and the screen
// said "Extracted, 0 findings" with no sign that the reading had failed. Now:
//   1. the malformed reading fails: the previous finding is still the report's active finding, the
//      card says processing failed and the error names the unusable answer, after a reload too;
//   2. with the model healthy again, Run again replaces the finding and the failure clears.
// Synthetic replay answers only; orchestration evidence, not judgement quality.
import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
const dbUrl = new URL(target.databaseUrlWithoutCredentials);
if (target.disposable !== true || !/^\/ie_e2e_[a-f0-9]{10}$/.test(dbUrl.pathname)) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
const fixtureFile = path.join(path.dirname(path.resolve(manifestPath)), "model-fixture.json");
const FIXTURE = path.resolve("fixtures/golden-thread-1");
const SHOT = process.env.SHOT;
const MATCH = "Here is the report text";
const answer = (findings) => JSON.stringify({ tools: { record_findings: [{ match: MATCH, input: findings === undefined ? {} : { findings } }] } });
const finding = (text, quote) => ({ finding_text: text, finding_kind: "fact", theme: "Purchase", data_type: "quantitative", source_quote: quote });

test.use({ viewport: { width: 1440, height: 900 } });
test.afterEach(() => writeFileSync(fixtureFile, JSON.stringify({})));

test("a malformed re-read fails and keeps the previous finding; a healthy retry replaces it", async ({ page }, testInfo) => {
  test.setTimeout(8 * 60_000);
  const db = new pg.Client({ connectionString: target.databaseUrlWithoutCredentials.replace("postgres://", "postgres://postgres@") });
  await db.connect();
  page.on("dialog", (d) => d.accept());
  try {
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const run = await ui.createRun({ name: `sec-malformed-${Date.now()}` });
    await ui.upload(run, path.join(FIXTURE, "report.docx"), "report");
    const active = async () =>
      (await db.query("select f.id, f.finding_text from findings f join documents d on d.id = f.source_document_id where f.run_id=$1 and d.kind='report' and f.status <> 'rejected' order by f.finding_text", [run.id])).rows;
    const reports = page.getByTestId("reports-section").filter({ visible: true });
    const open = async () => {
      await page.goto(run.url, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: /^Secondary analysis/ }).first().click();
      await expect(reports.getByRole("combobox", { name: "Report or deck" })).toBeVisible({ timeout: 60_000 });
    };

    // A first, healthy reading: one finding.
    writeFileSync(fixtureFile, answer([finding("Convenience is selected by 60%.", "Convenience is selected by")]));
    await open();
    await reports.getByRole("button", { name: /Extract findings/ }).click();
    await expect.poll(async () => (await active()).length, { timeout: 3 * 60_000 }).toBe(1);
    const prior = await active();

    // 1. The model's answer has no findings list.
    writeFileSync(fixtureFile, answer(undefined));
    await open();
    await reports.getByRole("button", { name: "Run again" }).click();
    const failed = reports.getByText("processing failed");
    await expect(failed).toBeVisible({ timeout: 3 * 60_000 });
    await expect(page.getByText(/had no findings list, so it could not be used and nothing was replaced/).first()).toBeVisible();
    expect(await active()).toEqual(prior);
    await expect(reports.getByRole("combobox", { name: "Report or deck" }).locator("option:checked")).toHaveText(/Extracted, 1 finding\b/);
    if (SHOT) await page.screenshot({ path: SHOT.replace(".png", "-malformed.png") });
    await open();
    await expect(reports.getByText("processing failed")).toBeVisible();
    expect(await active()).toEqual(prior);

    // 2. Healthy again: Run again replaces the finding and clears the failure.
    writeFileSync(fixtureFile, answer([finding("Overall NPS is 25.", "Overall NPS is")]));
    await reports.getByRole("button", { name: "Run again" }).click();
    await expect.poll(async () => (await active()).map((f) => f.finding_text), { timeout: 3 * 60_000 }).toEqual(["Overall NPS is 25."]);
    await open();
    await expect(reports.getByText("processing failed")).toHaveCount(0);
  } finally {
    await db.end();
  }
});
