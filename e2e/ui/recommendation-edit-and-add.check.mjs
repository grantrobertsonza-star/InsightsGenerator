// Codex REC500-F01, F03 and F04 (2026-10-24), in a real browser on the disposable stack, on a project
// seeded with one accepted synthesized insight and one recommendation:
//   1. F01 stale: an editor opened before another page saved is refused, keeps its draft and shows
//      the stored action; "Replace with mine" then saves the draft.
//   2. F01 gone: an editor whose recommendation was deleted meanwhile is refused, keeps its draft,
//      and nothing is written.
//   3. F04: an add whose request never reaches the server keeps the form and every field, shows the
//      error, and a retry adds it once.
//   4. F03: an add that is stored but whose reply is lost keeps the form; sending it again finds the
//      stored one, so there is still one.
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
if (target.disposable !== true) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
const SHOT = process.env.SHOT;

test.use({ viewport: { width: 1440, height: 900 } });

test("recommendation edits refuse stale and deleted targets; a failed or lost add keeps its form and stores once", async ({ page, context }, testInfo) => {
  test.setTimeout(8 * 60_000);
  const db = new pg.Client({ connectionString: target.databaseUrlWithoutCredentials.replace("postgres://", "postgres://postgres@") });
  await db.connect();
  page.on("dialog", (d) => d.accept());
  try {
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const run = await ui.createRun({ name: `rec-edit-add-${Date.now()}` });
    const t = target.tenantId;
    const si = (await db.query(
      "insert into synthesized_insights (tenant_id, run_id, headline, observation, tension, implication, triangulation_count, source_theme_count, review_status) values ($1,$2,'Seeded insight','o','t','i',1,1,'accepted') returning id",
      [t, run.id],
    )).rows[0].id;
    const seedRec = async (action) =>
      (await db.query(
        "insert into recommendations (tenant_id, run_id, synthesized_insight_id, action_text, owner_role, owner_feasibility_note, timeline, metric, priority, assumptions_and_risks, alternatives_considered, source, status) values ($1,$2,$3,$4,'Lead','n','Q1','m','high','a','b','ai_suggested','accepted') returning id",
        [t, run.id, si, action],
      )).rows[0].id;
    const stored = async (id) => (await db.query("select action_text from recommendations where id=$1", [id])).rows[0]?.action_text ?? null;
    const open = async (p) => {
      await p.goto(run.url, { waitUntil: "networkidle" });
      await p.getByRole("button", { name: /^Recommendations/ }).first().click();
      await p.getByTestId("rec-tab-review").first().click();
    };
    const card = (p, id) => p.locator(`[data-testid="recommendation-card"][data-recommendation-id="${id}"]`).filter({ visible: true });

    // 1. Stale editor.
    const id = await seedRec("Seeded action");
    const other = await context.newPage();
    await open(page);
    await open(other);
    await card(page, id).getByRole("button", { name: "Edit", exact: true }).click();
    await card(other, id).getByRole("button", { name: "Edit", exact: true }).click();
    await card(other, id).getByLabel("Action", { exact: true }).fill("Winning action from other editor");
    await card(other, id).getByRole("button", { name: "Save and accept" }).click();
    await expect.poll(() => stored(id)).toBe("Winning action from other editor");
    await card(page, id).getByLabel("Action", { exact: true }).fill("Earlier losing draft");
    await card(page, id).getByRole("button", { name: "Save and accept" }).click();
    const conflict = card(page, id).getByTestId("recommendation-edit-conflict");
    await expect(conflict).toBeVisible({ timeout: 60_000 });
    await expect(conflict.getByTestId("recommendation-current-action")).toHaveText("Stored now: Winning action from other editor");
    await expect(card(page, id).getByLabel("Action", { exact: true })).toHaveValue("Earlier losing draft");
    expect(await stored(id)).toBe("Winning action from other editor");
    if (SHOT) await page.screenshot({ path: SHOT.replace(".png", "-rec-conflict.png") });
    await conflict.getByRole("button", { name: "Replace with mine" }).click();
    await expect.poll(() => stored(id)).toBe("Earlier losing draft");
    await expect(card(page, id).getByLabel("Action", { exact: true })).toHaveCount(0);
    await other.close();

    // 2. Deleted while the editor is open.
    const gone = await seedRec("About to be deleted");
    await open(page);
    await card(page, gone).getByRole("button", { name: "Edit", exact: true }).click();
    await card(page, gone).getByLabel("Action", { exact: true }).fill("Edit of a deleted one");
    await db.query("delete from recommendations where id=$1", [gone]);
    await card(page, gone).getByRole("button", { name: "Save and accept" }).click();
    await expect(card(page, gone).getByRole("alert")).toContainText("no longer in the project", { timeout: 60_000 });
    await expect(card(page, gone).getByLabel("Action", { exact: true })).toHaveValue("Edit of a deleted one");
    expect((await db.query("select count(*)::int as n from recommendations where action_text='Edit of a deleted one'")).rows[0].n).toBe(0);

    // 3. and 4. Adds.
    await open(page);
    const form = page.getByRole("form", { name: "Add your own recommendation" });
    const fill = async (action) => {
      await form.getByLabel("Insight this recommendation is for").selectOption(si);
      await form.getByLabel("Action", { exact: true }).fill(action);
      await form.getByLabel("Owner role", { exact: true }).fill("Owner");
      await form.getByLabel("Timeline", { exact: true }).fill("Next quarter");
      await form.getByLabel("Why this owner, and feasibility", { exact: true }).fill("Owns it.");
      await form.getByLabel("Metric", { exact: true }).fill("A measure");
      await form.getByLabel("Assumptions and risks", { exact: true }).fill("Some risk.");
      await form.getByLabel("Alternatives considered", { exact: true }).fill("Wait.");
    };
    const count = async (action) => (await db.query("select count(*)::int as n from recommendations where run_id=$1 and action_text=$2", [run.id, action])).rows[0].n;
    const isAction = (r) => r.method() === "POST" && Boolean(r.headers()["next-action"]);

    // 3. The request never reaches the server.
    await fill("Add that fails first");
    await page.route("**/*", (route) => (isAction(route.request()) ? route.abort("connectionreset") : route.continue()));
    await form.getByRole("button", { name: "Add recommendation", exact: true }).click();
    await expect(form.getByTestId("recommendation-add-error")).toBeVisible({ timeout: 60_000 });
    await page.unroute("**/*");
    await expect(form.getByLabel("Action", { exact: true })).toHaveValue("Add that fails first");
    await expect(form.getByLabel("Alternatives considered", { exact: true })).toHaveValue("Wait.");
    await expect(form.getByLabel("Insight this recommendation is for")).toHaveValue(si);
    expect(await count("Add that fails first")).toBe(0);
    if (SHOT) await page.screenshot({ path: SHOT.replace(".png", "-rec-add-failed.png") });
    await form.getByRole("button", { name: "Add recommendation", exact: true }).click();
    await expect.poll(() => count("Add that fails first"), { timeout: 60_000 }).toBe(1);
    await expect(form.getByLabel("Action", { exact: true })).toHaveValue("");

    // 4. Stored, but the reply is lost.
    await fill("Add whose reply is lost");
    await page.route("**/*", async (route) => {
      if (!isAction(route.request())) return route.continue();
      await route.fetch();
      await route.abort("connectionreset");
    });
    await form.getByRole("button", { name: "Add recommendation", exact: true }).click();
    await expect(form.getByTestId("recommendation-add-error")).toBeVisible({ timeout: 60_000 });
    await page.unroute("**/*");
    expect(await count("Add whose reply is lost")).toBe(1);
    await expect(form.getByLabel("Action", { exact: true })).toHaveValue("Add whose reply is lost");
    await form.getByRole("button", { name: "Add recommendation", exact: true }).click();
    await expect(form.getByLabel("Action", { exact: true })).toHaveValue("", { timeout: 60_000 });
    expect(await count("Add whose reply is lost")).toBe(1);
  } finally {
    await db.end();
  }
});
