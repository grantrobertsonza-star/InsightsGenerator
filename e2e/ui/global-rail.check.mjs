// The left rail hides and shows (src/components/CollapsibleRail.tsx), in a real browser on the
// disposable stack.
//   - "Hide main menu" shrinks the rail to a narrow strip of icons and gives the content the space;
//   - on a run page the section list is hidden but stays in the page, and works again once shown;
//   - the choice survives a reload and navigation, and "Show main menu" restores the rail;
//   - with storage blocked the toggle still works in the page and a reload shows the open rail.
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
if (target.disposable !== true) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
const home = new URL("/", target.appUrl).href;
const width = async (locator) => Math.round((await locator.boundingBox()).width);

test.use({ viewport: { width: 1440, height: 900 } });

test("the main menu hides to a strip, keeps a run's section list, and is remembered", async ({ page }, testInfo) => {
  test.setTimeout(5 * 60_000);
  const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
  const ui = await bind({ page, target, testInfo });
  const run = await ui.createRun({ name: `global-rail-${Date.now()}` });
  await page.goto(run.url, { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.removeItem("global-rail:collapsed"));
  await page.reload({ waitUntil: "networkidle" });

  const rail = page.getByTestId("global-rail");
  // The rail sits in a wrapper that keeps its strip width on a narrow window; the page follows it.
  const content = rail.locator("xpath=../following-sibling::div[1]");
  const sectionButton = page.locator("#run-nav-slot button", { hasText: "Research quality" });
  await expect(rail).toHaveAttribute("data-collapsed", "false");
  expect(await width(rail)).toBe(224);
  await expect(sectionButton).toBeVisible();
  const contentBefore = await width(content);

  const hide = page.getByRole("button", { name: "Hide main menu" });
  await expect(hide).toHaveAttribute("aria-expanded", "true");
  await hide.click();
  await expect(rail).toHaveAttribute("data-collapsed", "true");
  expect(await width(rail)).toBe(48);
  expect(await width(content)).toBe(contentBefore + 176);
  // Hidden but still mounted: the run's section list keeps its place in the page.
  await expect(sectionButton).toBeAttached();
  await expect(sectionButton).toBeHidden();
  // The full menu is hidden; the strip shows an icon for each destination and each project section
  // instead (2026-10-20), each named for assistive technology, with the current section marked.
  await expect(page.locator("#global-rail-content").getByRole("link", { name: "Dashboard" })).toBeHidden();
  const icons = page.getByTestId("global-rail-icons");
  await expect(icons.getByRole("link", { name: "Dashboard" })).toBeVisible();
  await expect(icons.getByRole("button", { name: "Research quality" })).toBeVisible();
  await expect(icons.getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("run-nav-rail").locator('button[aria-current="page"]')).toHaveCount(1);

  // Remembered across a reload and across pages.
  await page.reload({ waitUntil: "networkidle" });
  await expect(rail).toHaveAttribute("data-collapsed", "true");
  await page.goto(new URL("/manual", target.appUrl).href, { waitUntil: "networkidle" });
  await expect(page.getByTestId("global-rail")).toHaveAttribute("data-collapsed", "true");
  await page.goto(run.url, { waitUntil: "networkidle" });

  const show = page.getByRole("button", { name: "Show main menu" });
  await expect(show).toHaveAttribute("aria-expanded", "false");
  // Keyboard works: focus and Enter.
  await show.focus();
  await page.keyboard.press("Enter");
  await expect(rail).toHaveAttribute("data-collapsed", "false");
  expect(await width(rail)).toBe(224);
  await expect(page.getByTestId("account-panel")).toBeVisible();
  // The section list works again once shown.
  await sectionButton.click();
  await expect(page.getByTestId("research-quality")).toBeVisible({ timeout: 60_000 });
  await page.reload({ waitUntil: "networkidle" });
  await expect(rail).toHaveAttribute("data-collapsed", "false");
});

test("with storage blocked the menu still hides and shows, and a reload shows it open", async ({ page }) => {
  await page.addInitScript(() => {
    for (const method of ["getItem", "setItem"]) Storage.prototype[method] = () => { throw new DOMException("Blocked site data", "SecurityError"); };
  });
  await page.goto(home, { waitUntil: "networkidle" });
  const rail = page.getByTestId("global-rail");
  await page.getByRole("button", { name: "Hide main menu" }).click();
  await expect(rail).toHaveAttribute("data-collapsed", "true");
  await page.getByRole("button", { name: "Show main menu" }).click();
  await expect(rail).toHaveAttribute("data-collapsed", "false");
  await page.getByRole("button", { name: "Hide main menu" }).click();
  await page.reload({ waitUntil: "networkidle" });
  await expect(rail).toHaveAttribute("data-collapsed", "false");
});
