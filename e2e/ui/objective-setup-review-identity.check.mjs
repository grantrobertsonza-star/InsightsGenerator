// OBJ-SET-001: Setup and Review edit and delete the same objective (one candidate row, one id),
// without duplicated or stranded wording, and the original brief is never changed.
// Ported from Codex's native lifecycle harness (repair7/objective-lifecycle-native.mjs, run on an
// earlier frozen source) so it is retained and runs on the current tree. Same steps and
// assertions, plus: after each reload the superseded wording is no longer shown.
// Real browser against the disposable local stack; model replay only. Synthetic data.
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

test("Setup A to B, Review B to C, delete in Review: one candidate id throughout, reloads agree, original brief untouched", async ({ page }, testInfo) => {
  page.setDefaultTimeout(30_000);
  page.on("dialog", (d) => d.accept());
  const db = new pg.Client({ connectionString: target.databaseUrlWithoutCredentials.replace("postgres://", "postgres://postgres@") });
  await db.connect();
  try {
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const section = (name) => openSection(page, name);
    const run = await ui.createRun({ name: `objective-identity-${Date.now()}` });

    await section("Set Objectives");
    const form = page.locator("form", { has: page.locator('textarea[name="researchObjective"]') });
    await form.locator('textarea[name="researchObjective"]').fill("Native objective A");
    await form.getByRole("button", { name: "Save", exact: true }).click();
    const item = page.locator("li").filter({ has: page.getByText("Native objective A", { exact: true }) }).last();
    await expect(item).toBeVisible({ timeout: 60_000 });
    const original = (await db.query("select initial_research_objective from runs where id=$1", [run.id])).rows[0].initial_research_objective;
    const id = (await db.query("select id from objective_candidates where run_id=$1", [run.id])).rows[0].id;

    // Setup: A to B.
    await item.getByRole("button", { name: "Edit", exact: true }).click();
    const editing = page.locator("li").filter({ has: page.locator("textarea") });
    await editing.locator("textarea").fill("Native objective B");
    await editing.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Native objective B", { exact: true })).toBeVisible();
    // The new wording shows before the save finishes; wait for the stored row before reloading
    // (the original harness reloaded at once and passed only when the save happened to be quicker).
    await expect.poll(async () => (await db.query("select candidate_text from objective_candidates where id=$1", [id])).rows[0]?.candidate_text).toBe("Native objective B");

    // Review (after reload): B to C on the same row.
    await page.reload({ waitUntil: "networkidle" });
    await section("Review Objectives");
    await page.getByRole("button").filter({ hasText: "Native objective B" }).first().click();
    const detail = page.locator("div").filter({ has: page.getByRole("button", { name: "All objectives", exact: true }) }).filter({ has: page.getByRole("button", { name: "Edit", exact: true }) }).last();
    await detail.getByRole("button", { name: "Edit", exact: true }).click();
    await page.locator("textarea:visible").first().fill("Native objective C");
    await page.getByRole("button", { name: "Save", exact: true }).first().click();
    await expect.poll(async () => (await db.query("select candidate_text from objective_candidates where id=$1", [id])).rows[0]?.candidate_text).toBe("Native objective C");

    // Setup (after reload) shows C, not A or B; still one row with the same id.
    await page.reload({ waitUntil: "networkidle" });
    await section("Set Objectives");
    await expect(page.getByText("Native objective C", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Native objective B", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Native objective A", { exact: true })).toHaveCount(0);
    expect((await db.query("select id from objective_candidates where run_id=$1", [run.id])).rows).toEqual([{ id }]);

    // Review: delete; Setup (after reload) no longer lists it; the original brief is unchanged.
    await section("Review Objectives");
    await page.getByRole("button").filter({ hasText: "Native objective C" }).first().click();
    await page.getByRole("button", { name: "Delete", exact: true }).first().click();
    await expect.poll(async () => Number((await db.query("select count(*) from objective_candidates where run_id=$1", [run.id])).rows[0].count)).toBe(0);
    await page.reload({ waitUntil: "networkidle" });
    await section("Set Objectives");
    await expect(page.getByText("Native objective C", { exact: true })).toHaveCount(0);
    expect((await db.query("select initial_research_objective from runs where id=$1", [run.id])).rows[0].initial_research_objective).toBe(original);
  } finally {
    await db.end();
  }
});
