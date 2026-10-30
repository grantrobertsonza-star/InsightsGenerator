// One-page Objectives prototype (Grant, 2026-10-22: "can we make these sizeable"): the three columns
// of the Objective and context band (fill from a brief or proposal, business problem, objectives and
// audience) are resized by two separators, by pointer and by keyboard; the widths are kept after a
// reload; the band stacks with no separators on a narrow screen; and with storage blocked the
// columns still resize for the page view.
import { expect, test } from "@playwright/test";
import { openSection } from "./helpers/nav.mjs";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
if (target.disposable !== true) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
const shot = (suffix) => (process.env.SHOT ? process.env.SHOT.replace(".png", `-band-${suffix}.png`) : null);

test.use({ viewport: { width: 1440, height: 1000 } });

/** The band's column widths, left to right, separators left out. */
const columnWidths = (page) =>
  page.getByTestId("objectives-band").evaluate((form) =>
    [...form.children]
      .filter((el) => el.getAttribute("role") !== "separator" && el.getBoundingClientRect().width > 0)
      .map((el) => Math.round(el.getBoundingClientRect().width)),
  );

test("the Objectives band columns resize by pointer and keyboard, are kept after a reload, and stack when narrow", async ({ page, browser }, testInfo) => {
  test.setTimeout(5 * 60_000);
  page.setDefaultTimeout(30_000);
  const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
  const ui = await bind({ page, target, testInfo });
  const run = await ui.createRun({ name: `objectives-band-${Date.now()}` });
  // A proposal, so the band has its fill column and all three columns show.
  const dir = mkdtempSync(path.join(os.tmpdir(), "objband-"));
  const file = path.join(dir, "Band_Proposal.txt");
  writeFileSync(file, "Proposal for the band resize check.");
  await ui.upload(run, file, "proposal");
  rmSync(dir, { recursive: true, force: true });

  await openSection(page, "Set Objectives");
  const band = page.getByTestId("objectives-band");
  await expect(band).toBeVisible();
  const first = page.getByTestId("band-column-handle-0");
  const second = page.getByTestId("band-column-handle-1");
  await expect(first).toBeVisible();
  await expect(second).toBeVisible();

  const start = await columnWidths(page);
  expect(start).toHaveLength(3);
  // Equal to begin with (within rounding).
  expect(Math.max(...start) - Math.min(...start)).toBeLessThanOrEqual(2);

  // 1. Drag the first separator 120 px to the right: the fill column grows, business problem shrinks.
  const box = await first.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2, { steps: 4 });
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();
  const dragged = await columnWidths(page);
  expect(Math.abs(dragged[0] - start[0] - 120)).toBeLessThanOrEqual(4);
  expect(Math.abs(start[1] - dragged[1] - 120)).toBeLessThanOrEqual(4);
  expect(Math.abs(dragged[2] - start[2])).toBeLessThanOrEqual(2);

  // 2. Keyboard: the second separator moves left with the arrow key, and reports its position.
  const before = Number(await second.getAttribute("aria-valuenow"));
  await second.focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowLeft");
  const after = Number(await second.getAttribute("aria-valuenow"));
  expect(after).toBeLessThan(before);
  const keyed = await columnWidths(page);
  expect(keyed[2]).toBeGreaterThan(dragged[2]);
  expect(keyed[1]).toBeLessThan(dragged[1]);

  // 3. No column goes below its minimum: Home pushes the business problem column to its narrowest.
  await page.keyboard.press("Home");
  const narrowest = await columnWidths(page);
  expect(narrowest[1]).toBeGreaterThanOrEqual(195);
  const atHome = Number(await second.getAttribute("aria-valuenow"));
  expect(atHome).toBe(Number(await second.getAttribute("aria-valuemin")));
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowLeft");
  const kept = await columnWidths(page);
  const s1 = shot("resized");
  if (s1) await band.screenshot({ path: s1 });

  // 4. Kept after a reload.
  await page.reload({ waitUntil: "networkidle" });
  await openSection(page, "Set Objectives");
  await expect(band).toBeVisible();
  await expect.poll(() => columnWidths(page)).toEqual(kept);

  // 5. Enter puts the columns back to equal widths.
  await page.getByTestId("band-column-handle-0").focus();
  await page.keyboard.press("Enter");
  const reset = await columnWidths(page);
  expect(Math.max(...reset) - Math.min(...reset)).toBeLessThanOrEqual(2);

  // 6. Narrow: the band stacks, the separators are hidden and the page does not scroll sideways.
  await page.setViewportSize({ width: 800, height: 1000 });
  await expect(page.getByTestId("band-column-handle-0")).toBeHidden();
  await expect(page.getByTestId("band-column-handle-1")).toBeHidden();
  const stacked = await columnWidths(page);
  expect(new Set(stacked).size).toBe(1);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  const s2 = shot("narrow");
  if (s2) await page.screenshot({ path: s2, fullPage: true });

  // 7. Storage blocked: the columns still resize for this page view, and nothing breaks.
  const blocked = await browser.newContext({ storageState: await page.context().storageState(), viewport: { width: 1440, height: 1000 } });
  try {
    await blocked.addInitScript(() => {
      Object.defineProperty(window, "localStorage", { get() { throw new Error("storage blocked"); } });
    });
    const p = await blocked.newPage();
    const errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(run.url, { waitUntil: "networkidle" });
    await openSection(p, "Set Objectives");
    const h = p.getByTestId("band-column-handle-0");
    await expect(h).toBeVisible();
    const was = await columnWidths(p);
    await h.focus();
    for (let i = 0; i < 4; i++) await p.keyboard.press("ArrowRight");
    const now = await columnWidths(p);
    expect(now[0]).toBeGreaterThan(was[0]);
    expect(errors.filter((m) => /band|storage/i.test(m))).toEqual([]);
  } finally {
    await blocked.close();
  }
});
