// Import step 3, reverse-coded battery items, in a real browser on the disposable stack, with the designed
// file of reverseCoding.db.test.ts (battery Q1_1 to Q1_5 on 1 to 5, Q1_3 worded and answered the other
// way, respondent 2 answering 4 throughout): the Data quality tab suggests Q1_3 on both signs; "Reverse
// this item" saves it, the battery then shows it as reversed with the one contradictory straightliner;
// Cross tabs offers Q1_3_r; Undo takes it back.
import { expect, test } from "@playwright/test";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import pg from "pg";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
if (target.disposable !== true) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
const SHOT = process.env.SHOT;
const SCRIPT = String.raw`
import sys, pandas as pd, pyreadstat
n = 60
cols = {"ID": [float(i + 1) for i in range(n)]}
for j in range(1, 6):
    col = []
    for i in range(n):
        v = min(5, max(1, (i % 5) + 1 + ((i + j) % 3) - 1))
        col.append(float(6 - v if j == 3 else v))
    cols[f"Q1_{j}"] = col
cols["Q1_3"][0] = 9.0
for j in range(1, 6):
    cols[f"Q1_{j}"][1] = 4.0
labels = {f"Q1_{j}": {1.0: "Strongly disagree", 2.0: "Disagree", 3.0: "Neither", 4.0: "Agree", 5.0: "Strongly agree", 9.0: "Don't know"} for j in range(1, 6)}
texts = ["ID", "Brand statements: I trust the brand", "Brand statements: The brand is good value", "Brand statements: I would not recommend the brand",
         "Brand statements: The brand is reliable", "Brand statements: I like the brand"]
pyreadstat.write_sav(pd.DataFrame(cols), sys.argv[1], column_labels=texts, variable_value_labels=labels)
`;

test.use({ viewport: { width: 1440, height: 1100 } });

test("a battery item worded the other way is suggested, reversed into a new variable, and can be undone", async ({ page }, testInfo) => {
  test.setTimeout(6 * 60_000);
  const db = new pg.Client({ connectionString: target.databaseUrlWithoutCredentials.replace("postgres://", "postgres://postgres@") });
  await db.connect();
  try {
    const dir = mkdtempSync(path.join(tmpdir(), "reversed-items-"));
    const file = path.join(dir, "brand-battery.sav");
    execFileSync("python3", ["-I", "-c", SCRIPT, file]);
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const run = await ui.createRun({ name: `reversed-${Date.now()}` });
    await ui.upload(run, file, "table");
    await ui.expectReadyOrActionableRecovery();
    await page.getByRole("tab", { name: "Respondents", exact: true }).click();
    const panel = page.getByTestId("respondent-quality").filter({ visible: true });
    const section = panel.getByTestId("rq-reversed");
    const item = section.locator('li[data-variable="Q1_3"]');
    await expect(item).toBeVisible({ timeout: 90_000 });
    await expect(item).toContainText('worded with "not"');
    await expect(item).toContainText("both signs agree");
    await expect(item).toHaveAttribute("data-reversed", "false");
    await expect(section.locator("li[data-variable]")).toHaveCount(1);

    await item.getByRole("button", { name: "Reverse this item" }).click();
    await expect(item).toHaveAttribute("data-reversed", "true", { timeout: 90_000 });
    await expect(item).toContainText("Reversed");
    await expect(section.getByTestId("rq-reversed-straightliners")).toContainText("1 gave the same answer to items worded in opposite directions");
    const stored = async () => (await db.query("select variable_overrides from documents where run_id = $1 and kind = 'table'", [run.id])).rows[0]?.variable_overrides;
    expect((await stored()).Q1_3.reverse).toMatchObject({ derived: "Q1_3_r", min: 1, max: 5, evidence: { wording: "not", suggested: true } });
    if (SHOT) await section.screenshot({ path: SHOT });

    // Cross tabs: the reversed item takes the original's place in its battery, so the battery's table
    // shows it under its "(reversed)" label; the original column stays in the file, out of the set.
    await page.goto(run.url, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^Cross tabs(\s*\d+)?$/ }).first().click();
    const ws = page.getByTestId("crosstab-workspace").filter({ visible: true });
    await expect(ws.getByPlaceholder("Search name or label")).toBeVisible({ timeout: 60_000 });
    await ws.getByPlaceholder("Search name or label").fill("Q1_3_r");
    await ws.getByRole("button", { name: /^▸ / }).first().click();
    const member = ws.locator('div.grid:has(> span[title="Q1_3_r"])');
    await expect(member).toContainText("(reversed)");
    if (SHOT) await ws.screenshot({ path: SHOT.replace(".png", "-crosstabs.png") });
    // The battery is collapsed after a reload, so the member is picked here rather than through the
    // adapter's buildTable (which reloads first).
    await member.getByRole("button", { name: "Row", exact: true }).click();
    await ws.getByRole("button", { name: "Add table to set", exact: true }).click();
    const table = ws.locator('table[data-testid="crosstab-result-table"][data-question-keys*="Q1_3_r"]').last();
    await expect(table).toContainText("Strongly disagree", { timeout: 90_000 });

    // Undo.
    await page.goto(run.url, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^Import data/ }).first().click();
    await page.getByRole("tab", { name: "Respondents", exact: true }).click();
    const again = page.getByTestId("respondent-quality").filter({ visible: true }).getByTestId("rq-reversed").locator('li[data-variable="Q1_3"]');
    await expect(again).toHaveAttribute("data-reversed", "true", { timeout: 90_000 });
    await again.getByRole("button", { name: "Undo" }).click();
    await expect(again).toHaveAttribute("data-reversed", "false", { timeout: 90_000 });
    expect((await stored())?.Q1_3).toBeUndefined();
  } finally {
    await db.end();
  }
});
