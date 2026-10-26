// The scatter wording review (Codex RRV-01, 2026-10-21), in a real browser on the disposable stack.
// When a researcher's wording was kept over changed figures (RR-01), the Analytics scatter card is
// where it is resolved: calculated findings cannot be reworded in Findings.
//   1. Build a scatter on a seeded file and post it.
//   2. Seed the state RR-01 records (wording edited by the researcher, figures changed since): the
//      card shows the warning, the sentence the current figures give, and both choices.
//   3. Keep my wording: the warning goes, the wording stays the researcher's, and it stays gone
//      after a reload.
//   4. Seeded again, Use the current wording: the finding takes the offered sentence, keeps its id,
//      and the researcher's wording is kept on record with its provenance.
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

const RESEARCHER = "Customers who find us easy to reach trust us more (researcher wording).";

test("the scatter card resolves wording kept over changed figures: keep it, or use the current sentence", async ({ page }, testInfo) => {
  test.setTimeout(6 * 60_000);
  const db = new pg.Client({ connectionString: target.databaseUrlWithoutCredentials.replace("postgres://", "postgres://postgres@") });
  await db.connect();
  try {
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const run = await ui.createRun({ name: `scatter-wording-${Date.now()}` });
    const dir = mkdtempSync(path.join(tmpdir(), "scatter-wording-"));
    const file = path.join(dir, "scatter-data.csv");
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const lines = ["id,EASE,TRUST"];
    for (let i = 1; i <= 80; i++) {
      const ease = 1 + Math.floor(rnd() * 5);
      lines.push(`${i},${ease},${Math.min(5, Math.max(1, ease + Math.round(rnd() * 2 - 1)))}`);
    }
    writeFileSync(file, lines.join("\n") + "\n");
    await ui.upload(run, file, "table");

    const scatterFinding = async () =>
      (await db.query("select id, finding_text, stated_stats, human_edited_fields from findings where run_id=$1 and stated_stats->>'source'='scatter_tool' and status<>'rejected'", [run.id])).rows;
    const openScatter = async () => {
      await page.goto(run.url, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: /^Analytics/ }).first().click();
      const section = page.getByTestId("analytics-section").filter({ visible: true });
      await section.getByRole("list", { name: "Analyses" }).getByRole("button", { name: /^Charts/ }).click({ timeout: 60_000 });
      const workspace = page.getByRole("dialog", { name: "Analytics workspace" });
      await workspace.getByRole("radiogroup", { name: "Chart type" }).getByRole("radio", { name: "Scatter" }).click({ timeout: 60_000 });
      await workspace.getByLabel("X axis variable").selectOption("EASE");
      await workspace.getByLabel("Y axis variable").selectOption("TRUST");
      await workspace.getByRole("button", { name: "Build scatter plot" }).click();
      return workspace;
    };
    // The state RR-01 records when figures change under wording the researcher edited.
    const seedReview = async (id, suggested) =>
      db.query(
        `update findings set finding_text = $2, human_edited_fields = array['finding_text'],
                stated_stats = (stated_stats - 'wording_confirmed_for') || jsonb_build_object('wording_review', jsonb_build_object('reason', 'figures_changed', 'suggested_text', $3::text))
          where id = $1`,
        [id, RESEARCHER, suggested],
      );

    // 1. Build and post.
    let ws = await openScatter();
    await ws.getByRole("button", { name: "Post to findings" }).first().click({ timeout: 60_000 });
    await expect.poll(async () => (await scatterFinding()).length, { timeout: 60_000 }).toBe(1);
    const [posted] = await scatterFinding();
    const suggested = posted.finding_text;

    // 2. The review is shown with both choices.
    await seedReview(posted.id, suggested);
    ws = await openScatter();
    const review = ws.getByTestId("scatter-finding-wording-review").first();
    await expect(review).toBeVisible({ timeout: 60_000 });
    await expect(review.getByTestId("scatter-finding-suggested-text")).toHaveText(suggested);
    await expect(review.getByRole("button", { name: "Keep my wording" })).toBeVisible();
    await expect(review.getByRole("button", { name: "Use the current wording" })).toBeVisible();
    await expect(ws.getByText("Reword it in Findings")).toHaveCount(0);

    // 3. Keep my wording.
    await review.getByRole("button", { name: "Keep my wording" }).click();
    await expect(ws.getByTestId("scatter-finding-wording-review")).toHaveCount(0, { timeout: 30_000 });
    let [f] = await scatterFinding();
    expect(f.id).toBe(posted.id);
    expect(f.finding_text).toBe(RESEARCHER);
    expect(f.stated_stats.wording_review).toBeUndefined();
    expect(typeof f.stated_stats.wording_confirmed_for).toBe("string");
    ws = await openScatter();
    await expect(ws.getByRole("button", { name: "Remove from findings" }).first()).toBeVisible({ timeout: 60_000 });
    await expect(ws.getByTestId("scatter-finding-wording-review")).toHaveCount(0);

    // 4. Seeded again: use the current wording.
    await seedReview(posted.id, suggested);
    ws = await openScatter();
    await ws.getByTestId("scatter-finding-wording-review").first().getByRole("button", { name: "Use the current wording" }).click({ timeout: 60_000 });
    await expect(ws.getByTestId("scatter-finding-wording-review")).toHaveCount(0, { timeout: 30_000 });
    [f] = await scatterFinding();
    expect(f.id).toBe(posted.id);
    expect(f.finding_text).toBe(suggested);
    expect(f.human_edited_fields ?? []).not.toContain("finding_text");
    expect(f.stated_stats.wording_history).toEqual([expect.objectContaining({ text: RESEARCHER, human_edited_fields: ["finding_text"], replaced_with: suggested })]);
    ws = await openScatter();
    await expect(ws.getByRole("button", { name: "Remove from findings" }).first()).toBeVisible({ timeout: 60_000 });
    await expect(ws.getByTestId("scatter-finding-wording-review")).toHaveCount(0);
  } finally {
    await db.end();
  }
});
