// Import data file list: the upload date renders the same on the server and in the browser, so a
// browser whose locale or time zone differs from the server's gets no hydration mismatch. Before
// the fix, FileCell used toLocaleDateString() with no locale or zone: a server in one locale wrote
// "2026/10/16" and a browser in another expected "10/16/2026", and React threw the server text
// away and rebuilt the tree (Codex observation, overnight review 2026-10-16).
// Real browser on the disposable stack. The browser runs as en-US in Pacific/Kiritimati (UTC+14),
// which differs from the stack's server locale and zone in both format and, for most of the day,
// calendar date. One synthetic CSV is uploaded.
//   1. The row shows the upload date as the fixed format ("16 Oct 2026", UTC), the same text the
//      server rendered, and the full UTC timestamp in its title.
//   2. No hydration error is reported in the console while the page loads and the panel opens.
import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
const dbUrl = new URL(target.databaseUrlWithoutCredentials);
if (target.disposable !== true || !/^\/ie_e2e_[a-f0-9]{10}$/.test(dbUrl.pathname)) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
const HYDRATION = /hydrat|Minified React error #4(18|19|23|25)/i;

test.use({ locale: "en-US", timezoneId: "Pacific/Kiritimati" });

test("the upload date renders identically on server and browser in a different locale and zone", async ({ page }, testInfo) => {
  const db = new pg.Client({ connectionString: target.databaseUrlWithoutCredentials.replace("postgres://", "postgres://postgres@") });
  await db.connect();
  try {
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const run = await ui.createRun({ name: `upload-date-${Date.now()}` });
    const file = path.join(mkdtempSync(path.join(tmpdir(), "upload-date-")), "dated.csv");
    writeFileSync(file, ["Gender,Purchase", ...Array.from({ length: 10 }, (_, i) => `${i % 2 ? "Male" : "Female"},Yes`)].join("\n"));
    await ui.upload(run, file, "table");
    const uploaded = (await db.query("select uploaded_at from documents where run_id=$1", [run.id])).rows[0].uploaded_at;
    const expected = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(uploaded);

    const errors = [];
    page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && HYDRATION.test(m.text()) && errors.push(m.text().slice(0, 400)));
    page.on("pageerror", (e) => HYDRATION.test(String(e)) && errors.push(String(e).slice(0, 400)));
    await page.goto(run.url, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^Import data/ }).first().click();
    const row = page.getByText("dated.csv", { exact: true }).first().locator("xpath=..");
    await expect.soft(row).toContainText(expected, { timeout: 60_000 });
    await page.goto(run.url, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^Import data/ }).first().click();
    await expect.soft(page.getByText("dated.csv", { exact: true }).first().locator("xpath=..")).toContainText(expected, { timeout: 60_000 });
    await page.waitForTimeout(1_500);
    expect(errors, "hydration errors").toEqual([]);
  } finally {
    await db.end();
  }
});
