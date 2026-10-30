// Control for the smoke helper's server-action wait (Codex review of batches 54 to 65, 28 October 2026).
// The smoke failed because `viaServerAction` returned on any server action's response headers, so a
// background read could end the wait while the rejection was still being written, and the reload
// showed the finding as accepted. Here, on the disposable stack:
//   - the rejection's request is held back for three seconds before it reaches the server;
//   - while it is held, another server action (one the page itself sent earlier, replayed) answers;
//   - the adapter's rejectFinding must still wait for the rejection's own response to finish before
//     it reloads, so the reload shows the finding rejected and the database holds it rejected.
// With the old wait, the decoy's answer ends the wait, the reload cancels the held rejection, and the
// check fails on the reloaded status.
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
if (target.disposable !== true) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
const FIXTURE = path.resolve("fixtures/golden-thread-1");

test("the smoke helper waits for the clicked action's own response, not another action's", async ({ page }, testInfo) => {
  test.setTimeout(10 * 60_000);
  const db = new pg.Client({ connectionString: target.databaseUrlWithoutCredentials.replace("postgres://", "postgres://postgres@") });
  await db.connect();
  try {
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const run = await ui.createRun({ name: `action-wait-${Date.now()}` });
    await ui.upload(run, path.join(FIXTURE, "golden-survey-documented.xlsx"), "table");
    await ui.expectReadyOrActionableRecovery(run);
    const table = await ui.buildPurchaseCrosstab(run);
    const finding = await ui.postAndAcceptFinding(table);

    // A server action the page sent with plain arguments and that is not about this finding: the decoy.
    let decoy = null;
    page.on("request", (r) => {
      const body = r.postData() ?? "";
      if (!decoy && r.method() === "POST" && r.headers()["next-action"] && !body.includes(finding.id) && body.startsWith("[")) {
        decoy = { url: r.url(), action: r.headers()["next-action"], tree: r.headers()["next-router-state-tree"], body };
      }
    });
    await page.reload({ waitUntil: "networkidle" });
    await expect.poll(() => decoy !== null, { timeout: 60_000 }).toBe(true);

    const events = [];
    // The decoy goes to the same page with "?decoy=1", which the interception below leaves alone: an
    // intercepted request cannot wait on another intercepted request without the two waiting on each other.
    const decoyUrl = new URL(decoy.url);
    decoyUrl.searchParams.set("decoy", "1");
    let decoyAnswered;
    const decoyDone = new Promise((resolve) => (decoyAnswered = resolve));
    page.on("response", (r) => {
      if (r.url() === decoyUrl.href && r.request().headers()["next-action"]) decoyAnswered();
    });
    await page.route((url) => !url.searchParams.has("decoy"), async (route) => {
      const r = route.request();
      const isRejection = r.method() === "POST" && r.headers()["next-action"] && (r.postData() ?? "").includes(finding.id) && (r.postData() ?? "").includes("rejected");
      if (!isRejection) return route.continue();
      events.push("rejection held");
      // While the rejection is held, the decoy action is sent from the page and answered.
      page
        .evaluate(async (d) => {
          const headers = { "next-action": d.action, "content-type": "text/plain;charset=UTF-8", accept: "text/x-component" };
          if (d.tree) headers["next-router-state-tree"] = d.tree;
          await (await fetch(d.url, { method: "POST", headers, body: d.body })).text();
        }, { ...decoy, url: decoyUrl.href })
        .catch(() => {});
      const answered = await Promise.race([decoyDone.then(() => true), new Promise((r) => setTimeout(() => r(false), 30_000))]);
      events.push(answered ? "decoy answered" : "decoy not answered in 30 s");
      await new Promise((r) => setTimeout(r, 3_000));
      events.push("rejection released");
      // With the old wait the page has already reloaded, which cancels the held request.
      await route.continue().catch(() => events.push("rejection cancelled by the reload"));
    });
    // The rejection is done when its whole response has arrived, or when Next aborted its own read after the
    // response came (the same rule as the adapter's wait).
    const isRejectionRequest = (r) => r.method() === "POST" && (r.postData() ?? "").includes(finding.id) && (r.postData() ?? "").includes("rejected");
    page.on("requestfinished", (r) => {
      if (isRejectionRequest(r)) events.push("rejection finished");
    });
    page.on("requestfailed", async (r) => {
      if (isRejectionRequest(r) && (await r.response())) events.push("rejection finished");
    });
    page.on("request", (r) => {
      if (r.isNavigationRequest() && r.method() === "GET" && events.includes("rejection held")) events.push("reload");
    });

    await ui.rejectFinding(finding);

    expect(events.slice(0, 4)).toEqual(["rejection held", "decoy answered", "rejection released", "rejection finished"]);
    expect(events.indexOf("rejection finished")).toBeLessThan(events.indexOf("reload"));
    const rows = (await db.query("select status from findings where id = $1 and run_id = $2", [finding.id, run.id])).rows;
    expect(rows).toEqual([{ status: "rejected" }]);
  } finally {
    if (!page.isClosed()) await page.unrouteAll({ behavior: "ignoreErrors" });
    await db.end();
  }
});
