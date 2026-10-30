// The scores table on Review Objectives says which objective each rolled-up row is (Grant, 2026-10-26),
// in a real browser on the disposable stack:
//   - each row carries the colour of its card in the left list and the objective's short name (the
//     label before a colon, or its opening words), while rolled up;
//   - rolling a row down shows the full wording and hides the short name;
//   - the table lists the objectives in the cards' order, even when they were stored in another order
//     (Grant, 2026-10-26: the rows followed the order the candidates were created in).
import { expect, test } from "@playwright/test";
import { openSection } from "./helpers/nav.mjs";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
const dbUrl = new URL(target.databaseUrlWithoutCredentials);
if (target.disposable !== true || !/^\/ie_e2e_[a-f0-9]{10}$/.test(dbUrl.pathname)) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
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

  // Stored in the reverse of the written order, as happens when objectives are edited or re-added.
  const db = new pg.Client({ connectionString: target.databaseUrlWithoutCredentials.replace("postgres://", "postgres://postgres@") });
  await db.connect();
  try {
    await db.query(
      "update objective_candidates set created_at = now() - (array_position($2::text[], candidate_text) || ' min')::interval where run_id = $1",
      [run.id, LINES],
    );
    const stored = (await db.query("select candidate_text from objective_candidates where run_id = $1 order by created_at", [run.id])).rows.map((r) => r.candidate_text);
    expect(stored.length).toBe(3);
    expect(stored[0]).toContain("Colour-check objective without a label");
  } finally {
    await db.end();
  }
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
  // The rows are in the cards' order.
  const order = await page.locator("tbody[data-objective-row] td[data-objective-accent]").evaluateAll((cells) => cells.map((c) => c.getAttribute("data-objective-accent")));
  expect(order).toEqual(["0", "1", "2"]);
  if (shot) await page.screenshot({ path: shot.replace(/\.png$/, "-objective-rows.png"), fullPage: false });

  // Rolled down, the full wording replaces the short name.
  const row = page.locator("tbody[data-objective-row]", { hasText: "Describe colour-check users" }).first();
  await row.getByTestId("objective-roll").click();
  await expect(row.getByText("Describe colour-check users by age and region", { exact: false }).last()).toBeVisible();
  await expect(row.getByTestId("objective-row-name")).toHaveCount(0);
  await row.getByTestId("objective-roll").click();
  await expect(row.getByTestId("objective-row-name")).toBeVisible();
});
