// A transcript's setup on the Import screen (Grant, 2026-10-19: "should the qual tile not have the
// same structure as the quant, with a wave option" and "they don't all have unaccept buttons"; in
// the selected source's Setup tab from 2026-10-20).
// Real browser on the disposable stack, with a small text transcript written here.
//   1. A new transcript is accepted on import, and is listed and described as qualitative data.
//   2. A wave typed into its Setup tab is saved, survives a reload, and shows in Coding.
//   3. Undo accept puts it back to "Not accepted", and it stays so after a reload: the card does
//      not accept a withdrawn transcript again by itself. Coding holds it back meanwhile.
//   4. Accept transcript accepts it again, with the wave kept.
//   5. The Data quality tab's count is the number of its checks flagged Check or Problem.
import { expect, test } from "@playwright/test";
import { addFiles } from "./helpers/addFiles.mjs";
import { openSource, openSourceTab } from "./helpers/sources.mjs";
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
  await addFiles(page, file, "Qual data");

  const NAME = "interview-wave-check.txt";
  const reopen = async () => {
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^Import data/ }).first().click();
    return openSource(page, NAME, "Setup");
  };
  const status = page.getByTestId("selected-source").getByTestId("source-acceptance");
  // 1. Accepted on import, listed and described as qualitative data.
  let setup = await openSource(page, NAME, "Setup");
  await expect(status).toHaveText("Setup: Accepted", { timeout: 3 * 60_000 });
  await expect(page.getByTestId("selected-source")).toContainText("Qualitative data");
  await expect(page.getByTestId("file-purpose-text")).toHaveText("Transcript. Code it under Coding once its setup is accepted.");

  // 2. The wave.
  const wave = setup.getByLabel(`Wave: ${NAME}`);
  await wave.fill("Wave 1");
  await wave.blur();
  await expect(status).toHaveText("Setup: Accepted", { timeout: 30_000 });
  await expect(page.getByTestId("selected-source")).toContainText("Wave: Wave 1");
  setup = await reopen();
  await expect(setup.getByLabel(`Wave: ${NAME}`)).toHaveValue("Wave 1", { timeout: 60_000 });
  await page.getByRole("button", { name: /^Coding/ }).first().click();
  await expect(page.getByTestId("coding-wave").filter({ hasText: "Wave: Wave 1" })).toBeVisible({ timeout: 60_000 });

  // 3. Undo accept, held after a reload.
  await page.getByRole("button", { name: /^Import data/ }).first().click();
  setup = await openSource(page, NAME, "Setup");
  await setup.getByRole("button", { name: "Undo accept" }).click();
  await expect(setup).toContainText("Not accepted: Coding skips this transcript.", { timeout: 30_000 });
  setup = await reopen();
  await expect(setup).toContainText("Not accepted: Coding skips this transcript.", { timeout: 60_000 });
  await page.waitForTimeout(2000); // the automatic acceptance would have run by now
  await expect(status).toHaveText("Setup: Needs review");
  await expect(page.getByTestId("source-row").filter({ hasText: NAME }).getByTestId("source-row-acceptance")).toHaveText("Needs review");
  await expect(setup.getByRole("button", { name: "Accept transcript" })).toBeVisible();

  // 4. Accept again, wave kept.
  await setup.getByRole("button", { name: "Accept transcript" }).click();
  await expect(status).toHaveText("Setup: Accepted", { timeout: 30_000 });
  setup = await reopen();
  await expect(status).toHaveText("Setup: Accepted", { timeout: 60_000 });
  await expect(setup.getByLabel(`Wave: ${NAME}`)).toHaveValue("Wave 1");

  // 5. The count beside Data quality matches the checks flagged inside it (none: no count).
  const quality = await openSourceTab(page, "Data quality");
  const flagged = await quality.locator("tr", { has: page.locator("span", { hasText: /^(Check|Problem)$/ }) }).count();
  const count = page.getByRole("tab", { name: "Data quality", exact: true }).getByTestId("source-tab-count");
  if (flagged === 0) await expect(count).toHaveCount(0);
  else await expect(count).toHaveText(String(flagged));
});
