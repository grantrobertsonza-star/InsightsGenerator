// Coding and Reports and decks in the Sources workspace style (Grant, 2026-10-20), in a real
// browser on the disposable stack:
//   1. With no files, each says so and links to Sources.
//   2. A report is offered in the chooser beside the title with its state ("Not extracted yet"); its
//      card shows Extract findings, and opening the section reads nothing (no model call is recorded).
//   3. With two transcripts, choosing the second shows its card; Quality and exports sits beside the
//      coding and says it fills in once the transcript is coded.
import { expect, test } from "@playwright/test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { addFiles } from "./helpers/addFiles.mjs";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
if (target.disposable !== true) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
const FIXTURE = path.resolve("fixtures/golden-thread-1");

test.use({ viewport: { width: 1440, height: 900 } });

test("Coding and Reports and decks: empty states, one file at a time, nothing read on opening", async ({ page }, testInfo) => {
  test.setTimeout(5 * 60_000);
  const db = new pg.Client({ connectionString: target.databaseUrlWithoutCredentials.replace("postgres://", "postgres://postgres@") });
  await db.connect();
  try {
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const run = await ui.createRun({ name: `coding-reports-${Date.now()}` });
    const coding = page.getByTestId("coding-section").filter({ visible: true });
    const reports = page.getByTestId("reports-section").filter({ visible: true });

    // 1. Empty.
    await page.getByRole("button", { name: /^Coding/ }).first().click();
    await expect(coding).toContainText("No transcripts yet");
    await expect(coding.getByRole("button", { name: "Go to Sources" })).toBeVisible();
    await page.getByRole("button", { name: /^Reports and decks/ }).first().click();
    await expect(reports).toContainText("No reports yet");

    // 2. A report.
    await ui.upload(run, path.join(FIXTURE, "report.docx"), "report");
    await page.goto(run.url, { waitUntil: "networkidle" });
    const usage = async () => Number((await db.query("select count(*) from trace where run_id=$1 and event='api_usage'", [run.id])).rows[0].count);
    const before = await usage();
    await page.getByRole("button", { name: /^Reports and decks/ }).first().click();
    const reportChooser = reports.getByRole("combobox", { name: "Report or deck" });
    await expect(reportChooser).toBeVisible({ timeout: 60_000 });
    await expect(reportChooser.locator("option:checked")).toHaveText(/^report\.docx · Not extracted yet/);
    await expect(reports.getByRole("button", { name: /Extract findings/ })).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(await usage(), "opening Reports and decks called the model").toBe(before);

    // 3. A transcript.
    await page.getByRole("button", { name: /^Import data/ }).first().click();
    const dir = mkdtempSync(path.join(tmpdir(), "coding-"));
    const lines = (who) => ["Interviewer: How do you pay for data?", `${who}: Mostly airtime bundles.`, "Interviewer: Why?", `${who}: It is easier at the shop.`].join("\n");
    const files = ["interview-1.txt", "interview-2.txt"].map((name, i) => {
      const file = path.join(dir, name);
      writeFileSync(file, lines(i === 0 ? "Thandi" : "Sipho"));
      return file;
    });
    await addFiles(page, files, "Qual data");
    await expect(page.getByTestId("source-row")).toHaveCount(3, { timeout: 120_000 });
    await page.getByRole("button", { name: /^Coding/ }).first().click();
    const chooser = coding.getByRole("combobox", { name: "Transcript" });
    await expect(chooser).toBeVisible({ timeout: 60_000 });
    await expect(coding.getByTestId("coding-section-summary")).toHaveText("2 transcripts · 0 coded");
    await chooser.selectOption(await chooser.locator("option", { hasText: "interview-2.txt" }).getAttribute("value"));
    await expect(chooser.locator("option:checked")).toHaveText(/^interview-2\.txt/);
    await expect(coding.getByRole("heading", { name: "Coding", exact: true }).last()).toBeVisible();
    await expect(coding.getByRole("heading", { name: "Quality and exports" })).toBeVisible();
    await expect(coding).toContainText("Quality control and exports appear here once this transcript is coded.");
    if (process.env.SHOT) await coding.screenshot({ path: process.env.SHOT });
  } finally {
    await db.end();
  }
});
