// A data file set up on first view (DataSetupForm accepts the defaults when it is first opened). Seen in the full
// browser suite on 28 October 2026 (waves-in-project, under load): a wave label typed while that first-view save
// was on its way disappeared. The save's success set the defaults over the edit, and the edit's own save then
// conflicted with it. Real browser, server and database on the disposable stack; server replies are held and
// released in order so the slow first-view save is reproduced every time, not only under load.
//   1. While the first-view save is on its way, the setup fields cannot be edited.
//   2. Once it is saved, a wave typed in is saved, and is still there after a reload.
import { expect, test } from "@playwright/test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { addFiles } from "./helpers/addFiles.mjs";
import { openSource } from "./helpers/sources.mjs";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
if (target.disposable !== true) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);

test.use({ viewport: { width: 1600, height: 1000 } });

test("setup fields wait for the first-view save, and a wave typed after it is kept", async ({ page }, testInfo) => {
  test.setTimeout(6 * 60_000);
  const dir = mkdtempSync(path.join(tmpdir(), "firstview-"));
  try {
    const file = path.join(dir, "first-view.csv");
    writeFileSync(file, `ID,Region\n${Array.from({ length: 30 }, (_, i) => `${i + 1},${(i % 3) + 1}`).join("\n")}\n`);
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const run = await ui.createRun({ name: `firstview-${Date.now()}` });

    // Every server action reply except the upload itself is held, then released one at a time in the order
    // the requests were made. Installed before the upload: the file's setup form mounts (and starts its
    // first-view save) as soon as the list refreshes after the upload.
    let holding = true;
    const queue = [];
    await page.route(`**/runs/${run.id}**`, async (route) => {
      const req = route.request();
      const multipart = (req.headers()["content-type"] ?? "").includes("multipart/form-data");
      if (req.method() !== "POST" || !req.headers()["next-action"] || multipart || !holding) return route.continue();
      const response = await route.fetch({ timeout: 180_000 });
      queue.push(() => route.fulfill({ response }));
    });

    await page.goto(`${run.url}?section=upload`, { waitUntil: "networkidle" });
    await addFiles(page, [file], "Raw data");
    await page.getByRole("button", { name: /^Import data/ }).first().click();
    const setup = await openSource(page, "first-view.csv", "Setup");
    const wave = setup.getByLabel("Wave: first-view.csv");
    await expect(wave).toBeVisible({ timeout: 60_000 });
    await expect.poll(() => queue.length, { timeout: 60_000 }).toBeGreaterThan(0);
    // 1. The first-view save is held: the fields wait for it.
    await expect(wave).toBeDisabled();
    holding = false;
    while (queue.length > 0) await queue.shift()();
    // 2. Saved: the wave can be typed and is kept.
    await expect(wave).toBeEnabled({ timeout: 60_000 });
    await wave.fill("Wave 4");
    await wave.blur();
    await expect(setup.getByLabel("Fieldwork month: first-view.csv")).toBeVisible({ timeout: 30_000 });
    await page.waitForLoadState("networkidle");
    await expect(setup.getByText("changed elsewhere")).toHaveCount(0);
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^Import data/ }).first().click();
    const again = await openSource(page, "first-view.csv", "Setup");
    await expect(again.getByLabel("Wave: first-view.csv")).toHaveValue("Wave 4", { timeout: 60_000 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
