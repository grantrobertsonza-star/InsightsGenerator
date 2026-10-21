// UI-GT500-01 and UI-R500-01 (Codex, 2026-10-21): the Findings review fits a narrow screen. In a real
// browser on the disposable stack, on a project with the findings the golden-thread helper posts plus
// 43 copies under long, distinct themes (close to Codex's 44-finding, 43-theme shape; the exact count
// is whatever the helper posted plus 43):
//   1. At 320, 375 and 768 px, in the app's font and again in a wider fallback font (Codex's offline
//      build lays text out wider), the Findings review adds no horizontal page overflow; the category
//      strip (All / Chart / Stated findings) and the "How it was drawn" control (All evidence / From
//      words / From numbers) stay inside their columns with every name shown.
//   2. A chosen category and evidence type stay chosen as the page narrows; both controls work from
//      the keyboard, and From numbers shows exactly the findings drawn from numbers.
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

  // Found by its buttons, so the same check runs on the code before the repair.
  const evidence = page.locator('div:has(> button:has-text("All evidence")):has(> button:has-text("From numbers"))').filter({ visible: true }).first();
  const fromNumbers = evidence.getByRole("button", { name: "From numbers" });
  const fits = async (font) => {
    for (const width of [768, 375, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(strip).toBeVisible();
      const geometry = await page.evaluate(() => {
        const box = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right }; };
        const strip = [...document.querySelectorAll("div")].find((d) => d.offsetParent && [...d.children].some((c) => c.textContent.trim().startsWith("All findings")) && [...d.children].some((c) => c.textContent.trim().startsWith("Stated findings")));
        const ev = [...document.querySelectorAll("div")].find((d) => d.offsetParent && [...d.children].some((c) => c.textContent.trim() === "All evidence") && [...d.children].some((c) => c.textContent.trim() === "From numbers"));
        const buttons = (el) => [...el.querySelectorAll("button")].map((b) => ({ name: b.textContent.trim(), ...box(b) }));
        return {
          page: { scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth },
          strip: { ...box(strip), column: box(strip.parentElement), buttons: buttons(strip) },
          evidence: { ...box(ev), column: box(ev.parentElement), buttons: buttons(ev) },
        };
      });
      testInfo.annotations.push({ type: "narrow", description: JSON.stringify({ font, width, ...geometry }) });
      const at = `at ${width}px (${font})`;
      expect(geometry.page.scroll, `the page is wider than the window ${at}`).toBeLessThanOrEqual(geometry.page.client + 1);
      for (const [name, c] of [["category strip", geometry.strip], ["How it was drawn control", geometry.evidence]]) {
        expect(c.right, `the ${name} runs past its column ${at}`).toBeLessThanOrEqual(c.column.right + 1);
        for (const b of c.buttons) expect(b.right, `${b.name} is cut off ${at}`).toBeLessThanOrEqual(Math.min(c.column.right, geometry.page.client) + 1);
      }
      expect(geometry.strip.buttons.map((b) => b.name.replace(/\d+$/, ""))).toEqual(["All findings", "Chart findings", "Stated findings"]);
      expect(geometry.evidence.buttons.map((b) => b.name)).toEqual(["All evidence", "From words", "From numbers"]);
      await expect(stated).toHaveClass(/bg-primary-light/);
      await expect(fromNumbers).toHaveClass(/bg-primary-light/);
      if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT.replace(".png", `-${font}-${width}.png`), fullPage: true });
    }
  };
  await fromNumbers.click();
  await fits("app font");
  // A wider fallback font, as in a build without the web font.
  await page.addStyleTag({ content: "*, *::before, *::after { font-family: 'DejaVu Sans', Verdana, sans-serif !important; }" });
  await fits("wide fallback font");

  // From numbers shows exactly the findings drawn from numbers: here all of them are (one crosstab).
  await page.setViewportSize({ width: 375, height: 900 });
  await strip.getByRole("button", { name: /^All findings/ }).click();
  const shown = Number((await strip.getByRole("button", { name: /^All findings/ }).textContent()).replace(/\D+/g, ""));
  expect(shown).toBeGreaterThanOrEqual(44);
  await expect(page.getByText(/Showing \d+ of \d+/).filter({ visible: true }).first()).toHaveText(new RegExp(`Showing ${shown} of ${shown}`));

  // Keyboard: both controls take focus and Enter chooses.
  const words = evidence.getByRole("button", { name: "From words" });
  await words.focus();
  await page.keyboard.press("Enter");
  await expect(words).toHaveClass(/bg-primary-light/);
  await expect(page.getByText(/Showing \d+ of \d+/).filter({ visible: true }).first()).toHaveText(new RegExp(`Showing 0 of ${shown}`));
  // Keyboard: the strip's buttons take focus and Enter chooses one.
  const all = strip.getByRole("button", { name: /^All findings/ });
  await all.focus();
  await page.keyboard.press("Enter");
  await expect(all).toHaveClass(/bg-primary-light/);
});
