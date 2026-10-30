// UI-R1000-01 (Codex, 2026-10-22): a new NPS result was shown with "Post to findings" while its
// posted-state read was still running, even when the result was already in findings. In a real
// browser on the disposable stack, with only the posted-state request held at the browser (the
// server action whose arguments are run, file and question; the calculation itself is not held):
//   1. Unposted: while the read is held the result shows "Checking", with no Post and no Remove;
//      released, it offers Post. Posting gives Remove.
//   2. Posted (Codex's repro): calculating the same question again, while the read is held there is
//      again no Post and no Remove; released, it offers Remove, and the one finding is unchanged.
//   3. Clear while the read is held: the late answer does not bring a control back.
// Synthetic data only.
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

test("an NPS result offers neither Post nor Remove until its posted state is known", async ({ page }, testInfo) => {
  test.setTimeout(8 * 60_000);
  const db = new pg.Client({ connectionString: target.databaseUrlWithoutCredentials.replace("postgres://", "postgres://postgres@") });
  await db.connect();
  try {
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const run = await ui.createRun({ name: `nps-pending-${Date.now()}` });
    const dir = mkdtempSync(path.join(tmpdir(), "nps-pending-"));
    const rows = ["id,REC"];
    for (let i = 1; i <= 120; i++) rows.push(`${i},${i % 11}`);
    const file = path.join(dir, "nps-pending.csv");
    writeFileSync(file, rows.join("\n") + "\n");
    await ui.upload(run, file, "table");

    // Holds the posted-state read: the server-action POST whose arguments are exactly
    // [run, file, question]. The calculation's arguments are longer, so it is never held.
    let held = [];
    let holding = false;
    await page.route(`**/runs/${run.id}**`, async (route) => {
      const req = route.request();
      if (holding && req.method() === "POST" && req.headers()["next-action"]) {
        let args = null;
        try {
          args = JSON.parse(req.postData() ?? "");
        } catch {
          args = null;
        }
        if (Array.isArray(args) && args.length === 3 && args[0] === run.id && args[2] === "REC") {
          await new Promise((resolve) => held.push(resolve));
        }
      }
      await route.continue();
    });
    const release = async () => {
      holding = false;
      const waiting = held;
      held = [];
      for (const r of waiting) r();
    };

    const section = () => page.getByTestId("analytics-section").filter({ visible: true });
    await page.goto(run.url, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^Analytics/ }).first().click();
    await expect(section().getByRole("list", { name: "Analyses" })).toBeVisible({ timeout: 60_000 });
    await section().getByTestId("analytics-file-select").selectOption({ label: "nps-pending.csv" });
    await section().getByRole("list", { name: "Analyses" }).getByRole("button", { name: /^Net Promoter Score/ }).click({ timeout: 60_000 });
    const ws = page.getByRole("dialog", { name: "Analytics workspace" });
    await expect(ws).toBeVisible();
    await ws.getByLabel("NPS question").selectOption("REC");
    const post = () => ws.getByRole("button", { name: "Post to findings" });
    const remove = () => ws.getByRole("button", { name: "Remove from findings" });
    const findings = async () => (await db.query("select id, finding_text, status from findings where run_id=$1 and status<>'rejected'", [run.id])).rows;

    const calculateHeld = async () => {
      holding = true;
      await ws.getByRole("button", { name: "Calculate NPS" }).click();
      await expect.poll(() => held.length, { timeout: 60_000 }).toBeGreaterThan(0);
      await expect(ws.getByTestId("nps-post-checking")).toBeVisible();
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      await expect(post()).toHaveCount(0);
      await expect(remove()).toHaveCount(0);
    };

    // 1. Unposted.
    await calculateHeld();
    await release();
    await expect(post()).toBeVisible({ timeout: 60_000 });
    await expect(ws.getByTestId("nps-post-checking")).toHaveCount(0);
    await post().click();
    await expect(remove()).toBeVisible({ timeout: 60_000 });
    await expect.poll(async () => (await findings()).length).toBe(1);
    const before = await findings();

    // 2. Posted: the same question again.
    await calculateHeld();
    await release();
    await expect(remove()).toBeVisible({ timeout: 60_000 });
    await expect(post()).toHaveCount(0);
    expect(await findings()).toEqual(before);

    // 3. Clear while held: the late answer brings no control back.
    await calculateHeld();
    await ws.getByTestId("nps-clear").click();
    await release();
    await page.waitForTimeout(1500);
    await expect(post()).toHaveCount(0);
    await expect(remove()).toHaveCount(0);
    await expect(ws.getByTestId("nps-post-checking")).toHaveCount(0);
    expect(await findings()).toEqual(before);
  } finally {
    await db.end();
  }
});
