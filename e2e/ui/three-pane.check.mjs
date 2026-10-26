// UI regression check for the adjustable three-pane layout (src/app/runs/[id]/ThreePane.tsx), in a real
// browser against the disposable local stack, on a project's Insights report section (Generate and
// export / Narrative / detail), which keeps the default left column. The home page used to be the
// subject; its Start a project pane is now a band above the list (Grant, 2026-10-23).
//   - default widths are the original fixed ones (left 22rem)
//   - dragging a handle resizes that pane, within its limits, and the width survives a reload
//   - the arrow keys move a focused handle; a double-click resets the default width
//   - collapsing the left pane keeps it mounted but hidden, survives a reload, and expands again
//   - on a narrow window the panes stack and no handles are shown
//   - the home page's Start a project band: above the list, folds without losing a typed name, remembered
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
if (target.disposable !== true) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
const home = new URL("/", target.appUrl).href;
const LEFT_TITLE = "Generate and export";

// One synthetic project for the whole file, made through the app the first time a test needs it.
let reportUrl = null;
async function openReport(page) {
  if (!reportUrl) {
    await page.goto(`${home}?entry=generate`, { waitUntil: "networkidle" });
    await page.getByLabel("Project name").fill(`Layout check ${Date.now()}`);
    await page.getByRole("button", { name: "Create project", exact: true }).click();
    await page.waitForURL(/\/runs\/[0-9a-f-]{36}/);
    reportUrl = `${new URL(page.url()).origin}${new URL(page.url()).pathname}?section=insights-report`;
  }
  await page.goto(reportUrl, { waitUntil: "networkidle" });
}
// The section's own layout (other sections' layouts are mounted but hidden).
const layout = (page) => page.getByTestId("three-pane").filter({ visible: true });
const pane = (page, side) => page.getByTestId(`three-pane-${side}`).filter({ visible: true });

const width = async (locator) => Math.round((await locator.boundingBox()).width);

test.use({ viewport: { width: 1440, height: 900 } });

test("side panes resize by drag and keyboard, remember their width, reset, and the left pane collapses", async ({ page }) => {
  await openReport(page);
  const left = pane(page, "left");
  const right = pane(page, "right");
  const leftHandle = page.getByRole("separator", { name: "Resize left panel" });
  const rightHandle = page.getByRole("separator", { name: "Resize right panel" });
  await expect(leftHandle).toBeVisible();
  // Clear any width left by an earlier run of this check.
  await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("three-pane:")).forEach((k) => localStorage.removeItem(k)));
  await page.reload({ waitUntil: "networkidle" });
  expect(await width(left)).toBe(352);

  // Drag the left edge 80px to the right (or up to its limit).
  const box = await leftHandle.boundingBox();
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, y, { steps: 4 });
  await page.mouse.move(box.x + box.width / 2 + 80, y, { steps: 4 });
  await page.mouse.up();
  // The left pane is limited to 35% of the layout, so the expected width depends on the window.
  const layoutWidth = await width(layout(page));
  const dragged = Math.min(432, Math.floor(layoutWidth * 0.35));
  expect(Math.abs((await width(left)) - dragged)).toBeLessThanOrEqual(2);
  await page.reload({ waitUntil: "networkidle" });
  expect(Math.abs((await width(left)) - dragged)).toBeLessThanOrEqual(2);

  // A drag far past the limit stops at it (35% of the layout).
  const box2 = await leftHandle.boundingBox();
  await page.mouse.move(box2.x + box2.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(box2.x + 900, y, { steps: 6 });
  await page.mouse.up();
  expect(await width(left)).toBeLessThanOrEqual(Math.ceil(layoutWidth * 0.35) + 1);
  expect(await width(layout(page).locator(":scope > div").nth(2))).toBeGreaterThan(300);

  // Keyboard: ArrowLeft on the right handle widens the right pane by one step.
  const before = await width(right);
  await rightHandle.focus();
  await page.keyboard.press("ArrowLeft");
  expect((await width(right)) - before).toBe(16);

  // Double-click resets the left pane to its default.
  await leftHandle.dblclick();
  expect(await width(left)).toBe(352);

  // Collapse: content hidden but mounted, rail shown; remembered across a reload; expands again.
  await page.getByRole("button", { name: "Collapse left panel" }).click();
  await expect(layout(page)).toHaveAttribute("data-left-collapsed", "true");
  // Hidden but still in the page (role queries skip hidden elements, so match the element itself).
  const leftTitle = left.locator("h3", { hasText: LEFT_TITLE });
  await expect(leftTitle).toBeAttached();
  await expect(leftTitle).toBeHidden();
  expect(await width(left)).toBe(44);
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByRole("button", { name: "Expand left panel" })).toBeVisible();
  await page.getByRole("button", { name: "Expand left panel" }).click();
  await expect(page.getByRole("heading", { name: LEFT_TITLE })).toBeVisible();
  expect(await width(left)).toBe(352);
});

test("on a narrow window the panes stack and show no handles", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await openReport(page);
  await expect(page.getByRole("separator")).toHaveCount(0);
  const grid = await width(layout(page));
  expect(Math.abs((await width(pane(page, "left"))) - grid)).toBeLessThanOrEqual(1);
  await expect(page.getByRole("button", { name: "Collapse left panel" })).toBeHidden();
});

for (const blocked of ["getItem", "setItem"]) {
  test(`blocked storage ${blocked} preserves in-page interaction and safely resets on reload`, async ({ page }) => {
    await page.addInitScript((method) => {
      Storage.prototype[method] = () => { throw new DOMException("Blocked site data", "SecurityError"); };
    }, blocked);
    await openReport(page);
    const left = pane(page, "left");
    // Collapsing keeps the pane's content mounted (hidden), so nothing in it is lost.
    const leftTitle = left.locator("h3", { hasText: LEFT_TITLE });
    const handle = page.getByRole("separator", { name: "Resize left panel" });
    await handle.focus();
    await page.keyboard.press("Home");
    await expect.poll(() => width(left)).toBe(224);
    const box = await handle.boundingBox();
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 40, y, { steps: 4 });
    await page.mouse.up();
    await expect.poll(() => width(left)).toBe(264);
    await page.getByRole("button", { name: "Collapse left panel", exact: true }).click();
    await expect(leftTitle).toBeAttached();
    await expect(leftTitle).toBeHidden();
    await page.getByRole("button", { name: "Expand left panel", exact: true }).click();
    await expect(leftTitle).toBeVisible();
    await expect.poll(() => width(left)).toBe(264);
    await page.reload({ waitUntil: "networkidle" });
    await expect.poll(() => width(left)).toBe(352);
  });
}

test("separator values track rendered widths and viewport-dependent bounds", async ({ page }) => {
  await openReport(page);
  for (const [viewport, containerWidth] of [[1440, null], [1100, null], [1440, 700], [1440, 400]]) {
    await page.setViewportSize({ width: viewport, height: 900 });
    await layout(page).evaluate((element, size) => { element.style.width = size === null ? "" : `${size}px`; }, containerWidth);
    const gridWidth = await width(layout(page));
    for (const [side, minimum, fraction] of [["left", 224, 0.35], ["right", 288, 0.5]]) {
      const handle = page.getByRole("separator", { name: `Resize ${side} panel` });
      const sidePane = pane(page, side);
      await expect.poll(async () => Number(await handle.getAttribute("aria-valuenow"))).toBe(await width(sidePane));
      const maximum = Math.min(960, Math.round(gridWidth * fraction));
      await expect(handle).toHaveAttribute("aria-valuemax", String(maximum));
      await expect(handle).toHaveAttribute("aria-valuemin", String(Math.min(minimum, maximum)));
    }
  }
});

test("the home page puts Start a project above the list as a band that folds, keeps a typed name and remembers the fold", async ({ page }) => {
  await page.goto(`${home}?entry=generate`, { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.removeItem("three-pane-top:home"));
  await page.reload({ waitUntil: "networkidle" });
  const band = page.locator('[data-testid="three-pane-left"][data-left-placement="top"]');
  await expect(band).toHaveCount(1);
  // Above Projects and Overview, which stay side by side below it.
  const projects = page.getByRole("heading", { name: "Projects" });
  const overview = page.getByRole("heading", { name: "Overview" });
  expect((await band.boundingBox()).y + (await band.boundingBox()).height).toBeLessThanOrEqual((await projects.boundingBox()).y);
  expect(Math.abs((await projects.boundingBox()).y - (await overview.boundingBox()).y)).toBeLessThanOrEqual(2);

  const input = page.getByLabel("Project name");
  await input.fill("Keep this unfinished project");
  await page.getByRole("button", { name: "Hide start a project" }).click();
  await expect(input).toBeAttached();
  await expect(input).toBeHidden();
  await page.getByRole("button", { name: "Show start a project" }).click();
  await expect(input).toHaveValue("Keep this unfinished project");

  // The fold is remembered across a reload.
  await page.getByRole("button", { name: "Hide start a project" }).click();
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByRole("button", { name: "Show start a project" })).toBeVisible();
  await page.getByRole("button", { name: "Show start a project" }).click();

  // The two starting points sit side by side on a wide window.
  await page.goto(home, { waitUntil: "networkidle" });
  const generate = page.locator('a[href="/?entry=generate"]');
  const validate = page.locator('a[href="/?entry=validate"]');
  expect(Math.abs((await generate.boundingBox()).y - (await validate.boundingBox()).y)).toBeLessThanOrEqual(2);
});
