// UI-GT500-01 (Codex, 2026-10-21): the Findings review fits a narrow screen. In a real browser on the
// disposable stack, on a project with 44 findings across 43 long theme names (Codex's fixture shape):
//   1. At 320, 375 and 768 px the Findings review adds no horizontal page overflow, and the category
//      strip (All / Chart / Stated findings) stays inside its column with every name and count shown.
//   2. A chosen category stays chosen after the page narrows, and the strip is reachable by keyboard.
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
if (target.disposable !== true) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
const FIXTURE = path.resolve("fixtures/golden-thread-1");

test("the Findings review fits 320, 375 and 768 px with many long themes", async ({ page }, testInfo) => {
  test.setTimeout(10 * 60_000);
  const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
  const ui = await bind({ page, target, testInfo });
  const run = await ui.createRun({ name: `findings-narrow-${Date.now()}` });
  await ui.upload(run, path.join(FIXTURE, "golden-survey-documented.xlsx"), "table");
  await ui.expectReadyOrActionableRecovery(run);
  const table = await ui.buildPurchaseCrosstab(run);
  const finding = await ui.postAndAcceptFinding(table);
  const db = new pg.Client({ connectionString: target.databaseUrlWithoutCredentials.replace("postgres://", "postgres://postgres@") });
  await db.connect();
  try {
    // 43 copies with long, distinct themes, so there are 44 findings and 43 or 44 themes.
    for (let i = 1; i <= 43; i++) {
      await db.query(
        `insert into findings
           select (jsonb_populate_record(null::findings,
             to_jsonb(f) || jsonb_build_object('id', gen_random_uuid(), 'theme', $2::text, 'status', 'accepted', 'duplicate_group_id', null))).*
           from findings f where f.id = $1`,
        [finding.id, `Narrow screen theme ${i} about household purchase decisions across regions`],
      );
    }
  } finally {
    await db.end();
  }

  await page.goto(run.url, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /^Findings(\s*\d+)?$/ }).first().click();
  await page.getByTestId("findings-tab-review").filter({ visible: true }).first().click();
  // Found by its buttons rather than a test id, so the same check runs on the code before the repair.
  const strip = page.locator('div:has(> button:has-text("All findings")):has(> button:has-text("Stated findings"))').filter({ visible: true }).first();
  await expect(strip).toBeVisible({ timeout: 60_000 });
  const stated = strip.getByRole("button", { name: /^Stated findings/ });
  await stated.click();

  for (const width of [768, 375, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(strip).toBeVisible();
    const geometry = await strip.evaluate((el) => {
      const column = el.parentElement.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const buttons = [...el.querySelectorAll("button")].map((b) => {
        const br = b.getBoundingClientRect();
        return { name: b.textContent.trim(), left: br.left, right: br.right };
      });
      return {
        page: { scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth },
        strip: { left: r.left, right: r.right },
        column: { left: column.left, right: column.right },
        buttons,
      };
    });
    testInfo.annotations.push({ type: "narrow", description: JSON.stringify({ width, ...geometry }) });
    expect(geometry.page.scroll, `the page is wider than ${width}px`).toBeLessThanOrEqual(geometry.page.client + 1);
    expect(geometry.strip.right, `the category strip runs past its column at ${width}px`).toBeLessThanOrEqual(geometry.column.right + 1);
    expect(geometry.buttons.map((b) => b.name.replace(/\d+$/, ""))).toEqual(["All findings", "Chart findings", "Stated findings"]);
    for (const b of geometry.buttons) expect(b.right, `${b.name} is cut off at ${width}px`).toBeLessThanOrEqual(geometry.page.client + 1);
    // The chosen category is still the chosen one.
    await expect(stated).toHaveClass(/bg-primary-light/);
  }

  // Keyboard: the strip's buttons take focus and Enter chooses one.
  const all = strip.getByRole("button", { name: /^All findings/ });
  await all.focus();
  await page.keyboard.press("Enter");
  await expect(all).toHaveClass(/bg-primary-light/);
});
