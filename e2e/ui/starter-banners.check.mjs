// StarterTabs (Grant, 2026-10-22: a call-centre tracker split only by Segment showed "No demographic
// variables ... were found"). Real browser against the disposable local stack, synthetic CSV files
// shaped like csm_Wave1_Baseline.xlsx (text answers with no value labels):
//   1. A file whose only grouping is Segment: the starter set is offered, split by Segment, and
//      Build starter tables builds one draft table with Segment across the top.
//   2. A file with no recognised grouping: the panel says so and opens the column chooser; choosing
//      ContactMethod and Transferred offers a set of two tables, and building gives one per column.
//   3. "Use the recognised ones" is offered only for a choice; a 0 to 10 rating is not offered as a
//      column to split by (it has more than 10 answers).
import { expect, test } from "@playwright/test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { openCrosstabs } from "./helpers/crosstabs.mjs";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
if (target.disposable !== true) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);

test.use({ viewport: { width: 1600, height: 1000 } });

test("StarterTabs splits by a customer grouping, and by columns the researcher chooses", async ({ page }, testInfo) => {
  test.setTimeout(6 * 60_000);
  page.setDefaultTimeout(30_000);
  const db = new pg.Client({ connectionString: target.databaseUrlWithoutCredentials.replace("postgres://", "postgres://postgres@") });
  await db.connect();
  const dir = mkdtempSync(path.join(tmpdir(), "starter-banners-"));
  try {
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const run = await ui.createRun({ name: `starter-banners-${Date.now()}` });
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const pick = (list) => list[Math.floor(rnd() * list.length)];
    const segmentRows = ["RespondentID,Wave,Segment,Transferred,WaitTimeVsExpectation,OverallSatisfaction_0to10"];
    const plainRows = ["RespondentID,ContactMethod,Transferred,WaitTimeVsExpectation,OverallSatisfaction_0to10"];
    for (let i = 1; i <= 200; i++) {
      const transferred = pick(["Yes", "No"]);
      const wait = pick(["MuchQuicker", "Quicker", "JustAsLong", "Longer", "MuchLonger"]);
      const sat = Math.floor(rnd() * 11);
      segmentRows.push(`W1_${i},Wave1,${pick(["Segment1", "Segment2", "Segment3"])},${transferred},${wait},${sat}`);
      // "Contact method" is not a recognised grouping, so nothing in this file is recognised.
      plainRows.push(`P_${i},${pick(["Phone", "App", "Web"])},${transferred},${wait},${sat}`);
    }
    const segmentFile = path.join(dir, "starter-segment.csv");
    const plainFile = path.join(dir, "starter-plain.csv");
    writeFileSync(segmentFile, segmentRows.join("\n") + "\n");
    writeFileSync(plainFile, plainRows.join("\n") + "\n");
    await ui.upload(run, segmentFile, "table");
    await ui.upload(run, plainFile, "table");
    const starterTables = async (file) =>
      (
        await db.query(
          `select t.crosstab->'savedRequest'->'columnVars' as cols from document_tables t join documents d on d.id = t.document_id
           where t.run_id=$1 and d.source_filename=$2 and t.table_index >= 100 and t.label like 'Starter:%' order by t.table_index`,
          [run.id, file],
        )
      ).rows.map((r) => r.cols);

    // 1. Segment is recognised.
    await page.goto(run.url, { waitUntil: "networkidle" });
    let ws = await openCrosstabs(page, "starter-segment.csv");
    await ws.getByRole("button", { name: "StarterTabs" }).click();
    await expect(ws.getByText("Suggested starter tables")).toBeVisible();
    await expect(ws.getByText(/^Segment against \d+ questions/)).toBeVisible();
    const chooser = ws.getByTestId("starter-banner-chooser");
    await expect(chooser).not.toHaveAttribute("open", "");
    await chooser.locator("summary").click();
    await expect(chooser.getByRole("checkbox", { name: /Segment/ })).toBeChecked();
    await expect(chooser.getByRole("checkbox", { name: /OverallSatisfaction_0to10/ })).toHaveCount(0);
    await expect(chooser.getByRole("button", { name: "Use the recognised ones" })).toHaveCount(0);
    if (process.env.SHOT) await ws.screenshot({ path: process.env.SHOT.replace(".png", "-starter-segment.png") });
    await ws.getByRole("button", { name: "Build starter tables" }).click();
    await expect.poll(() => starterTables("starter-segment.csv"), { timeout: 120_000 }).toEqual([["Segment"]]);

    // 2. Nothing recognised: the chooser opens, and the researcher's columns are built.
    ws = await openCrosstabs(page, "starter-plain.csv");
    await ws.getByRole("button", { name: "StarterTabs" }).click();
    await expect(ws.getByTestId("starter-none-recognised")).toContainText("Choose the columns to split by below.");
    await expect(ws.getByRole("button", { name: "Build starter tables" })).toHaveCount(0);
    const plainChooser = ws.getByTestId("starter-banner-chooser");
    await expect(plainChooser).toHaveAttribute("open", "");
    await plainChooser.getByRole("checkbox", { name: /ContactMethod/ }).check();
    await plainChooser.getByRole("checkbox", { name: /^Transferred/ }).check();
    await expect(ws.getByText(/^ContactMethod, Transferred against \d+ questions/)).toBeVisible();
    await expect(plainChooser.getByRole("button", { name: "Use the recognised ones" })).toBeVisible();
    if (process.env.SHOT) await ws.screenshot({ path: process.env.SHOT.replace(".png", "-starter-chosen.png") });
    await ws.getByRole("button", { name: "Build starter tables" }).click();
    await expect.poll(() => starterTables("starter-plain.csv"), { timeout: 120_000 }).toEqual([["ContactMethod"], ["Transferred"]]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    await db.end();
  }
});
