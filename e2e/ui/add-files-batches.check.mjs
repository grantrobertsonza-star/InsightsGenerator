// Files chosen together over 100 MB (Grant, 28 October 2026: a new project's upload failed the page with "This part
// of the project could not be shown"; the server log said "Request body exceeded 100MB ... Unexpected end of
// form"). Every file was within the 100,000,000-byte limit, but all went in one request, which the sign-in proxy
// cut off at 100 MiB. Real browser, server and database on the disposable stack; synthetic CSV fixtures.
//   1. Two 60 MB data files chosen together are both added (two requests); the page keeps working; both are
//      listed after a reload.
//   2. A file one byte over the limit chosen with a small one: the small one is added, the large one is named
//      with the limit message and never sent.
import { expect, test } from "@playwright/test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { addFiles } from "./helpers/addFiles.mjs";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
if (target.disposable !== true) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
const limits = JSON.parse(readFileSync(path.resolve("api/import-limits.json"), "utf8"));

/** A CSV of exactly `bytes` bytes: 50 rows, padding in a text column so the file reads quickly. `seed` makes
 * the rows differ between files: the project refuses a second copy of identical bytes (IMP-008). */
function csv(file, bytes, seed = 0) {
  const body = Array.from({ length: 50 }, (_, i) => `${i + 1},${1 + ((i + seed) % 2)},x${seed}`).join("\n") + "\n";
  const header = "id,q,note" + " ".repeat(bytes - body.length - 10) + "\n";
  const b = Buffer.from(header + body);
  if (b.length !== bytes) throw new Error(`fixture is ${b.length} bytes, wanted ${bytes}`);
  writeFileSync(file, b);
  return file;
}

test.use({ viewport: { width: 1600, height: 1000 } });

test("files chosen together over 100 MB are sent in batches and all added; one over the limit is named and not sent", async ({ page }, testInfo) => {
  test.setTimeout(10 * 60_000);
  const dir = mkdtempSync(path.join(tmpdir(), "batches-"));
  try {
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const run = await ui.createRun({ name: `batches-${Date.now()}` });
    await page.goto(`${run.url}?section=upload`, { waitUntil: "networkidle" });

    // 1. 120 MB together, each within the limit.
    const a = csv(path.join(dir, "wave-a.csv"), 60_000_000);
    const b = csv(path.join(dir, "wave-b.csv"), 60_000_000, 1);
    await addFiles(page, [a, b], "Raw data");
    await expect(page.getByTestId("add-files-error")).toHaveCount(0);
    await expect(page.getByTestId("add-files-message")).toContainText("Added 2 files: wave-a.csv, wave-b.csv");
    await expect(page.getByText("This part of the project could not be shown")).toHaveCount(0);
    await page.reload({ waitUntil: "networkidle" });
    for (const name of ["wave-a.csv", "wave-b.csv"]) await expect(page.getByRole("button", { name: `Select ${name}`, exact: true })).toBeVisible({ timeout: 60_000 });

    // 2. One byte over the limit, with a small file.
    const over = csv(path.join(dir, "too-big.csv"), limits.maxFileBytes + 1);
    const small = csv(path.join(dir, "small.csv"), 2_000);
    await addFiles(page, [over, small], "Raw data");
    await expect(page.getByTestId("add-files-error")).toContainText(`too-big.csv: This file exceeds the supported ${Math.round(limits.maxFileBytes / 1e6)} MB limit`);
    await expect(page.getByTestId("add-files-message")).toContainText("Added 1 file: small.csv");
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.getByRole("button", { name: "Select small.csv", exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("button", { name: "Select too-big.csv", exact: true })).toHaveCount(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
