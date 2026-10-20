// A focus group guide added through Add files (Grant, 2026-10-20: "if I added a focus group guide,
// there is no link to it in the qual data file; when I add one, it is not automatically read").
// Real browser on the disposable stack (model replay).
//   1. Questionnaire, Interview guide and Focus group guide are their own types in Add files, with no
//      separate step asking which it is; the guide is stored as a focus group guide.
//   2. The guide is read by itself as soon as Import shows it, with the transcript selected, not
//      the guide: the reading call is made once (replay records its usage).
//   3. The transcript names the guide and has a Guide tab; the guide is listed as linked to the
//      transcripts, under its own type.
//   4. Reloading Import does not read the guide again (a read was attempted; only Read again repeats).
// The data file's "Weights and missing codes" tab is covered in scale-missing-reload.check.
import { expect, test } from "@playwright/test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { addFiles, openAddFiles } from "./helpers/addFiles.mjs";
import { openSource, selectSource } from "./helpers/sources.mjs";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
if (target.disposable !== true) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
const FIXTURE = path.resolve("fixtures/golden-thread-1");

test.use({ viewport: { width: 1600, height: 1000 } });

test("a focus group guide is its own type, is read by itself, and is linked to the transcripts", async ({ page }, testInfo) => {
  test.setTimeout(6 * 60_000);
  const db = new pg.Client({ connectionString: target.databaseUrlWithoutCredentials.replace("postgres://", "postgres://postgres@") });
  await db.connect();
  try {
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const run = await ui.createRun({ name: `guide-auto-read-${Date.now()}` });
    await page.getByRole("button", { name: /^Import data/ }).first().click();
    const dir = mkdtempSync(path.join(tmpdir(), "guide-"));
    const transcript = path.join(dir, "focus-group-1.txt");
    writeFileSync(transcript, ["Moderator: How do you pay for data?", "Thandi: Mostly airtime bundles.", "Sipho: The banking app when I can."].join("\n"));
    await addFiles(page, transcript, "Qual data");
    await expect(page.getByTestId("source-row")).toHaveCount(1, { timeout: 120_000 });

    // 1. The three types, and no "which is it" step.
    const panel = await openAddFiles(page);
    await panel.getByTestId("add-files-input").setInputFiles(path.join(FIXTURE, "questionnaire.docx"));
    const types = await panel.getByLabel("Type of questionnaire.docx").locator("option").allInnerTexts();
    expect(types).toEqual(expect.arrayContaining(["Questionnaire", "Interview guide", "Focus group guide"]));
    expect(types).not.toContain("Questionnaire or guide");
    await panel.getByLabel("Type of questionnaire.docx").selectOption({ label: "Focus group guide" });
    await expect(panel.getByText("The questionnaire or guide is a")).toHaveCount(0);
    await panel.getByRole("button", { name: /^Upload/ }).click();
    await expect(page.getByTestId("source-row")).toHaveCount(2, { timeout: 120_000 });
    const guide = (await db.query("select id, instrument_type from documents where run_id=$1 and kind='instrument'", [run.id])).rows[0];
    expect(guide.instrument_type).toBe("focus_group_guide");

    // 2. Read by itself, once, with the transcript selected.
    await selectSource(page, "focus-group-1.txt");
    const reads = async () => Number((await db.query("select count(*) from trace where run_id=$1 and event='api_usage' and detail->>'agent'='instrument_reader'", [run.id])).rows[0].count);
    await expect.poll(reads, { timeout: 120_000, message: "the guide was read without being opened" }).toBeGreaterThan(0);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2_000);
    const afterFirst = await reads();

    // 3. Linked both ways, under its own type.
    const transcriptRow = page.getByTestId("source-row").filter({ has: page.getByRole("button", { name: "Select focus-group-1.txt", exact: true }) });
    await expect(transcriptRow.getByTestId("linked-instrument")).toContainText("1 linked document", { timeout: 60_000 });
    await expect(page.getByRole("tab", { name: "Guide", exact: true })).toBeVisible();
    const guideRow = page.getByTestId("source-row").filter({ has: page.getByRole("button", { name: "Select questionnaire.docx", exact: true }) });
    await expect(guideRow).toContainText("Focus group guide");
    await expect(guideRow.getByTestId("linked-instrument")).toContainText("Linked to your transcripts");
    await openSource(page, "questionnaire.docx", "Guide");
    await expect(page.getByTestId("file-purpose-text")).toContainText(/^Focus group guide\. /);

    // 4. A reload does not read it again by itself.
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^Import data/ }).first().click();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3_000);
    expect(await reads(), "a reload read the guide again").toBe(afterFirst);
  } finally {
    await db.end();
  }
});
