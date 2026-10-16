// UI regression check for the adjustable three-pane layout (src/app/runs/[id]/ThreePane.tsx), in a real
// browser against the disposable local stack, on the home page (Start a project / Projects / Overview).
//   - default widths are the original fixed ones (left 22rem)
//   - dragging a handle resizes that pane, within its limits, and the width survives a reload
//   - the arrow keys move a focused handle; a double-click resets the default width
//   - collapsing the left pane keeps it mounted but hidden, survives a reload, and expands again
//   - on a narrow window the panes stack and no handles are shown
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
if (target.disposable !== true) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
const home = new URL("/", target.appUrl).href;

const width = async (locator) => Math.round((await locator.boundingBox()).width);

test.use({ viewport: { width: 1440, height: 900 } });

test("side panes resize by drag and keyboard, remember their width, reset, and the left pane collapses", async ({ page }) => {
  await page.goto(home, { waitUntil: "networkidle" });
  const left = page.getByTestId("three-pane-left");
  const right = page.getByTestId("three-pane-right");
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
  const layoutWidth = await width(page.getByTestId("three-pane"));
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
  expect(await width(page.locator('[data-testid="three-pane"] > div').nth(2))).toBeGreaterThan(300);

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
  await expect(page.getByTestId("three-pane")).toHaveAttribute("data-left-collapsed", "true");
  // Hidden but still in the page (role queries skip hidden elements, so match the element itself).
  const leftTitle = page.getByTestId("three-pane-left").locator("h3", { hasText: "Start a project" });
  await expect(leftTitle).toBeAttached();
  await expect(leftTitle).toBeHidden();
  expect(await width(left)).toBe(44);
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByRole("button", { name: "Expand left panel" })).toBeVisible();
  await page.getByRole("button", { name: "Expand left panel" }).click();
  await expect(page.getByRole("heading", { name: "Start a project" })).toBeVisible();
  expect(await width(left)).toBe(352);
});

test("on a narrow window the panes stack and show no handles", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await page.goto(home, { waitUntil: "networkidle" });
  await expect(page.getByRole("separator")).toHaveCount(0);
  const grid = await width(page.getByTestId("three-pane"));
  expect(Math.abs((await width(page.getByTestId("three-pane-left"))) - grid)).toBeLessThanOrEqual(1);
  await expect(page.getByRole("button", { name: "Collapse left panel" })).toBeHidden();
});
