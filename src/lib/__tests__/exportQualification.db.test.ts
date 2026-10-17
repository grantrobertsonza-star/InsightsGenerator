// Golden-thread GT-004 and GT-006 (Codex, 2026-10-17): exports that presented stale work unqualified.
//   GT-006: the pre-insights workbook exported an insight as "Robust" after its finding was
//     rejected, with no support status. Pre-insights now record their finding's fingerprint when
//     drafted (0103, read with the prompt) and are classified by the shared support rule; the
//     workbook, the pre-insights deck and the recommendation exports state it.
//   GT-004: the recommendation workbook and deck exported a recommendation written for earlier
//     decisions with no qualification (the deck printed the current decision above it). They now
//     carry each recommendation's own decision record (0102 rule).
// Real disposable PostgreSQL; the ACTUAL insight generator (model mocked) and the ACTUAL export
// routes. Controls: an unchanged pre-insight stays current; a legacy pre-insight (no snapshot)
// reads not recorded, never current; researcher-written and current recommendations carry no
// decision qualification; nothing is reworded.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import { createDisposableDb, DISPOSABLE_DB_SKIP_REASON, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn() }));
vi.mock("@/lib/db", async () => await import("../db"));
vi.mock("@/lib/decisionContext", async () => await import("../decisionContext"));
vi.mock("@/lib/recommendationQualification", async () => await import("../recommendationQualification"));
vi.mock("@/lib/supportStatus", async () => await import("../supportStatus"));
vi.mock("@/lib/supportStatusShared", async () => await import("../supportStatusShared"));
vi.mock("@/lib/deckSlides", async () => await import("../deckSlides"));
vi.mock("@/lib/sourceAttribution", async () => await import("../sourceAttribution"));
vi.mock("@/lib/preInsightDeckEligibility", async () => await import("../preInsightDeckEligibility"));
vi.mock("@/lib/figureChecks", async () => await import("../figureChecks"));
vi.mock("@/lib/numberTrace", async () => await import("../numberTrace"));
vi.mock("../anthropic", () => ({
  CLAUDE_MODEL: "test-model",
  anthropic: {
    messages: {
      create: vi.fn(async (req: { messages: { content: string }[] }) => {
        const n = (req.messages[0].content.match(/^\d+\. \[/gm) ?? []).length;
        const insights = Array.from({ length: n }, (_, index) => ({ index, headline: `Headline ${["one", "two", "three", "four"][index]}`, observation: "o", tension: "t", implication: "i" }));
        return { stop_reason: "tool_use", usage: {}, content: [{ type: "tool_use", input: { insights } }] };
      }),
    },
  },
}));
vi.setConfig({ testTimeout: 60000 });

describe.skipIf(!TEST_DATABASE_URL)("exports qualify stale pre-insights and recommendations (real database)", () => {
  let db: DisposableDb;
  const tenant = randomUUID();
  let run: string;
  const ids: Record<string, string> = {};
  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    await db.pool.query("insert into tenants(id,name) values($1,'Synthetic export qualification')", [tenant]);
    run = (await db.pool.query("insert into runs(tenant_id,project_name,entry_point,decision_statement) values($1,'Exports','generate','Decision A') returning id", [tenant])).rows[0].id;
    for (const name of ["kept", "rejected", "reworded"]) {
      const f = (await db.pool.query("insert into findings(tenant_id,run_id,origin,finding_text,status,theme) values($1,$2,'generated',$3,'accepted','Theme') returning id", [tenant, run, `Finding ${name}`])).rows[0].id;
      await db.pool.query("insert into verdicts(tenant_id,finding_id,verdict_tier,rationale,verification_method,corroboration_level) values($1,$2,'robust','Synthetic','single_pass','single_source')", [tenant, f]);
      ids[`finding_${name}`] = f;
    }
    // The actual generator drafts the three pre-insights and records each finding's fingerprint.
    const { generateInsights } = await import("../insightGenerator");
    await generateInsights(tenant, run);
    for (const name of ["kept", "rejected", "reworded"]) {
      ids[`insight_${name}`] = (await db.pool.query("select id from insights where finding_id=$1", [ids[`finding_${name}`]])).rows[0].id;
    }
    // A legacy pre-insight: written before 0103, no snapshot.
    const legacyFinding = (await db.pool.query("insert into findings(tenant_id,run_id,origin,finding_text,status,theme) values($1,$2,'generated','Finding legacy','accepted','Theme') returning id", [tenant, run])).rows[0].id;
    await db.pool.query("insert into verdicts(tenant_id,finding_id,verdict_tier,rationale,verification_method,corroboration_level) values($1,$2,'robust','Synthetic','single_pass','single_source')", [tenant, legacyFinding]);
    ids.insight_legacy = (await db.pool.query("insert into insights(tenant_id,run_id,finding_id,decision_context,headline,observation,tension,implication) values($1,$2,$3,null,'Headline legacy','o','t','i') returning id", [tenant, run, legacyFinding])).rows[0].id;
    // Recommendations: AI written for Decision A (current, then earlier), AI with no record, researcher-written.
    const rec = (insight: string, action: string, source: string, context: string | null) =>
      db.pool.query(
        "insert into recommendations(tenant_id,run_id,insight_id,action_text,owner_role,owner_feasibility_note,timeline,metric,priority,assumptions_and_risks,alternatives_considered,source,status,decision_context) values($1,$2,$3,$4,'Owner','f','Soon','m','medium','a','b',$5,'accepted',$6)",
        [tenant, run, insight, action, source, context],
      );
    await rec(ids.insight_kept, "Action framed for Decision A", "ai_suggested", "Decision A");
    await rec(ids.insight_rejected, "Action on the rejected finding", "ai_suggested", "Decision A");
    await rec(ids.insight_reworded, "Action with no decision record", "ai_suggested", null);
    await rec(ids.insight_legacy, "Researcher's own action", "researcher_authored", null);
  }, 120000);
  afterAll(async () => { const { pool } = await import("../db"); await pool.end(); await db.drop(); });

  const get = async (route: string, query = "") => {
    const mod = await import(`../../app/api/runs/[id]/${route}/route`);
    return mod.GET(new Request(`http://local/x${query}`), { params: Promise.resolve({ id: run }) }) as Promise<Response>;
  };
  const workbook = async (route: string, query = "") => {
    const book = XLSX.read(new Uint8Array(await (await get(route, query)).arrayBuffer()), { type: "array" });
    return XLSX.utils.sheet_to_json<Record<string, string>>(book.Sheets[book.SheetNames[0]]);
  };
  const deckText = async (route: string, query = "") => {
    const zip = await JSZip.loadAsync(new Uint8Array(await (await get(route, query)).arrayBuffer()));
    const names = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
    return (await Promise.all(names.map(async (n) => (await zip.files[n].async("string")).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")))).join(" | ");
  };

  it("the generator records each pre-insight's finding fingerprint as the prompt read it", async () => {
    const r = await db.pool.query("select i.support_snapshot = finding_support_parts(i.finding_id) as same from insights i where i.id = any($1::uuid[])", [[ids.insight_kept, ids.insight_rejected, ids.insight_reworded]]);
    expect(r.rows.map((x) => x.same)).toEqual([true, true, true]);
  });

  it("GT-006: the pre-insights workbook and deck state support; the rejected finding's insight is not presented as current", async () => {
    await db.pool.query("update findings set status='rejected' where id=$1", [ids.finding_rejected]);
    await db.pool.query("update findings set finding_text='Finding reworded in place' where id=$1", [ids.finding_reworded]);
    const rows = await workbook("insights/export");
    const support = (headline: string) => rows.find((r) => r.Headline === headline)?.Support ?? "";
    const headlineOf = async (id: string) => (await db.pool.query("select headline from insights where id=$1", [id])).rows[0].headline as string;
    expect(support(await headlineOf(ids.insight_kept))).toBe("Support current");
    expect(support(await headlineOf(ids.insight_rejected))).toMatch(/^Support no longer valid/);
    expect(support(await headlineOf(ids.insight_reworded))).toMatch(/^Support changed since drafted/);
    expect(support("Headline legacy")).toMatch(/^Support not checked/);
    // The deck leaves the rejected one out (listed with its reason) and tags the others in words.
    const deck = await deckText("insights/export-deck");
    expect(deck).toMatch(/Not included/);
    expect(deck).toMatch(new RegExp(`${await headlineOf(ids.insight_rejected)}: not included because`));
    expect(deck).toMatch(/SUPPORT CHANGED/);
    expect(deck).toMatch(/SUPPORT NOT CHECKED/);
    // Wording untouched.
    expect(await headlineOf(ids.insight_kept)).toBe("Headline one");
  });

  it("GT-004: recommendation exports carry each recommendation's decision record and its pre-insight's support", async () => {
    await db.pool.query("update runs set decision_statement='Decision C replaces Decision A' where id=$1", [run]);
    const rows = await workbook("recommendations/export", "?scope=all");
    const row = (action: string) => rows.find((r) => r.Action === action)!;
    expect(row("Action framed for Decision A")["Decisions written for"]).toBe("Written for earlier decisions (the accepted decisions have changed since): Decision A");
    expect(row("Action with no decision record")["Decisions written for"]).toMatch(/^Not recorded/);
    expect(row("Researcher's own action")["Decisions written for"]).toBe("Written by the researcher");
    expect(row("Action on the rejected finding").Support).toMatch(/^Support no longer valid/);
    expect(row("Action framed for Decision A").Support).toBe("Support current");
    // Accepted deck: the rejected-support recommendation is left out and listed; the others are tagged.
    const deck = await deckText("recommendations/export-deck", "?scope=accepted");
    expect(deck).toMatch(/WRITTEN FOR EARLIER DECISIONS/);
    expect(deck).toMatch(/Written for earlier decisions \(the accepted decisions have changed since\): Decision A/);
    expect(deck).toMatch(/DECISIONS NOT RECORDED/);
    expect(deck).toMatch(/Left out: support no longer valid/);
    const leftOut = deck.slice(deck.indexOf("Left out: support no longer valid"));
    expect(leftOut).toContain("Action on the rejected finding");
    // Back to Decision A: the earlier-decision tag clears; the unrecorded one stays unknown.
    await db.pool.query("update runs set decision_statement='Decision A' where id=$1", [run]);
    const again = await workbook("recommendations/export", "?scope=all");
    expect(again.find((r) => r.Action === "Action framed for Decision A")!["Decisions written for"]).toBe("Decision A");
    expect(again.find((r) => r.Action === "Action with no decision record")!["Decisions written for"]).toMatch(/^Not recorded/);
  });
});
describe.skipIf(!!TEST_DATABASE_URL)("exports qualify stale pre-insights and recommendations (real database)", () => { it.skip(DISPOSABLE_DB_SKIP_REASON, () => {}); });
