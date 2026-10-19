// The transcript card on the Import screen (Grant, 2026-10-19: "should the qual tile not have the
// same structure as the quant, with a wave option" and "they don't all have unaccept buttons").
// Real browser on the disposable stack, with a small text transcript written here.
//   1. A new transcript is accepted on import, and its card describes it as qualitative data.
//   2. A wave typed into the card is saved, survives a reload, and shows in Coding.
//   3. Undo accept puts it back to "Not accepted", and it stays so after a reload: the card does
//      not accept a withdrawn transcript again by itself. Coding holds it back meanwhile.
//   4. Accept transcript accepts it again, with the wave kept.
import { expect, test } from "@playwright/test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
if (target.disposable !== true) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);

test.use({ viewport: { width: 1600, height: 1000 } });

test("a transcript card takes a wave, can be un-accepted and accepted again, and keeps that over reloads", async ({ page }, testInfo) => {
  test.setTimeout(6 * 60_000);
  const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
  const ui = await bind({ page, target, testInfo });
  const run = await ui.createRun({ name: `transcript-card-${Date.now()}` });
  const dir = mkdtempSync(path.join(tmpdir(), "transcript-card-"));
  const file = path.join(dir, "interview-wave-check.txt");
  writeFileSync(
    file,
    [
      "Interviewer: How do you usually pay for airtime?",
      "Respondent: Mostly cash at the spaza shop, sometimes the banking app when I have data.",
      "Interviewer: What stops you using the app more?",
      "Respondent: Data costs, and I worry about making a mistake with the money.",
    ].join("\n"),
  );
  await page.getByRole("button", { name: /^Import data/ }).first().click();
  const form = page.locator("form", { has: page.locator('input[name="transcriptFiles"]') });
  await form.locator('input[name="transcriptFiles"]').setInputFiles(file);
  await form.getByRole("button", { name: "Upload", exact: true }).click();

  const card = () => page.locator("div.cursor-pointer.rounded-xl", { hasText: "interview-wave-check.txt" }).first();
  // 1. Accepted on import, described as qualitative data.
  await expect(card().getByText("Accepted", { exact: true })).toBeVisible({ timeout: 3 * 60_000 });
  await expect(card()).toContainText("Qualitative data. Themes are coded in Analysis, Coding once you accept it here.");

  // 2. The wave.
  const wave = card().getByLabel("Wave: interview-wave-check.txt");
  await wave.fill("Wave 1");
  await wave.blur();
  await expect(card().getByText("Saving...")).toHaveCount(0, { timeout: 30_000 });
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /^Import data/ }).first().click();
  await expect(card().getByLabel("Wave: interview-wave-check.txt")).toHaveValue("Wave 1", { timeout: 60_000 });
  await page.getByRole("button", { name: /^Coding/ }).first().click();
  await expect(page.getByTestId("coding-wave").filter({ hasText: "Wave: Wave 1" })).toBeVisible({ timeout: 60_000 });

  // 3. Undo accept, held after a reload.
  await page.getByRole("button", { name: /^Import data/ }).first().click();
  await card().getByRole("button", { name: "Undo accept" }).click();
  await expect(card()).toContainText("Not accepted: Coding skips this transcript.", { timeout: 30_000 });
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /^Import data/ }).first().click();
  await expect(card()).toContainText("Not accepted: Coding skips this transcript.", { timeout: 60_000 });
  await page.waitForTimeout(2000); // the automatic acceptance would have run by now
  await expect(card().getByText("Needs review", { exact: true })).toBeVisible();
  await expect(card().getByRole("button", { name: "Accept transcript" })).toBeVisible();

  // 4. Accept again, wave kept.
  await card().getByRole("button", { name: "Accept transcript" }).click();
  await expect(card().getByText("Accepted", { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /^Import data/ }).first().click();
  await expect(card().getByText("Accepted", { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(card().getByLabel("Wave: interview-wave-check.txt")).toHaveValue("Wave 1");
});
