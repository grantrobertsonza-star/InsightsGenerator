// IMP-017: two uploads at both limits (20,000,000 bytes and 100,000 cases) at the same time, three
// rounds, through the real browser on the disposable stack. Ported from Codex's
// repair7/concurrent-boundary-native-v12.mjs, whose first invocation left one project with no
// document after "Upload of ... failed: fetch failed".
// Each upload must end in one of the two acceptable outcomes:
//   - complete: 100,000 stored rows, and the file is listed after reload; or
//   - failed visibly: the page names the file as failed, no document row, no pending cleanup
//     record, and no object left in the storage stand-in's complete inventory.
// Every outcome, with timing and any error text, is attached to the test result as evidence about
// the original failure's cause. Local stand-in storage and one machine: not hosted capacity.
//
// Run it against a production server (E2E_NEXT_START, see docs/validation.md). Overnight
// 2026-10-16 results on the 8 GB cloud workspace:
//   - next dev: in two of two completed rounds one upload of the pair failed with "fetch failed"
//     (cause EPIPE: the connection to storage closed while the 20 MB body was being written) and
//     the other completed; failures were visible and left nothing behind. The dev server reached
//     about 4 GB and was killed for memory in later rounds, so dev runs end "neither" here.
//   - next start (production build): 3 rounds, 6 of 6 uploads complete in 6-9 s, server peak
//     resident memory about 818 MB, no failures.
// Direct concurrent 20 MB uploads to the stand-in (no app) always succeeded. The IMP-017 v12
// failure therefore looks specific to the dev runtime; hosted storage is not measured.
// CONCURRENT_ROUNDS overrides the number of rounds.
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
const dbUrl = new URL(target.databaseUrlWithoutCredentials);
if (target.disposable !== true || !/^\/ie_e2e_[a-f0-9]{10}$/.test(dbUrl.pathname) || !target.storageInventoryUrl) {
  throw new Error(`${manifestPath} does not describe a disposable stack with the storage inventory; refusing to run.`);
}
const ROUNDS = Number(process.env.CONCURRENT_ROUNDS ?? 3);

test("concurrent exact-limit uploads either complete or fail visibly with nothing left behind", async ({ browser }, testInfo) => {
  test.setTimeout(30 * 60_000);
  const db = new pg.Client({ connectionString: target.databaseUrlWithoutCredentials.replace("postgres://", "postgres://postgres@") });
  await db.connect();
  const buffer = Buffer.from("q" + " ".repeat(20_000_000 - 400_000 - 2) + "\n" + "Yes\n".repeat(100_000));
  expect(buffer.length).toBe(20_000_000);
  const outcomes = [];
  try {
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    for (let round = 1; round <= ROUNDS; round++) {
      const pages = [await browser.newPage(), await browser.newPage()];
      const runs = [];
      for (const page of pages) {
        const ui = await bind({ page, target, testInfo });
        runs.push(await ui.createRun({ name: `concurrent-limit-${round}-${runs.length}-${Date.now()}` }));
        await page.getByRole("button", { name: /^Import data/ }).first().click();
      }
      const started = Date.now();
      await Promise.all(
        pages.map(async (page, i) => {
          const run = runs[i];
          const name = `at-both-limits-${round}-${i}.csv`;
          const form = page.locator("form", { has: page.locator('input[name="rawTableFiles"]') });
          await form.locator('input[name="rawTableFiles"]').setInputFiles({ name, mimeType: "text/csv", buffer });
          await form.getByRole("button", { name: "Upload", exact: true }).click();
          const failedText = page.getByText(new RegExp(`Upload of ${name.replace(/\./g, "\\.")} failed`)).first();
          const rows = async () => (await db.query("select max(jsonb_array_length(dt.rows))::int n from document_tables dt join documents d on d.id=dt.document_id where d.run_id=$1", [run.id])).rows[0].n;
          let outcome = null;
          const deadline = Date.now() + 240_000;
          while (!outcome && Date.now() < deadline) {
            if ((await rows()) === 100_000) outcome = "complete";
            else if (await failedText.isVisible().catch(() => false)) outcome = "failed";
            else await page.waitForTimeout(1_000);
          }
          const record = { round, upload: i, run: run.id, outcome: outcome ?? "neither within 240 s", seconds: Math.round((Date.now() - started) / 1000) };
          if (outcome === "failed") {
            record.error = (await failedText.innerText()).slice(0, 300);
            expect(Number((await db.query("select count(*) from documents where run_id=$1", [run.id])).rows[0].count), `${name}: no document`).toBe(0);
            expect(Number((await db.query("select count(*) from trace where run_id=$1 and event='document_storage_cleanup_pending'", [run.id])).rows[0].count), `${name}: no pending cleanup`).toBe(0);
            const keys = (await (await fetch(target.storageInventoryUrl)).json()).filter((k) => k.includes(`/${run.id}/`));
            expect(keys, `${name}: no stored object`).toEqual([]);
          } else if (outcome === "complete") {
            await page.goto(run.url, { waitUntil: "domcontentloaded", timeout: 60_000 });
            await page.getByRole("button", { name: /^Import data/ }).first().click();
            await expect(page.getByText(name, { exact: true }).first()).toBeVisible({ timeout: 60_000 });
          }
          outcomes.push(record);
          expect(outcome, `${name} ended in neither acceptable outcome`).not.toBeNull();
        }),
      );
      for (const page of pages) await page.close();
    }
  } finally {
    testInfo.annotations.push({ type: "outcomes", description: JSON.stringify(outcomes) });
    console.log("OUTCOMES", JSON.stringify(outcomes));
    await db.end();
  }
});
