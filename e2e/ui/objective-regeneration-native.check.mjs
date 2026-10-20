// OBJ-SET-003 / OBJ-REV-004: a native "Regenerate suggestions" with a usable model answer keeps
// researcher decisions. Earlier native runs never regenerated anything: the model replay had no
// answer for record_objective_candidates, so the framer refused ("Nothing was changed"). Here the
// stack's model fixture supplies each answer (a disclosed scripted-model boundary; the framer,
// its persistence and the page are real). One synthetic finding is inserted so regeneration is
// offered.
//   1. First regeneration: two AI suggestions arrive pending.
//   2. The researcher rejects one and edits their own objective in Review.
//   3. Second regeneration repeats the rejected wording and adds a new one: after reload the
//      rejected suggestion is still the only copy (rejected), the undecided one is replaced, the
//      new one is pending, and the edited own objective keeps its wording.
//   4. The researcher deletes their own objective; a third regeneration does not bring it (or the
//      original brief text) back, and the original brief is unchanged.
import { expect, test } from "@playwright/test";
import { openSection } from "./helpers/nav.mjs";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
const dbUrl = new URL(target.databaseUrlWithoutCredentials);
if (target.disposable !== true || !/^\/ie_e2e_[a-f0-9]{10}$/.test(dbUrl.pathname)) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
const fixtureFile = path.join(path.dirname(path.resolve(manifestPath)), "model-fixture.json");
const answer = (texts) =>
  writeFileSync(fixtureFile, JSON.stringify({ tools: { record_objective_candidates: [{ match: "", input: { candidates: texts.map((t) => ({ candidate_text: t, rationale: "Synthetic fixture rationale" })) } }] } }));

test.afterEach(() => rmSync(fixtureFile, { force: true }));

test("native regeneration keeps a rejection, edited wording and a deletion", async ({ page }, testInfo) => {
  page.on("dialog", (d) => d.accept());
  const db = new pg.Client({ connectionString: target.databaseUrlWithoutCredentials.replace("postgres://", "postgres://postgres@") });
  await db.connect();
  try {
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const run = await ui.createRun({ name: `objective-regeneration-${Date.now()}` });
    const section = (name) => openSection(page, name);
    const rows = async () => (await db.query("select candidate_text, status, source from objective_candidates where run_id=$1 order by candidate_text", [run.id])).rows;
    const openReview = async () => {
      await page.goto(run.url, { waitUntil: "networkidle" });
      await section("Review Objectives");
    };
    const regenerate = async () => {
      await page.getByRole("button", { name: /^(Regenerate suggestions|Suggest objectives from these findings)$/ }).first().click();
    };

    await section("Set Objectives");
    const form = page.locator("form", { has: page.locator('textarea[name="researchObjective"]') });
    await form.locator('textarea[name="researchObjective"]').fill("Own regeneration objective");
    await form.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(async () => (await rows()).length, { timeout: 60_000 }).toBe(1);
    const brief = (await db.query("select initial_research_objective from runs where id=$1", [run.id])).rows[0].initial_research_objective;
    await db.query("insert into findings(tenant_id,run_id,origin,finding_text) values($1,$2,'generated','Synthetic finding for regeneration')", [target.tenantId, run.id]);

    // 1. First regeneration.
    answer(["Suggestion to reject", "Suggestion left undecided"]);
    await openReview();
    await regenerate();
    await expect.poll(async () => (await rows()).filter((r) => r.source === "ai_suggested").map((r) => [r.candidate_text, r.status]), { timeout: 60_000 }).toEqual([
      ["Suggestion left undecided", "pending"],
      ["Suggestion to reject", "pending"],
    ]);

    // 2. Reject one; edit the own objective in Review.
    await openReview();
    await page.locator("tbody[data-objective-row]", { hasText: "Suggestion to reject" }).first().getByRole("button", { name: "Reject", exact: true }).click();
    await expect.poll(async () => (await rows()).find((r) => r.candidate_text === "Suggestion to reject")?.status, { timeout: 30_000 }).toBe("rejected");
    const own = page.locator("tbody[data-objective-row]", { hasText: "Own regeneration objective" }).first();
    await own.getByRole("button", { name: "Edit", exact: true }).click();
    const editingRow = page.locator("tbody[data-objective-row]", { has: page.locator("textarea") }).first();
    await editingRow.locator("textarea").fill("Own regeneration objective, edited");
    await editingRow.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(async () => (await rows()).some((r) => r.candidate_text === "Own regeneration objective, edited"), { timeout: 30_000 }).toBe(true);

    // 3. Second regeneration repeats the rejected wording.
    answer(["Suggestion to reject", "Fresh suggestion"]);
    await openReview();
    await regenerate();
    await expect.poll(async () => (await rows()).some((r) => r.candidate_text === "Fresh suggestion"), { timeout: 60_000 }).toBe(true);
    expect(await rows()).toEqual([
      { candidate_text: "Fresh suggestion", status: "pending", source: "ai_suggested" },
      { candidate_text: "Own regeneration objective, edited", status: "accepted", source: "researcher_authored" },
      { candidate_text: "Suggestion to reject", status: "rejected", source: "ai_suggested" },
    ]);
    await openReview();
    await expect(page.locator("tbody[data-objective-row]", { hasText: "Own regeneration objective, edited" }).first()).toBeVisible({ timeout: 60_000 });
    await expect(page.locator("tbody[data-objective-row]", { hasText: "Fresh suggestion" }).first()).toBeVisible();
    await expect(page.locator("tbody[data-objective-row]", { hasText: "Suggestion left undecided" })).toHaveCount(0);

    // 4. Delete the own objective, regenerate again: nothing resurrected.
    await page.locator("tbody[data-objective-row]", { hasText: "Own regeneration objective, edited" }).first().getByRole("button", { name: "Delete objective" }).click();
    await expect.poll(async () => (await rows()).some((r) => r.source === "researcher_authored"), { timeout: 30_000 }).toBe(false);
    answer(["Another suggestion"]);
    await openReview();
    await regenerate();
    await expect.poll(async () => (await rows()).some((r) => r.candidate_text === "Another suggestion"), { timeout: 60_000 }).toBe(true);
    const finalRows = await rows();
    expect(finalRows.some((r) => r.source === "researcher_authored")).toBe(false);
    expect(finalRows.some((r) => /^Own regeneration objective/.test(r.candidate_text))).toBe(false);
    expect(finalRows.find((r) => r.candidate_text === "Suggestion to reject")).toMatchObject({ status: "rejected" });
    expect((await db.query("select initial_research_objective from runs where id=$1", [run.id])).rows[0].initial_research_objective).toBe(brief);
  } finally {
    await db.end();
  }
});
