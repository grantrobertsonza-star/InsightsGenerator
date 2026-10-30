// Batch 64, Codex EC10K-F03: synthesis stored the finding's CURRENT fingerprint on each new source link,
// around the pre-insight's OLDER wording, so a finding corrected after its pre-insight was drafted (a claim
// withdrawn by the researcher) read "Support current" through recommendations and exports. The link now
// records the pre-insight's own drafted-from snapshot, and the support reader prefers it for links written
// before this batch. Real disposable PostgreSQL, the ACTUAL generator, synthesizer, wording edit, support
// reader and both story export routes; only the model is controlled.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import JSZip from "jszip";
import { createDisposableDb, DISPOSABLE_DB_SKIP_REASON, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";

vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/methodologyStatus", async () => await import("../methodologyStatus"));
vi.mock("@/lib/db", async () => await import("../db"));
vi.mock("@/lib/deckSlides", async () => await import("../deckSlides"));
vi.mock("@/lib/discoverySlides", async () => await import("../discoverySlides"));
vi.mock("@/lib/findingsChartData", async () => await import("../findingsChartData"));
vi.mock("@/lib/storyNarrative", async () => await import("../storyNarrative"));
vi.mock("@/lib/docxReport", async () => await import("../docxReport"));
vi.mock("@/lib/narrativeFreshness", async () => await import("../narrativeFreshness"));
vi.mock("@/lib/evidenceTrail", async () => await import("../evidenceTrail"));
vi.mock("@/lib/evidenceTrailSlides", async () => await import("../evidenceTrailSlides"));
vi.mock("@/lib/objectiveCoverage", async () => await import("../objectiveCoverage"));
vi.mock("@/lib/caveatLabels", async () => await import("../caveatLabels"));
vi.mock("@/lib/supportStatus", async () => await import("../supportStatus"));
vi.mock("@/lib/supportStatusShared", async () => await import("../supportStatusShared"));
vi.mock("@/lib/sourceAttribution", async () => await import("../sourceAttribution"));
vi.mock("@/lib/narrativeSupportSummary", async () => await import("../narrativeSupportSummary"));
vi.mock("@/lib/discoveryReport", async () => ({
  ...(await import("../discoveryReport")),
  loadDiscoveryReportData: vi.fn(async () => ({ inputState: "complete", netNewSources: [], verificationNote: null, netNewInsights: [], netNewFindings: [], netNewFindingsOmitted: 0, contradictions: [] })),
}));
vi.mock("@/lib/exportChartImages", () => ({ buildChartImagesByTheme: vi.fn(async () => []) }));
vi.mock("@/lib/figureChecks", async () => await import("../figureChecks"));
vi.mock("@/lib/numberTrace", async () => await import("../numberTrace"));
vi.mock("@/lib/latestVerdict", async () => await import("../latestVerdict"));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn(async () => {}) }));
vi.mock("../contradictionDetector", async (orig) => ({ ...(await orig<object>()), refreshContradictions: vi.fn(async () => {}) }));
type Req = { tool_choice?: { name?: string }; messages: { content: string }[] };
// whileClustering runs inside the clustering call: a correction made while the model is answering.
const model = vi.hoisted(() => ({ whileClustering: null as null | (() => Promise<void>) }));
vi.mock("../anthropic", () => ({
  CLAUDE_MODEL: "controlled",
  anthropic: {
    messages: {
      create: vi.fn(async (req: Req) => {
        const name = req.tool_choice?.name ?? "";
        const text = String(req.messages[0].content);
        const idx = (re: RegExp) => [...text.matchAll(re)].map((m) => Number(m[1]));
        let input: unknown;
        if (name === "record_insights") input = { insights: [...text.matchAll(/^(\d+)\. \[[^\n]*?\] (.*)$/gm)].map((m) => ({ index: Number(m[1]), headline: "Access matters", observation: m[2], tension: "It constrains service.", implication: "Review capacity." })) };
        else if (name === "record_verdicts") input = { verdicts: idx(/^(\d+)\. /gm).map((index) => ({ index, verdict_tier: "robust", rationale: "Supported." })) };
        else if (name === "record_clusters") {
          if (model.whileClustering) await model.whileClustering();
          input = { clusters: [{ label: "Service access", member_indices: idx(/^(\d+)\. /gm) }] };
        } else if (name === "record_synthesized_insight")
          input = { headline: "Service access needs attention", observation: "Waiting is common.", tension: "Access constrains service.", implication: "Review capacity.", action_plan_status: "has_action", materiality_rationale: "It bears on expansion.", passes_validity_gate: true };
        else throw new Error(`unexpected tool ${name}`);
        return { stop_reason: "tool_use", usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "tool_use", name, input }] };
      }),
    },
  },
}));
vi.setConfig({ testTimeout: 120000, hookTimeout: 120000 });

describe.skipIf(!TEST_DATABASE_URL)("a synthesized insight records the support its pre-insights were drafted from (EC10K-F03)", () => {
  let db: DisposableDb;
  const tenant = randomUUID();
  const q = async (sql: string, args: unknown[] = []) => (await db.pool.query(sql, args)).rows;
  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    await q("insert into tenants(id,name) values($1,'Drafted-from support')", [tenant]);
  });
  afterAll(async () => {
    const { pool, claimPool } = await import("../db");
    await pool.end();
    await claimPool.end();
    await db?.drop();
  });
  beforeEach(() => {
    model.whileClustering = null;
  });

  const WITHDRAWN = "The earlier service claim was withdrawn; this report does not support that conclusion.";
  /** Two verified findings, each with a pre-insight drafted by the actual generator (support recorded). */
  async function drafted(): Promise<{ run: string; findings: { id: string; text: string }[] }> {
    const run = (await q("insert into runs(tenant_id,project_name,entry_point,decision_statement) values($1,'Drafted from','generate','Whether to expand service capacity') returning id", [tenant]))[0].id as string;
    const findings: { id: string; text: string }[] = [];
    for (const text of ["Respondents waited for service before receiving help.", "Most visits involved a long wait."]) {
      const id = (await q("insert into findings(tenant_id,run_id,origin,finding_text,status,theme) values($1,$2,'stated',$3,'accepted','Access') returning id", [tenant, run, text]))[0].id as string;
      await q("insert into verdicts(tenant_id,finding_id,verdict_tier,rationale,verification_method,corroboration_level) values($1,$2,'robust','Supported.','single_pass','single_source')", [tenant, id]);
      findings.push({ id, text });
    }
    const pass = await (await import("../insightGenerator")).generateInsights(tenant, run);
    expect(pass.remaining).toBe(0);
    return { run, findings };
  }
  const correct = async (run: string, f: { id: string; text: string }) => {
    const { withTenant } = await import("../db");
    const { editFindingWordingTx } = await import("../findingWording");
    const r = await withTenant(tenant, (client) => editFindingWordingTx(client, tenant, run, f.id, f.text, WITHDRAWN));
    expect(r.ok).toBe(true);
  };
  const synthesize = async (run: string) => {
    await (await import("../insightSynthesizer")).synthesizeInsights(tenant, run);
    const rows = await q("select id from synthesized_insights where run_id=$1", [run]);
    expect(rows).toHaveLength(1);
    return rows[0].id as string;
  };
  const supportOf = async (run: string, insightId: string) => (await (await import("../supportStatus")).loadInsightSupport(tenant, run)).statusOf(insightId);

  it("a correction before clustering: the new insight reads changed since drafted, naming the corrected finding", async () => {
    const { run, findings } = await drafted();
    await correct(run, findings[0]);
    const id = await synthesize(run);
    const support = await supportOf(run, id);
    expect(support.status).toBe("stale");
    expect(support.reasons.some((r) => r.kind === "wording" && r.findingId === findings[0].id)).toBe(true);
    // The link carries the pre-insight's snapshot, not the corrected finding's fingerprint.
    const links = await q(
      "select s.support_snapshot = i.support_snapshot as same_as_pre, s.support_snapshot = finding_support_parts(i.finding_id) as same_as_now from synthesized_insight_sources s join insights i on i.id=s.pre_insight_id where s.synthesized_insight_id=$1 and i.finding_id=$2",
      [id, findings[0].id],
    );
    expect(links).toEqual([{ same_as_pre: true, same_as_now: false }]);
  });

  it("a correction while the model is answering: still changed since drafted", async () => {
    const { run, findings } = await drafted();
    model.whileClustering = async () => {
      model.whileClustering = null;
      await correct(run, findings[1]);
    };
    const id = await synthesize(run);
    expect((await supportOf(run, id)).status).toBe("stale");
  });

  it("unchanged control: current; recovery: the correction undone and the finding verified again reads current, the researcher's wording history kept", async () => {
    const { run, findings } = await drafted();
    const control = await synthesize(run);
    expect((await supportOf(run, control)).status).toBe("current");

    const second = await drafted();
    await correct(second.run, second.findings[0]);
    const id = await synthesize(second.run);
    expect((await supportOf(second.run, id)).status).toBe("stale");
    const wordingAndReview = await q("select headline, observation, review_status from synthesized_insights where id=$1", [id]);
    const { withTenant } = await import("../db");
    const { revertFindingWordingTx } = await import("../findingWording");
    expect((await withTenant(tenant, (client) => revertFindingWordingTx(client, tenant, second.run, second.findings[0].id, WITHDRAWN))).ok).toBe(true);
    await (await import("../verifyFindings")).verifyFindings(tenant, second.run);
    expect((await supportOf(second.run, id)).status).toBe("current");
    // The synthesized insight's wording and review state were never touched by any of this.
    expect(await q("select headline, observation, review_status from synthesized_insights where id=$1", [id])).toEqual(wordingAndReview);
    expect(findings.length).toBe(2);
  });

  it("a link written before this batch (the finding's fingerprint at synthesis) is qualified from its pre-insight's snapshot", async () => {
    const { run, findings } = await drafted();
    await correct(run, findings[0]);
    const id = await synthesize(run);
    // What the old code stored: the finding's fingerprint at synthesis time.
    await q("update synthesized_insight_sources s set support_snapshot = finding_support_parts(i.finding_id) from insights i where i.id = s.pre_insight_id and s.synthesized_insight_id = $1", [id]);
    expect((await supportOf(run, id)).status).toBe("stale");
  });

  it("a pre-insight that recorded no snapshot gives a link that reads not checked, never current", async () => {
    const { run } = await drafted();
    await q("update insights set support_snapshot = null where run_id=$1", [run]);
    const id = await synthesize(run);
    expect(await q("select support_snapshot from synthesized_insight_sources where synthesized_insight_id=$1", [id])).toEqual([{ support_snapshot: null }, { support_snapshot: null }]);
    expect((await supportOf(run, id)).status).toBe("unknown");
  });

  it("both story exports carry the qualification for an accepted insight synthesized after the correction", async () => {
    const { run, findings } = await drafted();
    await correct(run, findings[0]);
    const id = await synthesize(run);
    await q("update synthesized_insights set review_status='accepted' where id=$1", [id]);
    await q("insert into recommendations(tenant_id,run_id,synthesized_insight_id,action_text,owner_role,owner_feasibility_note,timeline,metric,priority,assumptions_and_risks,alternatives_considered,status) values($1,$2,$3,'Pilot more service capacity','Ops','Feasible','Next quarter','Waiting time','high','Observational','Keep capacity','accepted')", [tenant, run, id]);
    await q(
      "insert into deck_narratives(run_id,tenant_id,executive_summary,situation,complication,question,governing_thought,pillars,recommendations_intro,caveats) values($1,$2,'Pilot capacity','Access studied','Waiting','Whether to expand service capacity','Pilot first',$3,'Actions follow','[]')",
      [run, tenant, JSON.stringify([{ theme: "Access", headline: "Service access needs attention", so_what: "Pilot", insight_ids: [id], insight_overflow_count: 0 }])],
    );
    const { summariseSupport } = await import("../supportStatusShared");
    const note = summariseSupport(await supportOf(run, id));
    expect(note).toMatch(/wording/i);
    const norm = (s: string) => s.replace(/&apos;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");
    for (const [route, pick] of [
      ["../../app/api/runs/[id]/story/export-docx/route", (n: string) => n === "word/document.xml"],
      ["../../app/api/runs/[id]/story/export/route", (n: string) => /^ppt\/slides\/slide\d+\.xml$/.test(n)],
    ] as const) {
      const { GET } = await import(route);
      const response: Response = await GET(new Request("http://local/report"), { params: Promise.resolve({ id: run }) });
      expect(response.status).toBe(200);
      const zip = await JSZip.loadAsync(Buffer.from(await response.arrayBuffer()));
      const xml = (await Promise.all(Object.keys(zip.files).filter(pick).map((n) => zip.files[n].async("string")))).join(" ");
      const text = norm(xml.replace(/<[^>]+>/g, ""));
      expect(text).toContain("Pilot more service capacity");
      expect(text).toContain("Support changed since drafted");
    }
  });
});

describe.skipIf(!!TEST_DATABASE_URL)("real-database checks for batch 64", () => {
  it.skip(DISPOSABLE_DB_SKIP_REASON, () => {});
});
