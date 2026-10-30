// GT-007 (authorised by Grant, 2026-10-17): Excel and Slides exports of the main Recommendations
// list (recommendations on synthesized insights). Real disposable PostgreSQL, the ACTUAL routes.
// Mixed fixture: AI and researcher-written recommendations; accepted, pending and rejected; written
// for the current decisions, for earlier ones and with none recorded; resting on insights whose
// support is current, no longer valid (finding rejected) and changed (finding reworded in place);
// plus a per-pre-insight recommendation that must stay out of these files. Checked:
//   - every recommendation in scope, once, in the screen's order, with its exact stored wording,
//     status, author, decisions, support, chain of evidence and ids; the scope named in the file;
//   - accepted scope: pending and rejected left out; in the deck, invalid support left out of the
//     main slides and listed with its reason;
//   - a field longer than a slide continues on the next slide, complete (rendered with LibreOffice
//     when installed: every word inside the page and above the footer, the full text present);
//   - an empty list says so in both files;
//   - a failed read is an error, not an empty file; the retry returns the same rows; nothing is
//     written by any export.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { SOFFICE, officeConvert } from "./helpers/officeRender";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import { createDisposableDb, DISPOSABLE_DB_SKIP_REASON, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";
// G6: actions and routes take the tenant from the signed-in request; tests supply the seeded one.
vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());

vi.mock("@/lib/db", async () => await import("../db"));
vi.mock("@/lib/deckSlides", async () => await import("../deckSlides"));
vi.mock("@/lib/crosstabSlides", async () => await import("../crosstabSlides"));
vi.mock("@/lib/fieldTableSlides", async () => await import("../fieldTableSlides"));
vi.mock("@/lib/mainRecommendationExport", async () => await import("../mainRecommendationExport"));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));

const PDFTOTEXT = spawnSync("which", ["pdftotext"]).status === 0;
const LONG = Array.from({ length: 60 }, (_, i) => `Risk ${i + 1}: the campaign window may close before the owner can act.`).join(" ") + " LONG_END_SENTINEL";

describe.skipIf(!TEST_DATABASE_URL)("main Recommendations list exports (GT-007, real database, actual routes)", () => {
  let db: DisposableDb;
  const tenant = randomUUID();
  let run = "";
  let emptyRun = "";
  const ids: Record<string, string> = {};
  const one = async (sql: string, p: unknown[]) => (await db.pool.query(sql, p)).rows[0].id as string;

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    await db.pool.query("insert into tenants(id,name) values($1,'Main list')", [tenant]);
    run = await one("insert into runs(tenant_id,project_name,entry_point,decision_statement) values($1,'Main list','generate','Decision C') returning id", [tenant]);
    emptyRun = await one("insert into runs(tenant_id,project_name,entry_point) values($1,'Empty list','generate') returning id", [tenant]);
    // Three synthesized insights, each on one finding, with the finding's fingerprint recorded.
    for (const [key, score] of [["A", 20], ["B", 15], ["C", 10]] as const) {
      const f = await one("insert into findings(tenant_id,run_id,origin,finding_text,status,theme) values($1,$2,'generated',$3,'accepted','Theme') returning id", [tenant, run, `Finding ${key}`]);
      await db.pool.query("insert into verdicts(tenant_id,finding_id,verdict_tier,rationale,verification_method,corroboration_level) values($1,$2,'robust','r','single_pass','single_source')", [tenant, f]);
      const pre = await one("insert into insights(tenant_id,run_id,finding_id,headline,observation,tension,implication) values($1,$2,$3,$4,'o','t','i') returning id", [tenant, run, f, `Pre-insight ${key}`]);
      const si = await one(
        "insert into synthesized_insights(tenant_id,run_id,headline,observation,tension,implication,triangulation_count,source_theme_count,review_status,quality_score) values($1,$2,$3,'o','t','i',1,1,'accepted',$4) returning id",
        [tenant, run, `Insight ${key}`, score],
      );
      await db.pool.query("insert into synthesized_insight_sources(tenant_id,synthesized_insight_id,pre_insight_id,support_snapshot) values($1,$2,$3,finding_support_parts($4))", [tenant, si, pre, f]);
      Object.assign(ids, { [`finding${key}`]: f, [`pre${key}`]: pre, [`si${key}`]: si });
    }
    const rec = (key: string, si: string, action: string, source: string, status: string, context: string | null, edited = false, risks = "a") =>
      one(
        `insert into recommendations(tenant_id,run_id,synthesized_insight_id,action_text,owner_role,owner_feasibility_note,timeline,metric,priority,assumptions_and_risks,alternatives_considered,source,status,decision_context,edited)
         values($1,$2,$3,$4,'Owner','f','Soon','m','medium',$5,'b',$6,$7,$8,$9) returning id`,
        [tenant, run, si, action, risks, source, status, context, edited],
      ).then((id) => (ids[key] = id));
    await rec("r1", ids.siA, "AI action for the current decisions", "ai_suggested", "accepted", "Decision C", false, LONG);
    await rec("r2", ids.siA, "Researcher’s own action, worded “exactly”", "researcher_authored", "accepted", null, true);
    await rec("r3", ids.siB, "AI action written for Decision A", "ai_suggested", "accepted", "Decision A");
    await rec("r4", ids.siC, "AI action with no decision record", "ai_suggested", "pending", null);
    await rec("r5", ids.siA, "Rejected AI action", "ai_suggested", "rejected", "Decision C");
    // A per-pre-insight recommendation: not part of the main list.
    await one(
      "insert into recommendations(tenant_id,run_id,insight_id,action_text,owner_role,owner_feasibility_note,timeline,metric,priority,assumptions_and_risks,alternatives_considered,source,status) values($1,$2,$3,'Pre-insight list action','O','f','t','m','low','a','b','ai_suggested','accepted') returning id",
      [tenant, run, ids.preA],
    );
    // Support changes after drafting: B's finding rejected, C's reworded in place.
    await db.pool.query("update findings set status='rejected' where id=$1", [ids.findingB]);
    await db.pool.query("update findings set finding_text='Finding C reworded' where id=$1", [ids.findingC]);
  }, 120000);
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end();
    await db.drop();
  });

  const get = async (route: string, scope: string, runId = run) => {
    const mod = await import(`../../app/api/runs/[id]/synthesized-recommendations/${route}/route`);
    return mod.GET(new Request(`http://local/x?scope=${scope}`), { params: Promise.resolve({ id: runId }) }) as Promise<Response>;
  };
  const book = async (scope: string, runId = run) => {
    const res = await get("export", scope, runId);
    expect(res.status).toBe(200);
    const b = XLSX.read(new Uint8Array(await res.arrayBuffer()), { type: "array" });
    return {
      rows: XLSX.utils.sheet_to_json<Record<string, string>>(b.Sheets.Recommendations, { defval: "" }),
      about: Object.fromEntries(XLSX.utils.sheet_to_json<string[]>(b.Sheets.About, { header: 1 }).map((r) => [r[0], r[1]])),
      disposition: res.headers.get("content-disposition"),
    };
  };
  const deck = async (scope: string, runId = run) => {
    const res = await get("export-deck", scope, runId);
    expect(res.status).toBe(200);
    const buffer = Buffer.from(await res.arrayBuffer());
    const zip = await JSZip.loadAsync(buffer);
    const names = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => Number(/(\d+)\.xml/.exec(a)![1]) - Number(/(\d+)\.xml/.exec(b)![1]));
    const slides = await Promise.all(names.map(async (n) => (await zip.files[n].async("string")).replace(/<\/a:p>/g, " ").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/\s+/g, " ")));
    return { buffer, slides };
  };
  const snapshot = async () => (await db.pool.query("select md5(string_agg(r::text, '|' order by r.id)) as h, count(*)::int as n from recommendations r where r.run_id=$1", [run])).rows[0];

  it("Excel, all: every main-list recommendation once, in the screen's order, with wording, status, author, decisions, support, evidence and ids", async () => {
    const before = await snapshot();
    const { rows, about, disposition } = await book("all");
    expect(rows.map((r) => r["Recommendation ID"])).toEqual([ids.r1, ids.r2, ids.r5, ids.r3, ids.r4]);
    const by = (id: string) => rows.find((r) => r["Recommendation ID"] === id)!;
    expect(by(ids.r2).Action).toBe("Researcher’s own action, worded “exactly”");
    expect(by(ids.r2)["Written by"]).toBe("Researcher-written, edited before accepting");
    expect(by(ids.r2)["Decisions written for"]).toBe("Written by the researcher");
    expect(by(ids.r1)["Decisions written for"]).toBe("Decision C");
    expect(by(ids.r1)["Assumptions & risks"]).toBe(LONG);
    expect(by(ids.r3)["Decisions written for"]).toBe("Written for earlier decisions (the accepted decisions have changed since): Decision A");
    expect(by(ids.r4)["Decisions written for"]).toMatch(/^Not recorded/);
    expect(by(ids.r1).Support).toBe("Support current");
    expect(by(ids.r3).Support).toMatch(/^Support no longer valid: “Finding B” was rejected/);
    expect(by(ids.r4).Support).toMatch(/^Support changed since drafted/);
    expect(by(ids.r5).Status).toBe("Rejected");
    expect(by(ids.r4).Status).toBe("Pending");
    expect(by(ids.r1)["Insight ID"]).toBe(ids.siA);
    expect(by(ids.r1)["Chain of evidence"]).toBe("Pre-insight A");
    expect(by(ids.r1)["Supporting finding IDs"]).toBe(ids.findingA);
    expect(rows.some((r) => r.Action === "Pre-insight list action")).toBe(false);
    expect(about.Scope).toMatch(/^All recommendations from the main Recommendations list/);
    expect(about.Recommendations).toBe(5);
    expect(disposition).toMatch(/main-recommendations-all\.xlsx/);
    expect(await snapshot()).toEqual(before);
  });

  it("Excel, accepted: pending and rejected left out; the scope is named", async () => {
    const { rows, about, disposition } = await book("accepted");
    expect(rows.map((r) => r["Recommendation ID"])).toEqual([ids.r1, ids.r2, ids.r3]);
    expect(about.Scope).toMatch(/^Accepted recommendations from the main Recommendations list/);
    expect(disposition).toMatch(/main-recommendations-accepted\.xlsx/);
  });

  it("Slides, all and accepted: one recommendation per slide group, tagged; invalid support listed, not presented", async () => {
    const all = await deck("all");
    const text = all.slides.join(" | ");
    for (const action of ["AI action for the current decisions", "Researcher’s own action, worded “exactly”", "AI action written for Decision A", "AI action with no decision record", "Rejected AI action"]) {
      expect(text).toContain(action);
    }
    expect(text).not.toContain("Pre-insight list action");
    expect(text).toMatch(/WRITTEN FOR EARLIER DECISIONS · SUPPORT NO LONGER VALID/);
    expect(text).toMatch(/PENDING REVIEW · DECISIONS NOT RECORDED · SUPPORT CHANGED/);
    expect(text).toMatch(/· REJECTED/);
    // The long field continues on the next slide, complete.
    const r1 = all.slides.filter((s) => /Recommendation 1 of 5/.test(s));
    expect(r1.length).toBeGreaterThan(1);
    expect(r1.join(" ")).toContain("(cont.)");
    expect(r1.join(" ")).toContain("LONG_END_SENTINEL");
    const acc = await deck("accepted");
    const main = acc.slides.filter((s) => /^.*Recommendation \d+ of \d+/.test(s)).join(" | ");
    expect(main).toContain("AI action for the current decisions");
    expect(main).not.toContain("AI action written for Decision A");
    expect(acc.slides.join(" ")).not.toContain("AI action with no decision record");
    expect(acc.slides.join(" ")).not.toContain("Rejected AI action");
    const leftOut = acc.slides.filter((s) => s.includes("Left out: support no longer valid")).join(" ");
    expect(leftOut).toContain("AI action written for Decision A");
    expect(leftOut).toContain("“Finding B” was rejected");
  });

  it.skipIf(!SOFFICE || !PDFTOTEXT)("Slides rendered: every word inside the page and above the footer; the long text complete", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "main-rec-"));
    writeFileSync(path.join(dir, "all.pptx"), (await deck("all")).buffer);
    const conv = officeConvert(path.join(dir, "all.pptx"), "pdf", dir);
    expect(conv.status, conv.detail).toBe(0);
    const bbox = spawnSync("pdftotext", ["-bbox", path.join(dir, "all.pdf"), "-"], { encoding: "utf8", maxBuffer: 1e8 }).stdout;
    for (const [i, page] of bbox.split(/<page /).slice(1).entries()) {
      const width = Number(/width="([\d.]+)"/.exec(page)![1]);
      const height = Number(/height="([\d.]+)"/.exec(page)![1]);
      const words = [...page.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)</g)].map((m) => ({ y0: +m[2], x1: +m[3], y1: +m[4], t: m[5] }));
      expect(words.filter((w) => w.x1 > width + 0.5 || w.y1 > height + 0.5).map((w) => w.t), `page ${i + 1}: beyond the page`).toEqual([]);
      // The table ends by 5.1 in; the footer rule is at 5.22 in.
      expect(words.filter((w) => w.y1 > 5.1 * 72 + 3 && w.y0 < 5.22 * 72 - 1).map((w) => w.t), `page ${i + 1}: over the footer`).toEqual([]);
    }
    const text = spawnSync("pdftotext", [path.join(dir, "all.pdf"), "-"], { encoding: "utf8" }).stdout.replace(/\s+/g, " ");
    expect(text).toContain("LONG_END_SENTINEL");
    for (let i = 1; i <= 60; i++) expect(text, `Risk ${i}`).toContain(`Risk ${i}:`);
  }, 300_000);

  it("an empty list says so in both files", async () => {
    const { rows, about } = await book("all", emptyRun);
    expect(rows).toEqual([expect.objectContaining({ Action: "No recommendations in this scope." })]);
    expect(about.Recommendations).toBe(0);
    expect((await deck("accepted", emptyRun)).slides.join(" ")).toContain("No recommendations in this scope.");
  });

  it("a failed read is an error, not an empty file; the retry returns the same rows; nothing is written", async () => {
    const before = await snapshot();
    const first = await book("all");
    await db.pool.query("alter table synthesized_insight_sources rename to synthesized_insight_sources_away");
    try {
      await expect(get("export", "all")).rejects.toThrow();
      await expect(get("export-deck", "all")).rejects.toThrow();
    } finally {
      await db.pool.query("alter table synthesized_insight_sources_away rename to synthesized_insight_sources");
    }
    const retry = await book("all");
    expect(retry.rows).toEqual(first.rows);
    expect(await snapshot()).toEqual(before);
  });

  it("an unknown run is refused", async () => {
    expect((await get("export", "all", randomUUID())).status).toBe(404);
    expect((await get("export-deck", "all", randomUUID())).status).toBe(404);
  });
});
describe.skipIf(!!TEST_DATABASE_URL)("main Recommendations list exports (GT-007, real database, actual routes)", () => { it.skip(DISPOSABLE_DB_SKIP_REASON, () => {}); });
