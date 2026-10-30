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
//   Latest verdict (Codex review of ffa7adc): the generator joined every verdict, so an older
//     robust verdict drafted an insight for a finding whose latest verdict refuses it, and its
//     snapshot (the latest verdict) then read as current. Eligibility, the prompt's verdict and
//     rationale and the snapshot now use one latest verdict (created_at desc, id desc, the order
//     finding_support_parts uses). Controls: both refusal tiers, an older refusal with a latest
//     robust verdict, several qualifying verdicts (one insight), and a same-instant tie.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import { createDisposableDb, DISPOSABLE_DB_SKIP_REASON, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";
// G6: actions and routes take the tenant from the signed-in request; tests supply the seeded one.
vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());

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
        return { stop_reason: "tool_use", usage: {}, content: [{ type: "tool_use", name: "record_insights", input: { insights } }] };
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

  const getFor = async (runId: string, route: string, query = "") => {
    const mod = await import(`../../app/api/runs/[id]/${route}/route`);
    return mod.GET(new Request(`http://local/x${query}`), { params: Promise.resolve({ id: runId }) }) as Promise<Response>;
  };
  /** A fresh run with one accepted finding and the given verdicts (oldest first). */
  const latestVerdictRun = async (verdicts: { tier: string; rationale: string; at: string; id?: string }[]) => {
    const r = (await db.pool.query("insert into runs(tenant_id,project_name,entry_point) values($1,'Latest verdict','generate') returning id", [tenant])).rows[0].id as string;
    const f = (await db.pool.query("insert into findings(tenant_id,run_id,origin,finding_text,status,theme) values($1,$2,'generated','Finding with several verdicts','accepted','Theme') returning id", [tenant, r])).rows[0].id as string;
    for (const v of verdicts) {
      await db.pool.query(
        "insert into verdicts(id,tenant_id,finding_id,verdict_tier,rationale,verification_method,corroboration_level,created_at) values(coalesce($1::uuid, gen_random_uuid()),$2,$3,$4,$5,'single_pass','single_source',$6)",
        [v.id ?? null, tenant, f, v.tier, v.rationale, v.at],
      );
    }
    return { run: r, finding: f };
  };
  const promptsSince = async (count: number) => {
    const { anthropic } = await import("../anthropic");
    const calls = (anthropic.messages.create as unknown as { mock: { calls: { messages: { content: string }[] }[][] } }).mock.calls;
    return calls.slice(count).map((c) => c[0].messages[0].content);
  };
  const callCount = async () => {
    const { anthropic } = await import("../anthropic");
    return (anthropic.messages.create as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
  };

  it.each(["not_supported", "insufficient_information"])("latest verdict %s: no pre-insight is drafted from an older robust verdict", async (tier) => {
    const { run: r, finding } = await latestVerdictRun([
      { tier: "robust", rationale: "Older robust reason", at: "2026-01-01" },
      { tier, rationale: "Latest refusing reason", at: "2026-01-02" },
    ]);
    const { generateInsights } = await import("../insightGenerator");
    const before = await callCount();
    await generateInsights(tenant, r);
    expect((await db.pool.query("select count(*)::int as n from insights where finding_id=$1", [finding])).rows[0].n).toBe(0);
    expect(await promptsSince(before)).toEqual([]);
    const book = XLSX.read(new Uint8Array(await (await getFor(r, "insights/export")).arrayBuffer()), { type: "array" });
    expect(XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]])).toEqual([]);
  });

  it("an older refusal with a latest robust verdict drafts one current pre-insight from the latest verdict's rationale", async () => {
    const { run: r, finding } = await latestVerdictRun([
      { tier: "not_supported", rationale: "Older refusal reason", at: "2026-01-01" },
      { tier: "robust", rationale: "Latest robust reason", at: "2026-01-02" },
    ]);
    const { generateInsights } = await import("../insightGenerator");
    const before = await callCount();
    await generateInsights(tenant, r);
    const rows = (await db.pool.query("select support_snapshot->>'verdict' as verdict from insights where finding_id=$1", [finding])).rows;
    expect(rows).toEqual([{ verdict: "robust" }]);
    const prompts = await promptsSince(before);
    expect(prompts.length).toBe(1);
    expect(prompts[0]).toContain("Latest robust reason");
    expect(prompts[0]).not.toContain("Older refusal reason");
    const book = XLSX.read(new Uint8Array(await (await getFor(r, "insights/export")).arrayBuffer()), { type: "array" });
    const out = XLSX.utils.sheet_to_json<Record<string, string>>(book.Sheets[book.SheetNames[0]]);
    expect(out.map((x) => [x.Robustness, x.Support])).toEqual([["Robust", "Support current"]]);
  });

  it("several qualifying verdicts draft the finding once, from the latest", async () => {
    const { run: r, finding } = await latestVerdictRun([
      { tier: "robust", rationale: "First robust reason", at: "2026-01-01" },
      { tier: "robust", rationale: "Second robust reason", at: "2026-01-02" },
      { tier: "use_with_caution", rationale: "Latest caution reason", at: "2026-01-03" },
    ]);
    const { generateInsights } = await import("../insightGenerator");
    const before = await callCount();
    await generateInsights(tenant, r);
    expect((await db.pool.query("select support_snapshot->>'verdict' as verdict from insights where finding_id=$1", [finding])).rows).toEqual([{ verdict: "use_with_caution" }]);
    const prompts = await promptsSince(before);
    expect(prompts.length).toBe(1);
    expect((prompts[0].match(/^\d+\. \[/gm) ?? []).length).toBe(1);
    expect(prompts[0]).toContain("Latest caution reason");
  });

  it("verdicts saved in the same instant: the larger id is the latest, as in finding_support_parts", async () => {
    const { run: r, finding } = await latestVerdictRun([
      { tier: "robust", rationale: "Robust, smaller id", at: "2026-01-01", id: "00000000-0000-4000-8000-000000000001" },
      { tier: "not_supported", rationale: "Refusal, larger id", at: "2026-01-01", id: "ffffffff-ffff-4fff-bfff-fffffffffff1" },
    ]);
    const { generateInsights } = await import("../insightGenerator");
    await generateInsights(tenant, r);
    expect((await db.pool.query("select count(*)::int as n from insights where finding_id=$1", [finding])).rows[0].n).toBe(0);
    expect((await db.pool.query("select finding_support_parts($1)->>'verdict' as v", [finding])).rows[0].v).toBe("not_supported");
  });

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
