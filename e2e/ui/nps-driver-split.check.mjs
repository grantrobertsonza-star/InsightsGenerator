// NPS and driver analysis side by side with a divider the researcher drags, and a quadrant at full pane width
// (Grant, 29 October 2026: "the quadrant is tiny"; "a split screen so we can pull left or right to make the nps
// bigger or smaller and the drivers bigger or smaller"). Real browser on the disposable stack at 1600 wide:
//   1. NPS of REC, then a driver analysis of REC on three ratings: the two sit in one split, half and half.
//   2. The divider moved with the keyboard (three steps right) widens the NPS pane to 65%; dragging it with the
//      mouse to about a third narrows it; it stays after a reload of the result (browser storage).
//   3. The importance quadrant fills its pane's width (it was a thumbnail beside its legend).
//   4. At 1100 wide the panes stack and there is no divider.
import { expect, test } from "@playwright/test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
if (target.disposable !== true) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);

test.use({ viewport: { width: 1600, height: 1000 } });

test("NPS and drivers share a resizable split, and the quadrant fills its pane", async ({ page }, testInfo) => {
  test.setTimeout(8 * 60_000);
  const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
  const ui = await bind({ page, target, testInfo });
  const run = await ui.createRun({ name: `nps-driver-split-${Date.now()}` });
  const dir = mkdtempSync(path.join(tmpdir(), "nps-split-"));
  let seed = 5;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const rows = ["id,REC,X1,X2,X3"];
  for (let i = 1; i <= 240; i++) {
    const x1 = 1 + Math.floor(rnd() * 5), x2 = 1 + Math.floor(rnd() * 5), x3 = 1 + Math.floor(rnd() * 5);
    // Every point 0 to 10 appears (the NPS tool needs the whole scale); the rest follow X1 and X2.
    const rec = i <= 22 ? (i - 1) % 11 : Math.min(10, Math.max(0, Math.round(x1 * 1.6 + x2 * 0.8 + rnd() * 3 - 2)));
    rows.push(`${i},${rec},${x1},${x2},${x3}`);
  }
  const file = path.join(dir, "nps-split.csv");
  writeFileSync(file, rows.join("\n") + "\n");
  await ui.upload(run, file, "table");

  const section = () => page.getByTestId("analytics-section").filter({ visible: true });
  await page.goto(run.url, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /^Analytics/ }).first().click();
  await expect(section().getByRole("list", { name: "Analyses" })).toBeVisible({ timeout: 60_000 });
  await section().getByTestId("analytics-file-select").selectOption({ label: "nps-split.csv" });
  await section().getByRole("list", { name: "Analyses" }).getByRole("button", { name: /^Net Promoter Score/ }).click({ timeout: 60_000 });
  const ws = page.getByRole("dialog", { name: "Analytics workspace" });
  await expect(ws).toBeVisible();
  await ws.getByLabel("NPS question").selectOption("REC");
  await ws.getByRole("button", { name: "Calculate NPS" }).click();
  await expect(ws.getByRole("button", { name: "Post to findings" }).first()).toBeVisible({ timeout: 60_000 });

  await ws.getByRole("button", { name: "Driver analysis", exact: true }).click();
  await ws.getByLabel("Outcome variable").selectOption("REC");
  const predictor = (name) => ws.getByTestId("driver-predictor-list").locator("label", { hasText: new RegExp(`^${name}\\b`) }).locator("input[type=checkbox]");
  for (const x of ["X1", "X2", "X3"]) await predictor(x).check();
  await ws.getByRole("button", { name: "Run driver analysis" }).click();
  await expect(ws.getByTestId("driver-report")).toBeVisible({ timeout: 2 * 60_000 });

  // 1. One split, NPS left and drivers right, half and half.
  const split = ws.getByTestId("nps-driver-split");
  const left = ws.getByTestId("nps-driver-split-left");
  const right = ws.getByTestId("nps-driver-split-right");
  await expect(left).toBeVisible();
  await expect(right.getByTestId("driver-report")).toBeVisible();
  const widths = async () => [Math.round((await left.boundingBox()).width), Math.round((await right.boundingBox()).width)];
  const [l0, r0] = await widths();
  expect(Math.abs(l0 - r0)).toBeLessThanOrEqual(2);

  // 2. Keyboard: three steps right is 65%.
  const handle = ws.getByTestId("nps-driver-split-handle");
  await handle.focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
  await expect(split).toHaveAttribute("data-split", "65");
  await expect(handle).toHaveAttribute("aria-valuenow", "65");
  const [l1, r1] = await widths();
  expect(l1).toBeGreaterThan(r1);
  // Mouse: drag to about a third of the split's width.
  const box = await split.boundingBox();
  const hb = await handle.boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 3, hb.y + 40, { steps: 8 });
  await page.mouse.up();
  const dragged = Number(await split.getAttribute("data-split"));
  expect(dragged).toBeGreaterThanOrEqual(30);
  expect(dragged).toBeLessThanOrEqual(37);
  const [l2, r2] = await widths();
  expect(r2).toBeGreaterThan(l2);

  // 3. The quadrant fills the driver pane's width.
  const quad = right.getByTestId("quadrant-chart");
  await expect(quad).toBeVisible();
  const qw = (await quad.boundingBox()).width;
  const fw = (await right.getByTestId("quadrant-frame").boundingBox()).width;
  expect(qw).toBeGreaterThan(fw * 0.9);
  if (process.env.SHOT) await ws.screenshot({ path: process.env.SHOT });

  // The split is kept for this browser: a reload shows the same proportion once the result is back.
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /^Analytics/ }).first().click();
  await section().getByTestId("analytics-file-select").selectOption({ label: "nps-split.csv" });
  await section().getByRole("list", { name: "Analyses" }).getByRole("button", { name: /^Driver analysis/ }).click({ timeout: 60_000 });
  const ws2 = page.getByRole("dialog", { name: "Analytics workspace" });
  await expect(ws2.getByTestId("driver-report")).toBeVisible({ timeout: 2 * 60_000 });
  if (await ws2.getByTestId("nps-driver-split-handle").count()) await expect(ws2.getByTestId("nps-driver-split")).toHaveAttribute("data-split", String(dragged));

  // 4. Narrow: stacked, no divider.
  await page.setViewportSize({ width: 1100, height: 1000 });
  await expect(ws2.getByTestId("nps-driver-split-handle")).toHaveCount(0);
});
