// Technical documents (Grant, 2026-10-24; migration 0112) on the Import screen. Real browser on the
// disposable stack with a small synthetic text file. No model calls (the text is read on upload).
//   1. "Technical document" is offered in Add files and suggested from a technical file's name.
//   2. The file is listed as a Technical document, read, with its text in the preview and a line
//      saying the Research assistant reads it and that it is not checked against the data.
//   3. The Type filter keeps it under Technical document; the project totals count it.
import { expect, test } from "@playwright/test";
import { openAddFiles } from "./helpers/addFiles.mjs";
import { openSource } from "./helpers/sources.mjs";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
if (target.disposable !== true) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
const SHOT = process.env.SHOT;

test.use({ viewport: { width: 1600, height: 1000 } });

test("a technical document is added, read, previewed and described as reading material for the Research assistant", async ({ page }) => {
  test.setTimeout(5 * 60_000);
  await page.goto(target.appUrl, { waitUntil: "networkidle" });
  await page.locator('a[href="/?entry=generate"]').click();
  await page.getByLabel("Project name").fill(`Technical document ${Date.now()}`);
  await page.getByRole("button", { name: "Create project", exact: true }).click();
  await page.waitForURL(/\/runs\/[0-9a-f-]{36}/);

  const dir = mkdtempSync(path.join(tmpdir(), "technical-document-"));
  const NAME = "Synthetic Survey Technical Report.txt";
  const TEXT = "Synthetic survey technical report.\n\nSampling: a stratified two-stage design with enumeration areas as clusters.\n\nWeighting: benchmark weights to mid-year estimates.";
  writeFileSync(path.join(dir, NAME), TEXT);

  await page.getByRole("button", { name: /^Import data/ }).first().click();
  const panel = await openAddFiles(page);
  await panel.getByTestId("add-files-input").setInputFiles(path.join(dir, NAME));
  const typeSelect = panel.getByTestId("add-files-row").first().getByRole("combobox");
  // Suggested from the name, ahead of the report rule.
  await expect(typeSelect.locator("option:checked")).toHaveText("Technical document");
  await panel.getByRole("button", { name: /^Upload/ }).click();
  await expect(panel).toBeHidden({ timeout: 2 * 60_000 });

  await openSource(page, NAME, "Preview");
  const selected = page.getByTestId("selected-source");
  await expect(selected).toContainText("Technical document");
  await expect(selected.getByTestId("source-processing")).toHaveText("Processing: Read");
  await expect(page.getByTestId("file-purpose-text")).toContainText("The Research assistant reads and quotes it");
  await expect(page.getByTestId("file-purpose-text")).toContainText("not checked against the data");
  await expect(page.getByText("Sampling: a stratified two-stage design with enumeration areas as clusters.")).toBeVisible();
  await expect(page.getByTestId("project-totals")).toContainText("1 technical document(s)");
  if (SHOT) await page.screenshot({ path: SHOT.replace(".png", "-technical.png") });

  // The type filter has it.
  const typeFilter = page.getByRole("combobox").filter({ has: page.locator("option", { hasText: "All types" }) }).first();
  await typeFilter.selectOption({ label: "Technical document" });
  await expect(page.getByRole("button", { name: `Select ${NAME}`, exact: true })).toBeVisible();
});
