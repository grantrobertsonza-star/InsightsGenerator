// Coding keeps each transcript's work when another transcript is chosen (Codex IR-07, 2026-10-20), in a
// real browser on the disposable stack:
//   1. A transcript whose coding the server reports as running shows "Coding..." with its button
//      disabled, after a reload too; the other transcript is unaffected.
//   2. Switching away and back keeps that running state, and keeps a coding file chosen but not yet
//      sent ("Already coded? Import your coding").
//   3. When the server stops reporting the run, the button is enabled again.
// The server's progress is stubbed at the /coding-progress route (the boundary the page polls), so
// the check does not depend on how long a replayed model takes; the server-side refusal of a second
// run is covered by codingRunClaim.test.ts.
import { expect, test } from "@playwright/test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { addFiles } from "./helpers/addFiles.mjs";
import { openSource } from "./helpers/sources.mjs";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
if (target.disposable !== true) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);

test.use({ viewport: { width: 1440, height: 900 } });

test("Coding: a running transcript stays running and an unsent file stays chosen across switches", async ({ page }, testInfo) => {
  test.setTimeout(8 * 60_000);
  const db = new pg.Client({ connectionString: target.databaseUrlWithoutCredentials.replace("postgres://", "postgres://postgres@") });
  await db.connect();
  try {
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const run = await ui.createRun({ name: `coding-switch-${Date.now()}` });
    const dir = mkdtempSync(path.join(tmpdir(), "coding-switch-"));
    const files = ["switch-a.txt", "switch-b.txt"].map((name, i) => {
      const file = path.join(dir, name);
      writeFileSync(
        file,
        [
          "Interviewer: How do you usually pay for airtime?",
          `Respondent: ${i === 0 ? "Mostly cash at the spaza shop." : "The banking app when I have data."}`,
          "Interviewer: What stops you using the app more?",
          "Respondent: Data costs, and I worry about making a mistake with the money.",
        ].join("\n"),
      );
      return file;
    });
    await page.getByRole("button", { name: /^Import data/ }).first().click();
    await addFiles(page, files, "Qual data");
    const status = page.getByTestId("selected-source").getByTestId("source-acceptance");
    for (const name of ["switch-a.txt", "switch-b.txt"]) {
      await openSource(page, name, "Setup");
      await expect(status).toHaveText("Setup: Accepted", { timeout: 3 * 60_000 });
    }
    const docId = async (name) => (await db.query("select id from documents where run_id=$1 and source_filename=$2", [run.id, name])).rows[0].id;
    const runningId = await docId("switch-a.txt");

    // The server reports switch-a.txt as being coded.
    let running = true;
    await page.route(`**/api/runs/${run.id}/coding-progress`, (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          progress: running ? [{ documentId: runningId, label: "Coding", done: 1, total: 4, updatedAt: Date.now(), estimatedRemainingMs: null }] : [],
        }),
      }),
    );
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^Coding/ }).first().click();
    const coding = page.getByTestId("coding-section").filter({ visible: true });
    const chooser = coding.getByRole("combobox", { name: "Transcript" });
    const pick = async (name) => chooser.selectOption(await chooser.locator("option", { hasText: name }).getAttribute("value"));
    const visibleCodeButton = () => coding.locator("button[type=submit]:visible", { hasText: /Code themes|Coding\.\.\./ }).first();

    // 1. Running after a reload; the other transcript is free.
    await pick("switch-a.txt");
    await expect(visibleCodeButton()).toHaveText(/Coding\.\.\./, { timeout: 30_000 });
    await expect(visibleCodeButton()).toBeDisabled();
    await expect(coding.getByRole("progressbar").filter({ visible: true })).toHaveCount(1);
    const fileInput = coding.locator("input[name=codingFile]:visible").first();
    await coding.getByText("Already coded? Import your coding").filter({ visible: true }).first().click();
    const codingFile = path.join(dir, "my-coding.csv");
    writeFileSync(codingFile, "Theme,Quote\nCost,Data costs\n");
    await fileInput.setInputFiles(codingFile);
    await pick("switch-b.txt");
    await expect(visibleCodeButton()).toHaveText(/Code themes/);
    await expect(visibleCodeButton()).toBeEnabled();

    // 2. Back to switch-a.txt: still running, and the chosen file is still there.
    await pick("switch-a.txt");
    await expect(visibleCodeButton()).toHaveText(/Coding\.\.\./);
    await expect(visibleCodeButton()).toBeDisabled();
    expect(await coding.locator("input[name=codingFile]:visible").first().evaluate((el) => el.files?.[0]?.name ?? null)).toBe("my-coding.csv");

    // 3. The run ends on the server: the button is enabled again.
    running = false;
    await expect(visibleCodeButton()).toHaveText(/Code themes/, { timeout: 30_000 });
    await expect(visibleCodeButton()).toBeEnabled();
  } finally {
    await db.end();
  }
});
