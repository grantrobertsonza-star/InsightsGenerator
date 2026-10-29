// Chart legends and titles stay inside the chart (Grant, 29 October 2026: "the legends in the chart module are
// being cut off"; his screenshot: a Yes/No question split by nine provinces, legend and title clipped at the
// chart's right edge). Real browser on the disposable stack, Analytics > Charts:
//   1. A yes/no question with a long name split by nine provinces: all nine legend entries, each with its full
//      name and n, and every line of the title, lie inside the chart's drawing area; the title wraps.
//   2. The same with the legend at the bottom.
//   3. A question with many categories (a wide chart that scrolls sideways): the title and all nine legend entries
//      show within the card before any scrolling.
import { expect, test } from "@playwright/test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as XLSX from "xlsx";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
if (target.disposable !== true) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);

const PROVINCES = ["Western Cape", "Eastern Cape", "Northern Cape", "Free State", "KwaZulu- Natal", "North West", "Gauteng", "Mpumalanga", "Limpopo"];
const LONG = "C1_36. Source of money- Salary/wage/ money from individuals - Domestic worker/Char";

test.use({ viewport: { width: 1600, height: 1000 } });

test("chart legends and titles fit inside the chart", async ({ page }, testInfo) => {
  test.setTimeout(8 * 60_000);
  const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
  const ui = await bind({ page, target, testInfo });
  const run = await ui.createRun({ name: `chart-legend-${Date.now()}` });
  const dir = mkdtempSync(path.join(tmpdir(), "chart-legend-"));
  // A workbook with its own labels (Data, Variables and Values sheets), as an SPSS file would carry them: the
  // chart lists labelled questions, and the legend shows the provinces' names.
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const data = [["id", "Province", "C1_36", "HH_size"]];
  for (let i = 1; i <= 450; i++) data.push([i, 1 + (i % 9), rnd() < 0.05 ? 1 : 2, 1 + Math.floor(rnd() * 12)]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(data), "Data");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Variable", "Label"], ["id", "Respondent"], ["Province", "Province"], ["C1_36", LONG], ["HH_size", "HH_size"]]), "Variables");
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["Variable", "Value", "Value label"],
      ...PROVINCES.map((p, i) => ["Province", i + 1, p]),
      ["C1_36", 1, "Yes"],
      ["C1_36", 2, "No"],
    ]),
    "Values",
  );
  const file = path.join(dir, "legend.xlsx");
  writeFileSync(file, XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
  await ui.upload(run, file, "table");
  await page.goto(run.url, { waitUntil: "networkidle" });
  const section = page.getByTestId("analytics-section").filter({ visible: true });
  await page.getByRole("button", { name: /^Analytics/ }).first().click();
  await expect(section.getByRole("list", { name: "Analyses" })).toBeVisible({ timeout: 60_000 });
  await section.getByTestId("analytics-file-select").selectOption({ label: "legend.xlsx" });
  await section.getByRole("list", { name: "Analyses" }).getByRole("button", { name: /^Charts/ }).click({ timeout: 60_000 });
  const ws = page.getByRole("dialog", { name: "Analytics workspace" });
  await expect(ws).toBeVisible();
  const grid = ws.getByTestId("analytics-card-grid");

  const build = async (question) => {
    const before = await grid.locator("[data-card-kind=bar]").count().catch(() => 0);
    await ws.getByRole("radiogroup", { name: "Chart type" }).getByRole("radio", { name: "Bar" }).click({ timeout: 60_000 });
    await ws.getByLabel("Chart question").selectOption(question);
    await ws.getByLabel("Group by").selectOption("Province");
    await ws.getByRole("button", { name: "Build chart" }).click();
    await expect(grid.locator("[data-card-kind=bar]")).toHaveCount(before + 1, { timeout: 60_000 });
    return grid.locator("[data-card-kind=bar]").first();
  };
  // Every legend entry and title line, as drawn, against the chart's drawing area.
  const fits = async (card) =>
    card.locator("svg").first().evaluate((svg) => {
      const box = svg.getBoundingClientRect();
      // What shows before any sideways scrolling: the chart's frame (a wide chart scrolls inside it).
      const frame = svg.parentElement.getBoundingClientRect();
      const within = (el, b) => {
        const r = el.getBoundingClientRect();
        return r.left >= b.left - 0.5 && r.right <= b.right + 0.5 && r.top >= b.top - 0.5 && r.bottom <= b.bottom + 0.5;
      };
      const inside = (el) => within(el, box) && within(el, frame);
      const entries = [...svg.querySelectorAll('[data-testid="chart-legend-entry"]')];
      const title = [...svg.querySelectorAll('[data-testid="chart-title"] tspan')];
      return {
        entries: entries.length,
        names: entries.map((e) => e.querySelector("text")?.textContent ?? ""),
        outside: [...entries, ...title].filter((e) => !inside(e)).map((e) => e.textContent),
        titleLines: title.length,
      };
    });

  // 1. Legend on top (the default).
  const card = await build("C1_36");
  const r1 = await fits(card);
  expect(r1.entries).toBe(9);
  expect(r1.outside).toEqual([]);
  for (const p of PROVINCES) expect(r1.names.some((n) => n.startsWith(`${p} (n=`))).toBe(true);
  expect(r1.titleLines).toBeGreaterThan(1);
  if (process.env.SHOT) await card.screenshot({ path: process.env.SHOT });

  // 2. Legend at the bottom.
  // The newest card's title and colour controls are open; another card opens them with "Edit title and colours".
  const edit = card.getByRole("button", { name: /Edit title and colours/ });
  if (await edit.count()) await edit.click();
  const bottom = card.getByRole("button", { name: /^bottom$/i });
  await expect(bottom).toBeVisible({ timeout: 30_000 });
  await bottom.click();
  const r2 = await fits(card);
  expect(r2.entries).toBe(9);
  expect(r2.outside).toEqual([]);
  if (process.env.SHOT) await card.screenshot({ path: process.env.SHOT.replace(".png", "-bottom.png") });

  // 3. A wide chart (twelve household sizes by nine provinces) scrolls; its title and whole legend show without
  //    scrolling (laid out within the card's width, not across the scroll width).
  const wide = await build("HH_size");
  const r3 = await fits(wide);
  if (process.env.SHOT) await wide.screenshot({ path: process.env.SHOT.replace(".png", "-wide.png") });
  expect(r3.entries).toBe(9);
  expect(r3.outside).toEqual([]);
});
