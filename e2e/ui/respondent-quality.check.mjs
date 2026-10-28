// Respondent checks on the Import screen's Data quality tab (Grant, 26 October 2026), in a real browser
// on the disposable stack, with the designed file of respondentQuality.db.test.ts (40 respondents, every
// flag known by construction): the Respondents panel loads when the tab is opened and shows 9
// respondents flagged, 6 for straightlining, 2 speeders, the three batteries, interviewer B to check,
// and the respondents to look at; it says nothing is excluded.
import { expect, test } from "@playwright/test";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
if (target.disposable !== true) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
const SHOT = process.env.SHOT;
const SCRIPT = String.raw`
import sys, pandas as pd, pyreadstat
n = 40
cols = {"ID": [float(i + 1) for i in range(n)]}
def battery(stem, items, points, straight):
    for j in range(items):
        cols[f"{stem}_{j + 1}"] = [float(3 if i + 1 in straight else ((i + j) % points) + 1) for i in range(n)]
# Cases 1-5 give one answer throughout all three batteries; case 6 only in Q1 (one battery: not
# flagged); case 7 in Q1 and Q2 but not Q3 (two of three: flagged).
battery("Q1", 6, 5, {1, 2, 3, 4, 5, 6, 7})
battery("Q2", 6, 5, {1, 2, 3, 4, 5, 7})
battery("Q3", 5, 4, {1, 2, 3, 4, 5})
# A 0/1 list and numbered questions without a separator: neither is a battery.
for j in range(6):
    cols[f"M_{j + 1}"] = [1.0] * n
for k in range(10, 16):
    cols[f"F{k}"] = [2.0] * n
# Twelve yes/no questions with "Don't know" (99): case 11 answers 99 to 8 of 12 (flagged), case 12 to 5.
for j in range(12):
    cols[f"S{j + 1}"] = [99.0 if (i + 1 == 11 and j < 8) or (i + 1 == 12 and j < 5) else float(1 + (i + j) % 2) for i in range(n)]
# Interview length: median 600; case 8 under half (speeder), case 9 under 30% (super-speeder), case 10
# over three times (long, noted only).
cols["duration"] = [250.0 if i + 1 == 8 else 150.0 if i + 1 == 9 else 2000.0 if i + 1 == 10 else 600.0 for i in range(n)]
# Interviewer B has cases 1-20 (all six straightliners); A has 21-40.
cols["interviewer_id"] = ["B" if i < 20 else "A" for i in range(n)]
labels = {f"S{j + 1}": {1.0: "Yes", 2.0: "No", 99.0: "Don't know"} for j in range(12)}
pyreadstat.write_sav(pd.DataFrame(cols), sys.argv[1], variable_value_labels=labels)
`;

test.use({ viewport: { width: 1440, height: 1100 } });

test("the Data quality tab checks every respondent and lists who to look at", async ({ page }, testInfo) => {
  test.setTimeout(6 * 60_000);
  const dir = mkdtempSync(path.join(tmpdir(), "respondent-quality-"));
  const file = path.join(dir, "designed.sav");
  execFileSync("python3", ["-I", "-c", SCRIPT, file]);
  const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
  const ui = await bind({ page, target, testInfo });
  const run = await ui.createRun({ name: `respondents-${Date.now()}` });
  await ui.upload(run, file, "table");
  await ui.expectReadyOrActionableRecovery();
  await page.getByRole("tab", { name: "Respondents", exact: true }).click();
  const panel = page.getByTestId("respondent-quality").filter({ visible: true });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Nothing is excluded");
  await expect(panel.getByText("Respondents flagged (22.5% of 40)")).toBeVisible({ timeout: 90_000 });
  await expect(panel.getByTestId("rq-straightlining")).toContainText("Q1");
  await expect(panel.getByTestId("rq-straightlining")).toContainText("Q3");
  await expect(panel.getByTestId("rq-straightlining")).not.toContainText("M_");
  await expect(panel.getByTestId("rq-speeders")).toContainText("From duration, median 600: 2 respondents");
  await expect(panel.getByTestId("rq-interviewers")).toContainText("more straightlining than other interviewers");
  await panel.getByTestId("rq-cases").locator("summary").click();
  await expect(panel.getByTestId("rq-cases").locator("li")).toHaveCount(9);
  await expect(panel.getByTestId("rq-cases")).toContainText("ID 9: super-speeder");
  if (SHOT) await panel.screenshot({ path: SHOT.replace(".png", "-respondents.png") });
});
