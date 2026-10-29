// Grant, 29 October 2026: saving a 60 MB data file "seems to take quite long" with nothing shown. The Add files
// dialog now shows progress per request: what is stored of the total, the file being sent and saved now, and the
// time taken. Real browser, server and storage stand-in on the disposable stack. Two 60 MB CSV files go in two
// requests (together they exceed one request's limit), so the bar is seen at the start (nothing stored, the first
// file being sent and saved), half way (the first stored, the second in flight), and gone when both are stored.
import { expect, test } from "@playwright/test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { openAddFiles } from "./helpers/addFiles.mjs";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
if (target.disposable !== true) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);

/**
 * A CSV of about `mb` MB: an id, an answer code that differs per file (`seed`), so two files are never the same file
 * (an identical second upload is recognised and not sent), and a long comment, so 60 MB stays under the 100,000-case
 * read limit and the files are read, not refused, after they are stored.
 */
function csv(mb, seed) {
  const note = "x".repeat(640);
  const row = `1234567,${seed},${note}\n`;
  return "id,q1,comment\n" + row.repeat(Math.ceil((mb * 1_000_000) / row.length));
}

test("a large upload shows what is stored, what is being sent and saved, and the time taken", async ({ page }, testInfo) => {
  test.setTimeout(10 * 60_000);
  const dir = mkdtempSync(path.join(tmpdir(), "upload-progress-"));
  try {
    const files = ["wave1.csv", "wave2.csv"].map((n, i) => {
      const f = path.join(dir, n);
      writeFileSync(f, csv(60, i + 1));
      return f;
    });
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const run = await ui.createRun({ name: `upload-progress-${Date.now()}` });
    await page.goto(`${run.url}?section=upload`, { waitUntil: "networkidle" });
    const panel = await openAddFiles(page);
    await panel.getByTestId("add-files-input").setInputFiles(files);
    const rows = panel.getByTestId("add-files-row");
    await expect(rows).toHaveCount(2);
    for (let i = 0; i < 2; i++) await rows.nth(i).getByRole("combobox").selectOption({ label: "Raw data" });
    await panel.getByRole("button", { name: /^Upload/ }).click();

    const bar = page.getByRole("progressbar", { name: "Upload progress" });
    const note = page.getByTestId("upload-progress");
    await expect(bar).toHaveAttribute("aria-valuenow", "0");
    await expect(note).toContainText("Sending and saving wave1.csv");
    await expect(note).toContainText(/Stored 0 of 12\d\.\d MB\./);
    if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
    await expect(bar).toHaveAttribute("aria-valuenow", "50", { timeout: 4 * 60_000 });
    await expect(note).toContainText("Sending and saving wave2.csv");
    await expect(note).toContainText(/\d+:\d\d/);
    if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT.replace(".png", "-half.png") });
    await expect(panel).toBeHidden({ timeout: 4 * 60_000 });
    await expect(page.getByTestId("add-files-message")).toContainText("Added 2 files");
    await expect(bar).toHaveCount(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
