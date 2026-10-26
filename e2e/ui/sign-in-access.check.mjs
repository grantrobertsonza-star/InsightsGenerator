// G6: sign-in and organisation access, in a real browser on the disposable stack (production
// build), against the stack's Supabase Auth stand-in and three synthetic accounts: a member of the
// synthetic tenant, a member of a second synthetic tenant, and an account with no organisation.
//   1. Signed out: a page redirects to the sign-in page (keeping the destination), and a download
//      route answers 401 with no attachment.
//   2. A wrong password shows an error and sets no session; the right one lands on the original
//      destination, and the account panel names the organisation.
//   3. Another organisation's member opening the first member's project URL gets "not found",
//      sees none of its data, and its export route returns no content from it.
//   4. An account with no organisation sees only the explanation page; its download is 403.
//   5. Sign out returns to the sign-in page and the old session no longer opens the project.
//   6. With the Auth service down, a signed-in page shows an error rather than the sign-in form
//      (an outage is never treated as being signed out).
import { expect, test } from "@playwright/test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
const dbUrl = new URL(target.databaseUrlWithoutCredentials);
if (target.disposable !== true || !/^\/ie_e2e_[a-f0-9]{10}$/.test(dbUrl.pathname)) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
if (!target.credentialsFile || !existsSync(target.credentialsFile)) throw new Error("This stack has no sign-in accounts (start it with the G6 local-stack).");
const creds = JSON.parse(readFileSync(target.credentialsFile, "utf8"));
const origin = target.appUrl;

test("sign-in, organisation scoping and sign-out", async ({ browser, page }, testInfo) => {
  test.setTimeout(10 * 60_000);
  // A project owned by the primary account (this page starts signed in from the stack's state).
  const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
  const ui = await bind({ page, target, testInfo });
  const run = await ui.createRun({ name: `access-${Date.now()}` });
  await expect(page.getByTestId("account-organisation")).toHaveText("Synthetic e2e tenant");

  // 1. signed out
  const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const ap = await anon.newPage();
  await ap.goto(run.url);
  await expect(ap).toHaveURL(new RegExp(`/login\\?next=${encodeURIComponent(new URL(run.url).pathname).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  const anonExport = await ap.request.get(`${origin}/api/runs/${run.id}/findings/export`);
  expect(anonExport.status()).toBe(401);
  expect(anonExport.headers()["content-disposition"]).toBeUndefined();

  // 2. wrong then right password, landing on the original destination
  await ap.getByLabel("Email").fill(creds.primary.email);
  await ap.getByLabel("Password").fill("not-the-password");
  await ap.getByRole("button", { name: "Sign in" }).click();
  await expect(ap.locator('form[aria-label="Sign in"] [role="alert"]')).toHaveText("The email or password is not correct.");
  expect((await anon.cookies()).some((c) => c.name === "ie-access")).toBe(false);
  await ap.getByLabel("Password").fill(creds.primary.password);
  await ap.getByRole("button", { name: "Sign in" }).click();
  await expect(ap).toHaveURL(run.url);
  await expect(ap.getByTestId("account-organisation")).toHaveText("Synthetic e2e tenant");

  // 3. another organisation cannot open or export this project
  const other = await browser.newContext({ storageState: target.otherAuthStateFile });
  const op = await other.newPage();
  const resp = await op.goto(run.url);
  expect(resp.status()).toBe(404);
  await expect(op.getByText(run.name ?? "access-", { exact: false })).toHaveCount(0);
  await op.goto(origin);
  await expect(op.getByTestId("account-organisation")).toHaveText("Second synthetic tenant");
  await expect(op.getByText(/^access-\d+/)).toHaveCount(0);
  const otherExport = await op.request.get(`${origin}/api/runs/${run.id}/findings/export`);
  const body = await otherExport.body();
  expect(body.includes(Buffer.from(run.id))).toBe(false);
  const progress = await op.request.get(`${origin}/api/runs/${run.id}/process-progress`);
  expect(progress.status()).toBe(404);

  // 4. an account without an organisation
  const none = await browser.newContext({ storageState: target.unassignedAuthStateFile });
  const np = await none.newPage();
  await np.goto(origin);
  await expect(np).toHaveURL(`${origin}/no-organisation`);
  await expect(np.getByRole("heading", { name: "No organisation yet" })).toBeVisible();
  expect((await np.request.get(`${origin}/api/runs/${run.id}/findings/export`)).status()).toBe(403);

  // 5. sign out, then the old session cookie no longer works
  const oldCookies = await anon.cookies();
  await ap.getByRole("button", { name: "Sign out" }).click();
  await expect(ap).toHaveURL(/\/login$/);
  const replay = await browser.newContext({ storageState: { cookies: oldCookies.filter((c) => c.name === "ie-access"), origins: [] } });
  const rp = await replay.newPage();
  await rp.goto(run.url);
  await expect(rp).toHaveURL(/\/login/);

  // 6. Auth outage is an error, not a sign-out
  writeFileSync(target.authFaultFile, JSON.stringify({ down: true }));
  try {
    const out = await page.goto(run.url);
    expect(out.status()).toBeGreaterThanOrEqual(500);
    await expect(page).not.toHaveURL(/\/login/);
  } finally {
    rmSync(target.authFaultFile, { force: true });
  }
  await page.goto(run.url);
  await expect(page.getByTestId("account-organisation")).toHaveText("Synthetic e2e tenant");
  for (const c of [anon, other, none, replay]) await c.close();
});

// Codex 2026-10-18 (ed3e980), retained: a sign-in destination that a browser resolves to another
// host must not be followed. Every request leaving the app is blocked before dispatch, so nothing
// is ever sent to the external host; the assertion is on attempted top-level navigations.
for (const [label, next, expectedPath] of [
  ["in-app destination", "/programs?view=all", "/programs?view=all"],
  ["tab path", "/\t/evil.example/", "/"],
  ["newline path", "/\n/evil.example/", "/"],
  ["carriage-return path", "/\r/evil.example/", "/"],
  ["backslash path", "/\\evil.example/", "/"],
  ["protocol-relative", "//evil.example/", "/"],
  ["absolute external", "https://evil.example/", "/"],
]) {
  test(`after sign-in, next: ${label}`, async ({ browser }) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    const externalNavigations = [];
    await page.route("**/*", (route) => {
      const request = route.request();
      if (new URL(request.url()).origin !== new URL(origin).origin) {
        if (request.isNavigationRequest()) externalNavigations.push(request.url());
        return route.abort();
      }
      return route.continue();
    });
    try {
      await page.goto(`${origin}/login?next=${encodeURIComponent(next)}`);
      await page.getByLabel("Email", { exact: true }).fill(creds.primary.email);
      await page.getByLabel("Password", { exact: true }).fill(creds.primary.password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page.waitForURL((url) => url.pathname !== "/login");
      await page.waitForLoadState("load");
      expect(externalNavigations).toEqual([]);
      const landed = new URL(page.url());
      expect(landed.origin).toBe(new URL(origin).origin);
      expect(landed.pathname + landed.search).toBe(expectedPath);
    } finally {
      await context.close();
    }
  });
}

// Codex 2026-10-18 (ed3e980), retained: with the access cookie gone and only the refresh cookie
// left, an Auth outage must read as "unavailable", not "signed out", keep the cookies, and recover
// in the same organisation once Auth is back. Controls: a full session during the outage, and a
// rejected refresh token, which is a genuine sign-out.
test("refresh-only session during an Auth outage stays unavailable, then recovers", async ({ browser }) => {
  // This check signs in for its own session: the stack's stored session is shared with other
  // checks, and refresh tokens are single-use, so another check renewing it would spend the token
  // this one depends on.
  const own = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const login = await own.newPage();
  await login.goto(`${origin}/login`);
  await login.getByLabel("Email", { exact: true }).fill(creds.primary.email);
  await login.getByLabel("Password", { exact: true }).fill(creds.primary.password);
  await login.getByRole("button", { name: "Sign in", exact: true }).click();
  await login.waitForURL((url) => url.pathname !== "/login");
  const state = await own.storageState();
  await own.close();
  const full = await browser.newContext({ storageState: JSON.parse(readFileSync(target.authStateFile, "utf8")) });
  const refreshOnly = await browser.newContext({ storageState: { ...state, cookies: state.cookies.filter((c) => c.name !== "ie-access") } });
  try {
    expect((await full.request.get(`${origin}/api/runs`)).status()).toBe(200);
    writeFileSync(target.authFaultFile, JSON.stringify({ down: true }));
    try {
      expect((await full.request.get(`${origin}/api/runs`)).status()).toBe(503);
      expect((await refreshOnly.request.get(`${origin}/api/runs`)).status(), "refresh outage must not read as signed out").toBe(503);
      const page = await refreshOnly.newPage();
      const shown = await page.goto(`${origin}/programs`);
      expect(shown.status()).toBeGreaterThanOrEqual(500);
      await expect(page).not.toHaveURL(/\/login/);
      expect((await refreshOnly.cookies()).map((c) => c.name)).toContain("ie-refresh");
      await page.close();
    } finally {
      rmSync(target.authFaultFile, { force: true });
    }
    expect((await refreshOnly.request.get(`${origin}/api/runs`)).status()).toBe(200);
    const page = await refreshOnly.newPage();
    await page.goto(`${origin}/programs`);
    await expect(page.getByTestId("account-organisation")).toHaveText("Synthetic e2e tenant");
    await page.close();
  } finally {
    await full.close();
    await refreshOnly.close();
  }
  const revoked = await browser.newContext({
    storageState: { cookies: state.cookies.filter((c) => c.name !== "ie-access").map((c) => (c.name === "ie-refresh" ? { ...c, value: "revoked-refresh-token" } : c)), origins: [] },
  });
  try {
    expect((await revoked.request.get(`${origin}/api/runs`)).status()).toBe(401);
  } finally {
    await revoked.close();
  }
});
