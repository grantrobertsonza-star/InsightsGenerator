// Regression check: a data file's set-up choice made while the page is still loading must not be
// silently dropped.
//
// The defect: the set-up dropdowns are server-rendered, so they appear before React attaches its
// handlers. A layout chosen in that gap showed on screen, was never saved, and was put back to
// "rows are cases" once the page finished loading, with no message. The fix holds the controls
// (disabled, with a "Loading" note) until the page is ready (src/app/useHydrated.ts).
//
// What this checks, in a real browser against the disposable local stack (real PostgreSQL through
// the restricted app role; storage and model are the stack's local stand-ins, not used here):
//   1. while the page's scripts are held back, the layout control is disabled and the note is there
//      (both in the server render; since 2026-10-20 they sit in the Setup tab, which opens only once
//      the scripts run, so here they are checked as rendered rather than as seen)
//   2. once loaded, the control is enabled and the note is gone
//   3. a layout chosen then is saved: it survives a reload
// Scripts are held back by delaying the app's JavaScript chunks, which widens the loading gap that
// a slow connection produces.
//
// Not covered here: the transcript set-up row, which uses the same hook but needs a transcript
// import to render.
import { expect, test } from "@playwright/test";
import { addFiles } from "./helpers/addFiles.mjs";
import { openSourceTab, selectSource } from "./helpers/sources.mjs";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
if (target.disposable !== true) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
const appUrl = new URL(target.appUrl);

// Variables in rows, one column per case: the file that needs the non-default layout.
const WIDE_CSV = ["Variable,R1,R2,R3,R4", "ID,001,002,003,004", "Gender,1,2,1,2", "Score,5,4,3,5"].join("\n");

// Opens the Import data panel and waits until `ready` (something inside it) is present. A single
// visibility probe straight after navigation could run before the section button rendered, skip
// the click, and leave the check waiting five minutes for a panel that was never opened (Codex's
// retained trace, 2026-10-17). Here the button is clicked only while `ready` is absent, and the
// attempt repeats until it appears or the timeout passes.
async function openImport(page, ready) {
  const button = page.getByRole("button", { name: /Import data/ }).first();
  await expect(async () => {
    if ((await ready.count()) === 0) {
      await button.click({ timeout: 5_000 });
      await expect(ready.first()).toBeAttached({ timeout: 5_000 });
    }
  }).toPass({ timeout: 90_000 });
}

test("a layout chosen while the page loads is held, and one chosen after loading is saved", async ({ page }) => {
  await page.goto(appUrl.href, { waitUntil: "networkidle" });
  await page.locator('a[href="/?entry=generate"]').click();
  await page.getByLabel("Project name").fill(`Layout hydration check ${Date.now()}`);
  await page.getByRole("button", { name: "Create project", exact: true }).click();
  await page.waitForURL(/\/runs\/[0-9a-f-]{36}/);
  const runUrl = page.url();

  const dir = mkdtempSync(path.join(tmpdir(), "layout-check-"));
  const file = path.join(dir, "wide-layout.csv");
  writeFileSync(file, WIDE_CSV);
  await openImport(page, page.getByRole("button", { name: "Add files", exact: true }));
  await addFiles(page, file, "Raw data");
  const layout = () => page.getByLabel(/How the file is laid out: wide-layout\.csv/);
  const setup = async () => {
    await selectSource(page, "wide-layout.csv");
    await openSourceTab(page, "Setup");
  };
  await setup();
  await expect(layout()).toBeVisible({ timeout: 60_000 });
  // The first-view "accept with defaults" save has landed once the source says Accepted.
  const status = page.getByTestId("source-acceptance");
  await expect(status).toHaveText("Setup: Accepted", { timeout: 60_000 });

  // 1. Reload with the app's scripts held back: the server-rendered control must be held.
  let release;
  const held = new Promise((resolve) => (release = resolve));
  await page.route(/\/_next\/static\/chunks\//, async (route) => {
    await held;
    await route.continue().catch(() => {});
  });
  // The Import section by its link (a project opens on its overview), rendered on the server, so the
  // control is there before the scripts load.
  await page.goto(`${runUrl}?section=upload`, { waitUntil: "commit" });
  await expect(layout()).toBeAttached({ timeout: 60_000 });
  await expect(layout()).toBeDisabled();
  await expect(page.getByTestId("setup-loading").first()).toBeAttached();

  // 2. Let the scripts through: the control becomes usable and the note goes.
  release();
  await page.unrouteAll({ behavior: "wait" });
  await setup();
  await expect(layout()).toBeEnabled({ timeout: 60_000 });
  await expect(page.getByTestId("setup-loading")).toHaveCount(0);

  // 3. A choice made now is saved: wait for the server action's response, then reload.
  const saved = page.waitForResponse((r) => r.request().method() === "POST" && !!r.request().headers()["next-action"]);
  await layout().selectOption("columns_are_cases");
  expect((await saved).status()).toBe(200);
  await expect(status).toHaveText("Setup: Needs review", { timeout: 60_000 });
  await page.reload({ waitUntil: "networkidle" });
  await openImport(page, layout());
  await setup();
  await expect(layout()).toHaveValue("columns_are_cases", { timeout: 60_000 });
});
