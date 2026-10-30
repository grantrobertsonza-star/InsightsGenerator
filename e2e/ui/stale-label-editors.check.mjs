// Codex DI-F04 and DI-F06 (2026-10-24), in a real browser on the disposable stack, with two pages open
// at once as two editors would be:
//   1. DI-F06: a project renamed on one page; the other page's rename, opened before it, is refused,
//      keeps the typed name and shows the stored one; "Replace with mine" then saves it.
//   2. DI-F04: an output set's wave label saved on one page; the other page's save, opened before it,
//      is refused with the stored values and changes nothing; "Use current values" takes them.
//   3. B23-F01: an over-long wave label is held to its limit and the next edit saves without a conflict.
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

test("stale project-name and output-set editors are refused with what is stored", async ({ page, context }, testInfo) => {
  test.setTimeout(6 * 60_000);
  const db = new pg.Client({ connectionString: target.databaseUrlWithoutCredentials.replace("postgres://", "postgres://postgres@") });
  await db.connect();
  try {
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const original = `Stale rename ${Date.now()}`;
    const run = await ui.createRun({ name: original });
    await db.query("update runs set project_name = $2 where id = $1", [run.id, original]);
    const storedName = async () => (await db.query("select project_name from runs where id = $1", [run.id])).rows[0].project_name;
    const other = await context.newPage();

    // 1. Rename.
    const row = (p) => p.getByTestId("project-row").filter({ has: p.locator(`a[href="/runs/${run.id}"]`) });
    for (const p of [page, other]) {
      await p.goto(new URL("/", target.appUrl).toString(), { waitUntil: "networkidle" });
      await row(p).getByRole("button", { name: "Rename" }).click();
    }
    await row(other).getByLabel("Project name").fill(`${original} newer`);
    await row(other).getByLabel("Project name").press("Enter");
    await expect.poll(storedName).toBe(`${original} newer`);
    await row(page).getByLabel("Project name").fill(`${original} stale`);
    await row(page).getByLabel("Project name").press("Enter");
    await expect(row(page).getByTestId("rename-error")).toContainText("renamed after you opened the editor", { timeout: 60_000 });
    await expect(row(page).getByTestId("rename-stored")).toHaveText(`Stored now: ${original} newer`);
    await expect(row(page).getByLabel("Project name")).toHaveValue(`${original} stale`);
    expect(await storedName()).toBe(`${original} newer`);
    if (SHOT) await page.screenshot({ path: SHOT.replace(".png", "-rename-conflict.png") });
    await row(page).getByRole("button", { name: "Replace with mine" }).click();
    await expect.poll(storedName).toBe(`${original} stale`);

    // 2. Output set labels.
    const setId = (await db.query("insert into output_sets (tenant_id, run_id, name, wave_label) values ($1,$2,'Model outputs','2024') returning id", [target.tenantId, run.id])).rows[0].id;
    await db.query(
      "insert into documents (tenant_id, run_id, kind, source_filename, storage_path, output_set_id, output_path) values ($1,$2,'output','coefficients.csv',$3,$4,'coefficients.csv')",
      [target.tenantId, run.id, `${target.tenantId}/${run.id}/coefficients.csv`, setId],
    );
    const storedWave = async () => (await db.query("select wave_label from output_sets where id = $1", [setId])).rows[0].wave_label;
    const openSet = async (p) => {
      await p.goto(run.url, { waitUntil: "networkidle" });
      await p.getByRole("button", { name: /^Import data/ }).first().click();
      await p.getByRole("button", { name: "Select Model outputs" }).first().click();
      await p.getByRole("tab", { name: "Overview" }).first().click();
      return p.getByLabel("Wave or study label");
    };
    const waveA = await openSet(page);
    const waveB = await openSet(other);
    await waveB.fill("2025");
    await waveB.blur();
    await expect.poll(storedWave).toBe("2025");
    await waveA.fill("2023");
    await waveA.blur();
    await expect(page.getByTestId("output-set-conflict")).toContainText("changed after you opened it", { timeout: 60_000 });
    await expect(page.getByTestId("output-set-stored")).toHaveText("Stored now: Model outputs, wave 2025");
    expect(await storedWave()).toBe("2025");
    await page.getByRole("button", { name: "Use current values" }).click();
    await expect(waveA).toHaveValue("2025");
    if (SHOT) await page.screenshot({ path: SHOT.replace(".png", "-set-conflict.png") });

    // 3. B23-F01: a wave label longer than its limit is held to 60 characters, and the next edit from
    //    the same card is saved, not refused as a conflict with itself.
    await waveA.fill("W".repeat(61));
    await expect(waveA).toHaveValue("W".repeat(60));
    await waveA.blur();
    await expect.poll(storedWave).toBe("W".repeat(60));
    const nameA = page.getByLabel("Set name");
    await nameA.fill("Model outputs renamed");
    await nameA.blur();
    await expect.poll(async () => (await db.query("select name from output_sets where id = $1", [setId])).rows[0].name).toBe("Model outputs renamed");
    await expect(page.getByTestId("output-set-conflict")).toHaveCount(0);
    await other.close();
  } finally {
    await db.end();
  }
});
