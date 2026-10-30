// Codex E1R-F01 in a real browser on the disposable stack: Read again on a codebook whose answer list changed checks
// its withdrawn automatic confirmations again on every wave. When one wave's check cannot run, the card names that
// wave and its error, gives the other wave's result and says how to retry; it never says the links were checked
// against every wave. Matching again once the cause is gone confirms the wave. The failure is injected with a trigger
// that exists only in this stack's disposable database, refusing link writes for one wave, and is dropped afterwards.
import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { addFiles } from "./helpers/addFiles.mjs";
import { selectSource } from "./helpers/sources.mjs";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
if (target.disposable !== true) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
const SHOT = process.env.SHOT;
// The stack's database as its local admin (the stack is built from E2E_ADMIN_DATABASE_URL on localhost; the manifest
// names the database without credentials). Only this disposable database is touched.
const adminUrl = (() => {
  const u = new URL(target.databaseUrlWithoutCredentials);
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(u.hostname)) throw new Error("not a local disposable database");
  const admin = new URL(process.env.E2E_ADMIN_DATABASE_URL ?? process.env.TEST_DATABASE_URL ?? "postgres://postgres@localhost:55432/postgres");
  admin.pathname = u.pathname;
  return admin.toString();
})();
const storageBase = new URL(target.storageInventoryUrl).origin;
const codebook = (brand) => `Variable,Label,Values\nbrand,Which brand is your first choice?,"${brand}"\nregion,Region,"1=North, 2=South, 3=East"\n`;

test.use({ viewport: { width: 1400, height: 1000 } });

test("a wave whose re-check failed is named on the codebook card, with the other wave's result and how to retry", async ({ page }, testInfo) => {
  test.setTimeout(8 * 60_000);
  const dir = mkdtempSync(path.join(tmpdir(), "recheck-"));
  writeFileSync(path.join(dir, "wave1.csv"), "brand,region\n1,1\n8,2\n10,3\n");
  writeFileSync(path.join(dir, "wave3.csv"), "brand,region\n1,1\n8,2\n");
  writeFileSync(path.join(dir, "codebook.csv"), codebook("1=Toyota, 8=BMW, 10=Haval"));
  const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
  const ui = await bind({ page, target, testInfo });
  const run = await ui.createRun({ name: `recheck-${Date.now()}` });
  await ui.upload(run, path.join(dir, "wave1.csv"), "table");
  await ui.upload(run, path.join(dir, "wave3.csv"), "table");
  await addFiles(page, [path.join(dir, "codebook.csv")], "Codebook");
  await selectSource(page, "codebook.csv");
  const card = page.getByRole("tabpanel", { name: "Codebook links", exact: true });
  await expect(card).toContainText("wave1.csv: 2 confirmed", { timeout: 3 * 60_000 });
  await expect(card).toContainText("wave3.csv: 2 confirmed");

  const db = new pg.Client({ connectionString: adminUrl });
  await db.connect();
  try {
    const docs = (await db.query("select id, source_filename, storage_path from documents where run_id = $1", [run.id])).rows;
    const id = (name) => docs.find((d) => d.source_filename === name).id;
    // A revised codebook under a new storage key (the engine keeps its local copy per key), as a re-upload stores it.
    const cb = docs.find((d) => d.source_filename === "codebook.csv");
    const key = cb.storage_path.replace(/[^/]+$/, `${randomUUID()}-codebook.csv`);
    const put = await fetch(`${storageBase}/storage/v1/object/documents/${key}`, { method: "POST", headers: { "content-type": "text/csv" }, body: codebook("1=Toyota, 8=BMW, 10=Haval, 12=Kia") });
    expect(put.ok).toBe(true);
    await db.query("update documents set storage_path = $2 where id = $1", [cb.id, key]);
    await db.query(`create function e2e_refuse_recheck() returns trigger language plpgsql as $$ begin if NEW.data_document_id = '${id("wave1.csv")}'::uuid then raise exception 'wave check unavailable (test)'; end if; return NEW; end $$`);
    await db.query("create trigger e2e_refuse_recheck before insert on instrument_links for each row execute function e2e_refuse_recheck()");
    try {
      await card.getByRole("button", { name: "Read again", exact: true }).click();
      const note = card.getByTestId("instrument-message");
      await expect(note).toContainText("could not be checked again on every wave", { timeout: 3 * 60_000 });
      await expect(note).toContainText("Not checked: wave1.csv (");
      await expect(note).toContainText("wave check unavailable (test)");
      await expect(note).toContainText("Checked again on wave3.csv: 1 still fits and is confirmed.");
      await expect(note).toContainText("To retry, choose that wave under Data file and press Match again.");
      await expect(note).not.toContainText("against every wave they were on");
      await expect(card.getByRole("button", { name: "Read again", exact: true })).toBeEnabled({ timeout: 60_000 });
      await card.screenshot({ path: SHOT ?? testInfo.outputPath("codebook-recheck-failed.png") });
      const brand = async (name) => (await db.query("select l.status, l.decided_by from instrument_links l join instrument_items i on i.id = l.item_id where i.document_id = $1 and i.code = 'brand' and l.data_document_id = $2", [cb.id, id(name)])).rows[0];
      expect(await brand("wave1.csv")).toMatchObject({ status: "suggested" });
      expect(await brand("wave3.csv")).toMatchObject({ status: "confirmed", decided_by: "automatic" });
    } finally {
      await db.query("drop trigger if exists e2e_refuse_recheck on instrument_links");
      await db.query("drop function if exists e2e_refuse_recheck()");
    }
    // Recovery: as the card asks, choose the wave and match again (the same codes rule confirms it automatically).
    await card.getByRole("combobox", { name: "Data file" }).selectOption({ label: "wave1.csv (linked)" });
    await card.getByRole("button", { name: "Match again", exact: true }).click();
    // The card can show the background match's earlier note while this match runs, so the stored link is what is
    // waited for.
    const brandOnWave1 = async () => (await db.query("select l.status, l.decided_by from instrument_links l join instrument_items i on i.id = l.item_id where i.document_id = $1 and i.code = 'brand' and l.data_document_id = $2", [cb.id, id("wave1.csv")])).rows[0];
    await expect.poll(brandOnWave1, { timeout: 3 * 60_000 }).toMatchObject({ status: "confirmed", decided_by: "automatic" });
    await expect(card.getByRole("button", { name: "Match again", exact: true })).toBeEnabled({ timeout: 60_000 });
    await expect(card.getByTestId("instrument-message")).toContainText("1 confirmed automatically");
  } finally {
    await db.end();
  }
});
