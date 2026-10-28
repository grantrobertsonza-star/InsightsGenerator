// Long variable names in the codebook links table (Grant, 28 October 2026: the Findex codebook's
// economycode and wpid_random ran into the question text). Real browser on the disposable stack: a CSV
// codebook with short, usual-length and very long names; each code stays inside its own column, wrapping
// when it must, and never overlaps the question beside it.
import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { addFiles } from "./helpers/addFiles.mjs";
import { selectSource } from "./helpers/sources.mjs";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
if (target.disposable !== true) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
const SHOT = process.env.SHOT;

const NAMES = ["q1", "economycode", "wpid_random", "a_very_long_variable_name_written_without_any_breaks_at_all_2026"];

test.use({ viewport: { width: 1600, height: 1000 } });

test("long codebook names stay inside the Code column and do not overlap the question", async ({ page }, testInfo) => {
  test.setTimeout(6 * 60_000);
  const dir = mkdtempSync(path.join(tmpdir(), "longcodes-"));
  writeFileSync(path.join(dir, "survey.csv"), `${NAMES.join(",")}\n1,ZAF,11,2\n2,KEN,12,1\n`);
  writeFileSync(
    path.join(dir, "survey_codebook.csv"),
    `Variable,Label,Values\n${NAMES.map((n) => `${n},"Economy code - International Standards Organization (ISO) 3-digit alphabetic code for ${n}",`).join("\n")}\n`,
  );
  const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
  const ui = await bind({ page, target, testInfo });
  const run = await ui.createRun({ name: `longcodes-${Date.now()}` });
  await ui.upload(run, path.join(dir, "survey.csv"), "table");
  await addFiles(page, [path.join(dir, "survey_codebook.csv")], "Codebook");
  await selectSource(page, "survey_codebook.csv");
  const card = page.getByRole("tabpanel", { name: "Codebook links", exact: true });
  await expect(card.getByText("Variables read")).toBeVisible({ timeout: 3 * 60_000 });
  // The matches table is folded away until the researcher asks to review it.
  await card.getByRole("button", { name: "Review matches", exact: true }).click();
  const all = card.getByRole("button", { name: "All", exact: true });
  if (await all.count()) await all.click();
  for (const name of NAMES) {
    const code = card.getByTestId("item-code").filter({ hasText: name }).first();
    await expect(code).toBeVisible({ timeout: 60_000 });
    const box = await code.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const next = el.nextElementSibling.getBoundingClientRect();
      return { overflow: el.scrollWidth - el.clientWidth, right: r.right, nextLeft: next.left };
    });
    expect(box.overflow, `${name} overflows its cell`).toBeLessThanOrEqual(0);
    expect(box.right, `${name} runs into the question`).toBeLessThanOrEqual(box.nextLeft + 0.5);
    // The variable column: its name and method, and the confirm and reject buttons, stay inside the cell and
    // never sit on top of each other (the buttons wrap under the variable when the names are long).
    const links = card.locator(`[data-testid="item-links"][data-item-code="${name}"]`);
    const geo = await links.evaluate((cell) => {
      const c = cell.getBoundingClientRect();
      const v = cell.querySelector('[data-testid="link-variable"]').getBoundingClientRect();
      const b = [...cell.querySelectorAll('[data-testid="link-choices"] button')].map((x) => x.getBoundingClientRect());
      const hit = (a, z) => a.left < z.right - 0.5 && z.left < a.right - 0.5 && a.top < z.bottom - 0.5 && z.top < a.bottom - 0.5;
      return {
        buttons: b.length,
        overlaps: b.filter((x) => hit(x, v)).length,
        past: Math.max(v.right, ...b.map((x) => x.right)) - c.right,
      };
    });
    expect(geo.buttons, `${name} has its confirm and reject buttons`).toBe(2);
    expect(geo.overlaps, `${name}: a button covers the variable`).toBe(0);
    expect(geo.past, `${name}: the links run past their column`).toBeLessThanOrEqual(0.5);
  }
  if (SHOT) await card.screenshot({ path: SHOT });
});
