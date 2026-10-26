// The public landing page (public/home.html, served at /home), in a real browser on the disposable stack.
//   - a signed-out visitor sees the landing page at /home rather than being sent to sign in;
//   - its "Sign in" button leads into the app ("/"), which for a signed-out visitor is the sign-in page;
//   - signed in, the main menu lists "Home" directly above "Dashboard", in the full menu and the strip,
//     and following it opens the landing page, whose "Sign in" returns to the dashboard.
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
if (target.disposable !== true) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
const at = (p) => new URL(p, target.appUrl).href;
const shot = process.env.SHOT;

test.use({ viewport: { width: 1440, height: 900 } });

test("a signed-out visitor sees the landing page, and its Sign in leads into the app", async ({ browser }) => {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  const response = await page.goto(at("/home"), { waitUntil: "networkidle" });
  expect(response.status()).toBe(200);
  expect(new URL(page.url()).pathname).toBe("/home");
  const signIn = page.getByRole("link", { name: "Sign in" }).first();
  await expect(signIn).toBeVisible();
  await expect(signIn).toHaveAttribute("href", "/");
  if (shot) await page.screenshot({ path: shot.replace(/\.png$/, "-landing.png") });
  await signIn.click();
  await page.waitForURL((url) => url.pathname === "/login");
  await context.close();
});

test("signed in, Home sits above Dashboard and opens the landing page", async ({ page }, testInfo) => {
  test.setTimeout(3 * 60_000);
  const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
  await bind({ page, target, testInfo });
  await page.goto(at("/"), { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.removeItem("global-rail:collapsed"));
  await page.reload({ waitUntil: "networkidle" });

  const menu = page.locator("#global-rail-content nav").first();
  const names = await menu.getByRole("link").allInnerTexts();
  expect(names.map((n) => n.trim()).slice(0, 2)).toEqual(["Home", "Dashboard"]);
  await expect(menu.getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");
  await expect(menu.locator('[aria-current="page"]')).toHaveCount(1);
  if (shot) await page.screenshot({ path: shot.replace(/\.png$/, "-menu.png"), clip: { x: 0, y: 0, width: 520, height: 420 } });

  // The collapsed strip carries the same item, also first.
  await page.getByRole("button", { name: "Hide main menu" }).click();
  const strip = page.getByTestId("global-rail-icons").getByRole("navigation", { name: "Main" });
  await expect(strip.getByRole("link").first()).toHaveAttribute("aria-label", "Home");
  await page.getByRole("button", { name: "Show main menu" }).click();

  await menu.getByRole("link", { name: "Home" }).click();
  await page.waitForURL((url) => url.pathname === "/home");
  await expect(page.getByRole("link", { name: "Sign in" }).first()).toBeVisible();
  await page.getByRole("link", { name: "Sign in" }).first().click();
  await page.waitForURL((url) => url.pathname === "/");
  await expect(page.locator("#global-rail-content").getByRole("link", { name: "Dashboard" })).toBeVisible();
});

test("moving between menu items marks only the page you are on, and nothing inside a project", async ({ page }, testInfo) => {
  test.setTimeout(3 * 60_000);
  const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
  const ui = await bind({ page, target, testInfo });
  const run = await ui.createRun({ name: `menu-current-${Date.now()}` });
  const menu = page.locator("#global-rail-content nav").first();
  const current = menu.locator('[aria-current="page"]');
  await page.goto(at("/"), { waitUntil: "networkidle" });
  for (const name of ["Programs", "Knowledge base", "Manual", "Dashboard"]) {
    await menu.getByRole("link", { name }).click();
    await expect(current).toHaveCount(1);
    await expect(current).toHaveText(name);
  }
  // Inside a project: Dashboard is not marked; the project section shows where you are.
  await page.goto(run.url, { waitUntil: "networkidle" });
  await expect(menu.getByRole("link", { name: "Dashboard" })).toBeVisible();
  await expect(current).toHaveCount(0);
  // Away from the menu, so a hover colour is not mistaken for the current-page colour.
  await page.mouse.move(900, 600);
  await expect(menu.getByRole("link", { name: "Dashboard" })).not.toHaveClass(/bg-primary-light/);
  // The hover colour fades out over 150 ms; let it finish so the picture shows the resting state.
  if (shot) await page.waitForTimeout(400);
  if (shot) await page.screenshot({ path: shot.replace(/\.png$/, "-in-project.png"), clip: { x: 0, y: 0, width: 520, height: 520 } });
});
