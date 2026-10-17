// GT-007 (authorised by Grant, 2026-10-17): the main Recommendations list's own Excel and Slides
// exports, through the native controls, on the disposable stack with model replay.
// The project is built through the real controls (upload, decision, Purchase table, accepted
// finding, independent evidence, synthesis, a researcher-written recommendation). To make the list
// mixed, three AI recommendations are then INSERTED into the disposable database as fixture rows
// (the replay model's own drafting is not what is under test): one written for earlier decisions
// (accepted), one with no decision record (pending, then rejected through its Reject button), one
// for the current decisions on the insight that rests on the finding (accepted). Checked:
//   1. the original GT-007 case: the main list has its own Excel and Slides controls, and the
//      researcher's recommendation is in their files (it used to reach only the narrative);
//   2. screen = screen after a full reload, per recommendation id: status, support, decisions;
//   3. the downloaded Excel (all, accepted) and rendered Slides (all, accepted) agree with the screen
//      and the database: exact wording, status, support and decision wording, scope respected;
//   4. after the finding is rejected, the affected recommendation reads "no longer valid" on screen,
//      in Excel, and is left out of the accepted Slides and listed with its reason;
//   5. a download that fails (a real server error, injected by renaming a table in the disposable
//      database): the browser reports it and the page stays (the links are downloads, not
//      navigations); a retry gives one good file; no recommendation changed.
import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import pg from "pg";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");
const manifestPath = process.env.GOLDEN_SMOKE_TARGET_MANIFEST ?? "e2e-results/target-manifest.json";
const target = JSON.parse(readFileSync(manifestPath, "utf8"));
const dbUrl = new URL(target.databaseUrlWithoutCredentials);
if (target.disposable !== true || !/^\/ie_e2e_[a-f0-9]{10}$/.test(dbUrl.pathname)) throw new Error(`${manifestPath} does not describe a disposable stack; refusing to run.`);
const WORKBOOK = path.resolve("fixtures/golden-thread-1/golden-survey-documented.xlsx");
const squash = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const SUPPORT_WORDS = { current: /^Support current$/, invalid: /^Support no longer valid/, stale: /^Support changed since drafted/, unknown: /^Support not checked/ };
const DECISION_WORDS = { earlier: /^Written for earlier decisions/, unknown: /^Not recorded/ };

test("GT-007 main Recommendations list: native Excel and Slides exports agree with the screen, reload and database", async ({ page }, testInfo) => {
  test.setTimeout(30 * 60_000);
  const db = new pg.Client({ connectionString: target.databaseUrlWithoutCredentials.replace("postgres://", "postgres://postgres@") });
  await db.connect();
  const obs = {};
  try {
    const { bind } = await import(pathToFileURL(path.resolve("e2e/adapter/golden-thread-adapter.mjs")).href);
    const ui = await bind({ page, target, testInfo });
    const run = await ui.createRun({ name: `main-recs-${Date.now()}` });
    await ui.upload(run, WORKBOOK, "table");
    await ui.expectReadyOrActionableRecovery(run);
    await page.goto(run.url, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^Business decisions/ }).first().click();
    const form = page.locator("form", { has: page.getByRole("button", { name: "Add decision" }) });
    const decision = "Decide whether to prioritise the male segment next quarter";
    await form.locator("textarea").fill(decision);
    await form.getByRole("button", { name: "Add decision" }).click();
    await expect.poll(async () => (await db.query("select decision_statement from runs where id=$1", [run.id])).rows[0].decision_statement, { timeout: 120_000 }).toBe(decision);
    const table = await ui.buildPurchaseCrosstab(run);
    const finding = await ui.postAndAcceptFinding(table);
    await ui.addIndependentEvidence(run);
    await ui.generateOrLoadInsight(run, finding);
    const humanText = "Researcher action: brief the campaign owner on the purchase gap between groups.";
    const human = await ui.addEligibleHumanRecommendation(run, { independentOf: finding, text: humanText });

    // Fixture rows (see the file comment).
    const insights = (await db.query("select si.id, exists(select 1 from synthesized_insight_sources s join insights p on p.id=s.pre_insight_id where s.synthesized_insight_id=si.id and p.finding_id=$2) as on_finding from synthesized_insights si where si.run_id=$1 and si.review_status='accepted'", [run.id, finding.id])).rows;
    const dependent = insights.find((i) => i.on_finding)?.id;
    expect(dependent, "an insight rests on the finding").toBeTruthy();
    const seed = async (insightId, action, status, context) =>
      (await db.query(
        `insert into recommendations(tenant_id,run_id,synthesized_insight_id,action_text,owner_role,owner_feasibility_note,timeline,metric,priority,assumptions_and_risks,alternatives_considered,source,status,decision_context)
         select tenant_id,id,$2,$3,'Campaign owner','Owns the budget.','Next quarter','Purchase rate by group','medium','Assumes the gap persists.','Wait a wave.','ai_suggested',$4,$5 from runs where id=$1 returning id`,
        [run.id, insightId, action, status, context],
      )).rows[0].id;
    const ids = {
      human: human.id,
      earlier: await seed(human.insightId, "Seeded AI action written for an earlier decision", "accepted", "An earlier decision"),
      unknown: await seed(human.insightId, "Seeded AI action with no decision record", "pending", null),
      dependent: await seed(dependent, "Seeded AI action on the finding's insight", "accepted", decision),
    };
    obs.ids = ids;

    const openRecommendations = async () => {
      await page.goto(run.url, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: /^Recommendations(\s*\d+)?$/ }).first().click();
      await page.waitForTimeout(500);
    };
    await openRecommendations();
    // The pending seeded recommendation is rejected through its own Reject button.
    const unknownCard = page.locator(`[data-testid="recommendation-card"][data-recommendation-id="${ids.unknown}"]`);
    await unknownCard.getByRole("button", { name: "Reject", exact: true }).click();
    await expect.poll(async () => (await db.query("select status from recommendations where id=$1", [ids.unknown])).rows[0].status, { timeout: 60_000 }).toBe("rejected");

    const readScreen = async () => {
      await openRecommendations();
      // The rejected list is collapsed by default; open it so every card is read.
      const toggle = page.getByRole("button", { name: /^Rejected \(\d+\)/ }).first();
      if (await toggle.isVisible().catch(() => false)) await toggle.click();
      return page.locator('[data-testid="recommendation-card"]').evaluateAll((els) =>
        els.map((e) => ({
          id: e.getAttribute("data-recommendation-id"),
          status: e.getAttribute("data-status"),
          support: e.getAttribute("data-support-status"),
          decision: e.getAttribute("data-decision-state"),
          note: (e.querySelector('[data-testid="recommendation-decision-note"]')?.textContent ?? "").replace(/\s+/g, " ").trim(),
        })).sort((a, b) => a.id.localeCompare(b.id)),
      );
    };
    const dbRecs = async () => Object.fromEntries((await db.query("select id, action_text, status from recommendations where run_id=$1 and synthesized_insight_id is not null", [run.id])).rows.map((r) => [r.id, r]));
    const recordState = async () => (await db.query("select md5(string_agg(r::text,'|' order by r.id)) h from recommendations r where run_id=$1", [run.id])).rows[0].h;

    // 1 + 2. Native controls exist; screen equals screen after reload.
    await openRecommendations();
    await expect(page.getByTestId("main-recommendation-exports")).toBeVisible();
    const screen = await readScreen();
    await page.reload({ waitUntil: "networkidle" });
    expect(await readScreen(), "screen after a full reload").toEqual(screen);
    obs.screen = screen;
    for (const k of ["human", "earlier", "unknown", "dependent"]) expect(screen.some((c) => c.id === ids[k]), `${k} on screen`).toBe(true);
    expect(screen.find((c) => c.id === ids.earlier).decision).toBe("earlier");
    expect(screen.find((c) => c.id === ids.unknown).status).toBe("rejected");

    const download = async (name) => {
      await openRecommendations();
      const [file] = await Promise.all([page.waitForEvent("download", { timeout: 300_000 }), page.getByRole("link", { name, exact: true }).click()]);
      const out = testInfo.outputPath(file.suggestedFilename());
      await file.saveAs(out);
      return out;
    };
    const excel = (file) => XLSX.utils.sheet_to_json(XLSX.read(readFileSync(file), { type: "buffer" }).Sheets.Recommendations, { defval: "" });
    const slidesText = (file) => {
      const dir = path.dirname(file);
      const conv = spawnSync("soffice", ["--headless", "--convert-to", "pdf", "--outdir", dir, file], { encoding: "utf8", timeout: 180_000 });
      expect(conv.status, conv.stderr).toBe(0);
      return squash(spawnSync("pdftotext", [file.replace(/\.pptx$/, ".pdf"), "-"], { encoding: "utf8" }).stdout);
    };
    const compare = async (label, screenNow) => {
      const recs = await dbRecs();
      const all = excel(await download("Excel: all recommendations from the main list"));
      const accepted = excel(await download("Excel: accepted recommendations from the main list"));
      obs[`${label}Excel`] = all.map((r) => ({ id: r["Recommendation ID"], status: r.Status, support: r.Support.slice(0, 40), decisions: r["Decisions written for"].slice(0, 40) }));
      expect(all.map((r) => r["Recommendation ID"]).sort(), `${label}: Excel all has every card once`).toEqual(screenNow.map((c) => c.id).sort());
      expect(accepted.map((r) => r["Recommendation ID"]).sort(), `${label}: Excel accepted`).toEqual(screenNow.filter((c) => c.status === "accepted").map((c) => c.id).sort());
      for (const card of screenNow) {
        const row = all.find((r) => r["Recommendation ID"] === card.id);
        expect(row.Action, `${label}: exact wording`).toBe(recs[card.id].action_text);
        expect(row.Status.toLowerCase(), `${label}: status`).toBe(card.status);
        expect(row.Support, `${label}: support ${card.support}`).toMatch(SUPPORT_WORDS[card.support]);
        if (card.decision !== "current") {
          expect(row["Decisions written for"], `${label}: decisions ${card.decision}`).toMatch(DECISION_WORDS[card.decision]);
          expect(row["Decisions written for"], `${label}: screen and Excel say it the same way`).toBe(card.note);
        } else {
          expect(row["Decisions written for"]).not.toMatch(/^Written for earlier decisions|^Not recorded/);
        }
      }
      const slidesAll = slidesText(await download("Slides: all recommendations from the main list"));
      const slidesAccepted = slidesText(await download("Slides: accepted recommendations from the main list"));
      for (const card of screenNow) {
        const action = squash(recs[card.id].action_text);
        expect(slidesAll, `${label}: Slides all has ${action.slice(0, 40)}`).toContain(action);
        const inAccepted = slidesAccepted.split("Left out: support no longer valid")[0].includes(action);
        expect(inAccepted, `${label}: Slides accepted main slides, ${action.slice(0, 40)}`).toBe(card.status === "accepted" && card.support !== "invalid");
        if (card.status === "accepted" && card.support === "invalid") expect(slidesAccepted.split("Left out: support no longer valid")[1] ?? "", `${label}: listed as left out`).toContain(action);
      }
      expect(slidesAll).toMatch(/WRITTEN FOR EARLIER DECISIONS/);
      expect(slidesAll).toContain(squash(humanText));
    };
    // 3. Agreement with the first state.
    await compare("first", screen);

    // 4. The finding is rejected: the dependent recommendation is no longer valid everywhere.
    await ui.rejectFinding(finding);
    const after = await readScreen();
    obs.afterRejection = after;
    expect(after.find((c) => c.id === ids.dependent).support).toBe("invalid");
    await compare("afterRejection", after);

    // 5. A download that fails, then a retry. The failure is a real server error: the disposable
    // database's evidence-link table is renamed for the attempt (an injected outage, restored in
    // finally), so the route cannot read the list.
    const before = await recordState();
    await openRecommendations();
    const urlBefore = page.url();
    await db.query("alter table synthesized_insight_sources rename to synthesized_insight_sources_away");
    try {
      const [failed] = await Promise.all([
        page.waitForEvent("download", { timeout: 60_000 }),
        page.getByRole("link", { name: "Excel: all recommendations from the main list", exact: true }).click(),
      ]);
      obs.failedDownload = { failure: await failed.failure(), url: page.url() };
    } finally {
      await db.query("alter table synthesized_insight_sources_away rename to synthesized_insight_sources");
    }
    expect(obs.failedDownload.failure, "the browser reports the failed download").toBeTruthy();
    expect(page.url(), "a failed download leaves the page where it is").toBe(urlBefore);
    await expect(page.getByTestId("main-recommendation-exports")).toBeVisible();
    const retry = excel(await download("Excel: all recommendations from the main list"));
    expect(retry.map((r) => r["Recommendation ID"]).sort()).toEqual(after.map((c) => c.id).sort());
    expect(await recordState(), "no recommendation changed by a failed or retried download").toBe(before);
  } finally {
    writeFileSync(testInfo.outputPath("main-recommendation-observations.json"), JSON.stringify(obs, null, 2));
    console.log("MAIN_RECOMMENDATION_OBSERVATIONS", JSON.stringify(obs));
    await db.end();
  }
});
