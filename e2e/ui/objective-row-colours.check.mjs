// The scores table on Review Objectives says which objective each rolled-up row is (Grant, 2026-10-26),
// in a real browser on the disposable stack:
//   - each row carries the colour of its card in the left list and the objective's short name (the
//     label before a colon, or its opening words), while rolled up;
//   - rolling a row down shows the full wording and hides the short name;
//   - selecting an objective shows its detail with the same colour and number as its card.
import { expect, test } from "@playwright/test";
import { openSection } from "./helpers/nav.mjs";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
if (target.disposable !== true) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
const shot = process.env.SHOT;
const LINES = [
  "Main question: Which segments use the colour-check service most",
  "Profiling: Describe colour-check users by age and region",
  "Colour-check objective without a label that runs on for a while",
];
const BARS = ["border-l-indigo-400", "border-l-emerald-400", "border-l-amber-400"];

test.use({ viewport: { width: 1600, height: 1000 } });

test("rolled-up objective rows carry their card's colour and short name", async ({ page }, testInfo) => {
  test.setTimeout(4 * 60_000);
  const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
  const ui = await bind({ page, target, testInfo });
  const run = await ui.createRun({ name: `objective-colours-${Date.now()}` });

  await openSection(page, "Set Objectives");
  const form = page.locator("form", { has: page.locator('textarea[name="researchObjective"]') });
  await form.locator('textarea[name="researchObjective"]').fill(LINES.join("\n"));
  await form.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText(LINES[2], { exact: true }).first()).toBeVisible({ timeout: 60_000 });

  await page.goto(run.url, { waitUntil: "networkidle" });
  await openSection(page, "Review Objectives");
  const cards = page.getByTestId("stated-objectives").locator("li");
  await expect(cards).toHaveCount(3, { timeout: 60_000 });

  for (const [i, line] of LINES.entries()) {
    // The left card's colour is the one the row must carry.
    await expect(cards.nth(i)).toHaveClass(new RegExp(BARS[i]));
    const row = page.locator("tbody[data-objective-row]", { hasText: line.split(": ").pop() }).first();
    const first = row.locator("td").first();
    await expect(first).toHaveAttribute("data-objective-accent", String(i));
    await expect(first).toHaveClass(new RegExp(BARS[i]));
    const name = row.getByTestId("objective-row-name");
    await expect(name).toBeVisible();
    await expect(name).toHaveText(i < 2 ? line.split(": ")[0] : line);
  }
  if (shot) await page.screenshot({ path: shot.replace(/\.png$/, "-objective-rows.png"), fullPage: false });

  // Rolled down, the full wording replaces the short name.
  const row = page.locator("tbody[data-objective-row]", { hasText: "Describe colour-check users" }).first();
  await row.getByTestId("objective-roll").click();
  await expect(row.getByText("Describe colour-check users by age and region", { exact: false }).last()).toBeVisible();
  await expect(row.getByTestId("objective-row-name")).toHaveCount(0);
  await row.getByTestId("objective-roll").click();
  await expect(row.getByTestId("objective-row-name")).toBeVisible();
});
