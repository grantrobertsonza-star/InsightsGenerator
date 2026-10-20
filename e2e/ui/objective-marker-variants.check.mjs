// OBJ-SET-M02: objectives typed with different list markers (numbered, hyphenated, Unicode bullet)
// become one objective each, with the marker removed, and stay consistent between Setup and Review
// through edit, delete and reload. The original brief is never changed.
// Real browser on the disposable stack; candidate rows are read from the database.
//   1. Setup saves "1. Alpha", "- Beta" and "• Gamma" on three lines: three objective candidates
//      whose stored text has no marker, and Setup and Review both list the three.
//   2. Review edits Beta to "Beta revised"; Setup edits Gamma to "Gamma revised".
//   3. Review deletes Alpha.
//   4. After reload, Setup and Review both show exactly "Beta revised" and "Gamma revised"; the
//      candidates are those two rows, with their original ids; the brief equals the saved text.
import { expect, test } from "@playwright/test";
import { openSection } from "./helpers/nav.mjs";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
const dbUrl = new URL(target.databaseUrlWithoutCredentials);
if (target.disposable !== true || !/^\/ie_e2e_[a-f0-9]{10}$/.test(dbUrl.pathname)) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
const TYPED = "1. Marker objective Alpha\n- Marker objective Beta\n• Marker objective Gamma";

test("numbered, hyphenated and bulleted objectives stay one each and consistent across Setup and Review", async ({ page }, testInfo) => {
  page.on("dialog", (d) => d.accept());
  const db = new pg.Client({ connectionString: target.databaseUrlWithoutCredentials.replace("postgres://", "postgres://postgres@") });
  await db.connect();
  try {
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const run = await ui.createRun({ name: `marker-variants-${Date.now()}` });
    const section = (name) => openSection(page, name);
    const candidates = async () => (await db.query("select id, candidate_text from objective_candidates where run_id=$1 order by candidate_text", [run.id])).rows;
    const reopen = async (name) => {
      await page.goto(run.url, { waitUntil: "networkidle" });
      await section(name);
    };

    // 1. Save the three marker forms.
    await section("Set Objectives");
    const form = page.locator("form", { has: page.locator('textarea[name="researchObjective"]') });
    await form.locator('textarea[name="researchObjective"]').fill(TYPED);
    await form.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(async () => (await candidates()).map((c) => c.candidate_text), { timeout: 60_000 }).toEqual([
      "Marker objective Alpha",
      "Marker objective Beta",
      "Marker objective Gamma",
    ]);
    const ids = Object.fromEntries((await candidates()).map((c) => [c.candidate_text.split(" ").pop(), c.id]));
    const brief = (await db.query("select initial_research_objective from runs where id=$1", [run.id])).rows[0].initial_research_objective;
    for (const w of ["Alpha", "Beta", "Gamma"]) await expect(page.getByText(`Marker objective ${w}`, { exact: true }).first()).toBeVisible();
    await reopen("Review Objectives");
    for (const w of ["Alpha", "Beta", "Gamma"]) await expect(page.locator("tr", { hasText: `Marker objective ${w}` }).first()).toBeVisible({ timeout: 60_000 });

    // 2a. Review: Beta to "Beta revised".
    const betaRow = page.locator("tr", { hasText: "Marker objective Beta" }).first();
    await betaRow.getByRole("button", { name: "Edit", exact: true }).click();
    const editingRow = page.locator("tr", { has: page.locator("textarea") }).first();
    await editingRow.locator("textarea").fill("Marker objective Beta revised");
    await editingRow.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(async () => (await db.query("select candidate_text from objective_candidates where id=$1", [ids.Beta])).rows[0]?.candidate_text, { timeout: 30_000 }).toBe("Marker objective Beta revised");

    // 2b. Setup: Gamma to "Gamma revised".
    await reopen("Set Objectives");
    const gamma = page.locator("li").filter({ visible: true }).filter({ has: page.getByText("Marker objective Gamma", { exact: true }) }).last();
    await gamma.getByRole("button", { name: "Edit", exact: true }).click();
    const setupEditor = page.locator("li").filter({ visible: true }).filter({ has: page.locator("textarea") });
    await setupEditor.locator("textarea").fill("Marker objective Gamma revised");
    await setupEditor.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(async () => (await db.query("select candidate_text from objective_candidates where id=$1", [ids.Gamma])).rows[0]?.candidate_text, { timeout: 30_000 }).toBe("Marker objective Gamma revised");

    // 3. Review: delete Alpha.
    await reopen("Review Objectives");
    const alphaRow = page.locator("tr", { hasText: "Marker objective Alpha" }).first();
    await alphaRow.getByRole("button", { name: "Delete objective" }).click();
    await expect.poll(async () => (await candidates()).length, { timeout: 30_000 }).toBe(2);

    // 4. Both presentations agree after reload; ids and brief preserved.
    const expected = ["Marker objective Beta revised", "Marker objective Gamma revised"];
    expect(await candidates()).toEqual([
      { id: ids.Beta, candidate_text: expected[0] },
      { id: ids.Gamma, candidate_text: expected[1] },
    ]);
    await reopen("Set Objectives");
    for (const t of expected) await expect(page.getByText(t, { exact: true }).first()).toBeVisible({ timeout: 60_000 });
    for (const gone of ["Marker objective Alpha", "Marker objective Beta", "Marker objective Gamma"]) await expect(page.getByText(gone, { exact: true })).toHaveCount(0);
    await reopen("Review Objectives");
    for (const t of expected) await expect(page.locator("tr", { hasText: t }).first()).toBeVisible({ timeout: 60_000 });
    await expect(page.locator("tr", { hasText: "Marker objective Alpha" })).toHaveCount(0);
    expect((await db.query("select initial_research_objective from runs where id=$1", [run.id])).rows[0].initial_research_objective).toBe(brief);
  } finally {
    await db.end();
  }
});
