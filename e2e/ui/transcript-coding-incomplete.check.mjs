// A transcript whose coding is incomplete (Grant, 2026-10-24: "Partly read" on a transcript whose
// text was read in full, with no way to fix it from Sources). Real browser on the disposable stack;
// a small text transcript is imported, then its stored status is set to 'incomplete' (what an
// apply-codebook run with a coverage gap stamps; extractThemes.ts) so no model call is needed.
//   1. The list and the selected source say "Coding incomplete", not "Partly read", and the selected
//      source says what to do: open Coding and run Code themes again.
//   2. The Prepare overview's Import card sends it to Coding.
//   3. With the status cleared again (a complete re-run), the list says "Read" and the note goes.
import { expect, test } from "@playwright/test";
import { addFiles } from "./helpers/addFiles.mjs";
import { openSource } from "./helpers/sources.mjs";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
const dbUrl = new URL(target.databaseUrlWithoutCredentials);
if (target.disposable !== true || !/^\/ie_e2e_[a-f0-9]{10}$/.test(dbUrl.pathname)) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
const SHOT = process.env.SHOT;

test.use({ viewport: { width: 1600, height: 1000 } });

test("a transcript with incomplete coding says so on Sources and points to Coding", async ({ page }) => {
  test.setTimeout(6 * 60_000);
  const db = new pg.Client({ connectionString: target.databaseUrlWithoutCredentials.replace("postgres://", "postgres://postgres@") });
  await db.connect();
  try {
    await page.goto(target.appUrl, { waitUntil: "networkidle" });
    await page.locator('a[href="/?entry=generate"]').click();
    await page.getByLabel("Project name").fill(`Coding incomplete ${Date.now()}`);
    await page.getByRole("button", { name: "Create project", exact: true }).click();
    await page.waitForURL(/\/runs\/[0-9a-f-]{36}/);
    const runId = /\/runs\/([0-9a-f-]{36})/.exec(page.url())[1];
    const runUrl = page.url().split("?")[0];

    const dir = mkdtempSync(path.join(tmpdir(), "coding-incomplete-"));
    const NAME = "groups-coding-check.txt";
    writeFileSync(path.join(dir, NAME), ["Moderator: What matters most about the network?", "Participant 1: Coverage at home and at work.", "Participant 2: Not dropping calls on the taxi route."].join("\n"));
    await page.getByRole("button", { name: /^Import data/ }).first().click();
    await addFiles(page, path.join(dir, NAME), "Qual data");
    await expect.poll(async () => (await db.query("select count(*)::int n from documents where run_id=$1", [runId])).rows[0].n, { timeout: 60_000 }).toBe(1);
    await db.query("update documents set processing_status='incomplete' where run_id=$1", [runId]);

    const openImport = async () => {
      await page.goto(runUrl, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: /^Import data/ }).first().click();
      await openSource(page, NAME, "Preview");
    };
    await openImport();
    const selected = page.getByTestId("selected-source");
    await expect(selected.getByTestId("source-processing")).toHaveText("Processing: Coding incomplete");
    await expect(selected.getByTestId("source-coding-incomplete")).toHaveText(
      "Some passages of this transcript were not coded, so findings from it may be missing them. Open Coding and run Code themes again for this file.",
    );
    // The source list's row (its button is named "Select <file>").
    const listRow = page.getByRole("button", { name: `Select ${NAME}`, exact: true });
    await expect(listRow).toContainText("Coding incomplete");
    await expect(listRow).not.toContainText("Partly read");
    if (SHOT) await page.screenshot({ path: SHOT.replace(".png", "-sources.png") });

    // The Prepare overview points to Coding.
    await page.getByRole("button", { name: /^Prepare overview/ }).first().click();
    const prepare = page.getByTestId("section-dashboard-overview-prepare");
    await expect(prepare).toContainText(`Coding of ${NAME} is incomplete: run Code themes again for it`);

    // A complete re-run stamps it ready again: "Read", and no note.
    await db.query("update documents set processing_status='ready' where run_id=$1", [runId]);
    await openImport();
    await expect(selected.getByTestId("source-processing")).toHaveText("Processing: Read");
    await expect(selected.getByTestId("source-coding-incomplete")).toHaveCount(0);
  } finally {
    await db.end();
  }
});
