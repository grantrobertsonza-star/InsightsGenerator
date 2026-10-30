// The document bin (claude/document-deletion-contract.md, batch 25), in a real browser on the
// disposable stack:
//   1. Removing a report from Sources says what goes (its reviewed finding with a note, the decision
//      suggestion drawn only from it) and that it can be restored; afterwards the file is gone from
//      Sources, its finding is archived, the suggestion is removed, a kept objective drawn from it
//      shows "Source document removed", and Removed files lists it.
//   2. Restore puts the file and its finding (with the note) back and clears the marker.
//   3. Removing it again and choosing Erase now erases it for good.
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { deleteSource } from "./helpers/sources.mjs";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
if (target.disposable !== true) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
const SHOT = process.env.SHOT;

test.use({ viewport: { width: 1440, height: 900 } });

test("a removed file goes to the bin, is restored with its finding and note, and can be erased", async ({ page }, testInfo) => {
  test.setTimeout(6 * 60_000);
  const db = new pg.Client({ connectionString: target.databaseUrlWithoutCredentials.replace("postgres://", "postgres://postgres@") });
  await db.connect();
  try {
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const run = await ui.createRun({ name: `Bin check ${Date.now()}` });
    const q = async (sql, p = []) => (await db.query(sql, p)).rows;
    const filename = `bin-report-${Date.now()}.docx`;
    const [{ id: doc }] = await q(
      "insert into documents (tenant_id, run_id, kind, source_filename, storage_path, content_sha256, extracted_text) values ($1,$2,'report',$3,$4,$5,'Text') returning id",
      [target.tenantId, run.id, filename, `${target.tenantId}/${run.id}/${filename}`, `sha-${Date.now()}`],
    );
    const [{ id: finding }] = await q(
      "insert into findings (tenant_id, run_id, origin, finding_text, status, source_document_id, researcher_note, human_reviewed_at, human_review_action) values ($1,$2,'stated','Bin check finding','accepted',$3,'Keep this note',now(),'accept') returning id",
      [target.tenantId, run.id, doc],
    );
    const [{ id: objective }] = await q(
      "insert into objective_candidates (tenant_id, run_id, candidate_text, rationale, source, status, source_document_ids) values ($1,$2,'Understand repeat purchase','r','researcher_authored','accepted',$3) returning id",
      [target.tenantId, run.id, [doc]],
    );
    const [{ id: decision }] = await q(
      "insert into decision_candidates (tenant_id, run_id, candidate_text, rationale, source, status, source_document_ids) values ($1,$2,'Whether to reprice','r','ai_suggested','accepted',$3) returning id",
      [target.tenantId, run.id, [doc]],
    );
    const runUrl = new URL(`/runs/${run.id}`, target.appUrl).toString();
    const openImport = async () => {
      await page.goto(runUrl, { waitUntil: "networkidle" });
      const ready = page.getByRole("button", { name: `Select ${filename}`, exact: true }).or(page.getByTestId("bin-panel"));
      await expect(async () => {
        if ((await ready.count()) === 0) {
          await page.getByRole("button", { name: /Import data/ }).first().click({ timeout: 5_000 });
          await expect(ready.first()).toBeAttached({ timeout: 5_000 });
        }
      }).toPass({ timeout: 90_000 });
    };

    // 1. Remove.
    await openImport();
    let said = "";
    page.once("dialog", async (d) => { said = d.message(); await d.accept(); });
    await deleteSource(page, filename);
    await expect.poll(async () => (await q("select run_id from documents where id = $1", [doc]))[0].run_id, { timeout: 60_000 }).not.toBe(run.id);
    expect(said).toContain("Remove this file from the project?");
    expect(said).toContain("Its 1 finding, with 1 review decision you made and 1 researcher note, is archived");
    expect(said).toContain("1 unreviewed objective or decision suggestion drawn only from it is removed.");
    expect(said).toContain("1 accepted objective or decision drawn from it is kept and marked");
    expect(said).toContain("in the bin for 30 days");
    expect(await q("select id from findings where id = $1", [finding])).toEqual([]);
    expect((await q("select researcher_note from finding_history where original_finding_id = $1", [finding]))[0].researcher_note).toBe("Keep this note");
    expect(await q("select id from decision_candidates where id = $1", [decision])).toEqual([]);
    expect((await q("select source_removed_at from objective_candidates where id = $1", [objective]))[0].source_removed_at).not.toBeNull();

    await openImport();
    await expect(page.getByRole("button", { name: `Select ${filename}`, exact: true })).toHaveCount(0);
    const panel = page.getByTestId("bin-panel");
    await panel.getByRole("button", { name: /Removed files \(1\)/ }).click();
    const item = panel.getByTestId("bin-item").filter({ hasText: filename });
    await expect(item).toContainText("1 finding archived, 1 with your note, 1 objective or decision suggestion removed, 1 kept objective or decision marked");
    if (SHOT) await page.screenshot({ path: SHOT.replace(".png", "-bin.png"), fullPage: false });

    // 2. Restore.
    await item.getByRole("button", { name: "Restore" }).click();
    await expect.poll(async () => (await q("select run_id from documents where id = $1", [doc]))[0].run_id, { timeout: 60_000 }).toBe(run.id);
    expect((await q("select researcher_note, human_review_action from findings where id = $1", [finding]))[0]).toEqual({ researcher_note: "Keep this note", human_review_action: "accept" });
    expect((await q("select source_removed_at from objective_candidates where id = $1", [objective]))[0].source_removed_at).toBeNull();
    await openImport();
    await expect(page.getByRole("button", { name: `Select ${filename}`, exact: true })).toBeVisible();
    await expect(page.getByTestId("bin-panel")).toHaveCount(0);

    // 3. Remove again, then erase now.
    page.once("dialog", (d) => d.accept());
    await deleteSource(page, filename);
    await expect.poll(async () => (await q("select run_id from documents where id = $1", [doc]))[0].run_id, { timeout: 60_000 }).not.toBe(run.id);
    await openImport();
    await page.getByTestId("bin-panel").getByRole("button", { name: /Removed files/ }).click();
    let eraseSaid = "";
    page.once("dialog", async (d) => { eraseSaid = d.message(); await d.accept(); });
    await page.getByTestId("bin-item").filter({ hasText: filename }).getByRole("button", { name: "Erase now" }).click();
    await expect.poll(async () => (await q("select id from documents where id = $1", [doc])).length, { timeout: 60_000 }).toBe(0);
    expect(eraseSaid).toContain("This cannot be undone.");
    expect(await q("select id from finding_history where original_finding_id = $1", [finding])).toEqual([]);
  } finally {
    await db.end();
  }
});
