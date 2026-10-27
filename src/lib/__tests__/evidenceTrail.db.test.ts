// CE-5 (evidence chain, 26 October 2026): the evidence trail of a recommendation, from stored links only,
// against a real disposable PostgreSQL through the app's own db.ts. The coverage model is the mocked
// boundary.
//   - full trail: decision served and objective answered above; insight, pre-insight, finding with its
//     verdict, quote and figures, and the source file beneath; no breaks;
//   - breaks are shown, never hidden: coverage out of date, a decision no longer current, a deleted
//     finding, a finding with no source, coverage never checked, no decision recorded;
//   - another project's recommendation is refused.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createDisposableDb, DISPOSABLE_DB_SKIP_REASON, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";

vi.mock("../anthropic", () => ({
  CLAUDE_MODEL: "synthetic",
  anthropic: { messages: { create: async () => ({ content: [{ type: "tool_use", input: { validations: [{ item_index: 0, status: "resolved", conclusion: "Answered.", insight_indices: [0] }, { item_index: 1, status: "partial", conclusion: "Partly.", insight_indices: [0] }] } }], usage: {} }) } },
}));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", async (orig) => ({ ...(await orig<object>()), after: vi.fn() }));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));
vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.setConfig({ testTimeout: 60000 });

type Node = { kind: string; label: string; state: string; note: string | null; details: string[]; children: Node[] };
const flat = (n: Node): Node[] => [n, ...n.children.flatMap(flat)];

describe.skipIf(!TEST_DATABASE_URL)("CE-5 evidence trail of a recommendation", () => {
  let db: DisposableDb;
  const tenant = randomUUID();
  const q = async (sql: string, p: unknown[] = []) => (await db.pool.query(sql, p)).rows;
  const id = async (sql: string, p: unknown[]) => (await q(sql, p))[0].id as string;
  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    await q("insert into tenants(id,name) values($1,'Synthetic trail')", [tenant]);
  }, 120000);
  afterAll(async () => { const { pool } = await import("../db"); await pool.end(); await db.drop(); }, 60000);

  async function project({ quote = "Fees were the main reason I left.", withSource = true } = {}) {
    const run = await id("insert into runs(tenant_id,project_name,decision_statement) values($1,'R','Whether to cut fees') returning id", [tenant]);
    const decision = await id("insert into decision_candidates(tenant_id,run_id,candidate_text,rationale,source,status) values($1,$2,'Whether to cut fees','r','researcher_authored','accepted') returning id", [tenant, run]);
    await q("insert into objective_candidates(tenant_id,run_id,candidate_text,rationale,source,status) values($1,$2,'Understand why members leave','r','researcher_authored','accepted')", [tenant, run]);
    // The report's text holds the finding's quote, so the quote can be checked and the insight's support reads current.
    const doc = withSource ? await id("insert into documents(tenant_id,run_id,kind,source_filename,storage_path,extracted_text) values($1,$2,'report','exit-interviews.pdf','x',$3) returning id", [tenant, run, `Exit interviews. ${quote} Other reasons were rare.`]) : null;
    const finding = await id(
      "insert into findings(tenant_id,run_id,origin,finding_text,status,source_document_id,source_page,source_quote,stated_stats) values($1,$2,'stated','Fees drive leaving','accepted',$3,4,$4,$5) returning id",
      [tenant, run, doc, quote, JSON.stringify({ base: 200, share_pct: 41 })],
    );
    await q("insert into verdicts (tenant_id, finding_id, verdict_tier, rationale, statistical_checks, verification_method, corroboration_level) values ($1,$2,'robust','ok','{}','single_pass','single_source')", [tenant, finding]);
    const pre = await id("insert into insights(tenant_id,run_id,finding_id,headline,observation,tension,implication) values($1,$2,$3,'Fees push members out','o','t','i') returning id", [tenant, run, finding]);
    const si = await id("insert into synthesized_insights(tenant_id,run_id,headline,observation,tension,implication,review_status,action_plan_status) values($1,$2,'Fees are the exit trigger','o','t','i','accepted','has_action') returning id", [tenant, run]);
    // Its support recorded when drafted, as synthesis records it, so the insight's support can be checked.
    await q("insert into synthesized_insight_sources(synthesized_insight_id,pre_insight_id,tenant_id,support_snapshot) values($1,$2,$3,finding_support_parts($4))", [si, pre, tenant, finding]);
    const rec = await id("insert into recommendations(tenant_id,run_id,synthesized_insight_id,action_text,owner_role,owner_feasibility_note,timeline,metric,priority,assumptions_and_risks,alternatives_considered,source,status) values($1,$2,$3,'Cut the monthly fee for at-risk members','Head of Retention','n','Q1','m','high','a','b','ai_suggested','accepted') returning id", [tenant, run, si]);
    return { run, decision, finding, si, rec };
  }
  const trail = async (run: string, rec: string) => {
    const { withTenantRead } = await import("../db");
    const { loadEvidenceTrail, loadTrailContext } = await import("../evidenceTrail");
    const context = await loadTrailContext(tenant, run);
    return withTenantRead(tenant, (client) => loadEvidenceTrail(client, tenant, run, rec, context)) as unknown as Promise<{ purpose: Node[]; root: Node }>;
  };
  const decide = async (rec: string, decision: string) =>
    q("insert into recommendation_decisions(recommendation_id,decision_candidate_id,decision_text,position,origin,tenant_id) values($1,$2,'Whether to cut fees',0,'model',$3)", [rec, decision, tenant]);

  it("traces a recommendation to its decision, objective, insight, finding, data point and source, with no breaks", async () => {
    const p = await project();
    await decide(p.rec, p.decision);
    await (await import("../objectiveValidator")).generateObjectiveValidation(tenant, p.run);
    const t = await trail(p.run, p.rec);
    expect(t.purpose.map((n) => [n.kind, n.label, n.state])).toEqual([
      ["decision", "Whether to cut fees", "current"],
      ["objective", "Understand why members leave", "current"],
    ]);
    expect(flat(t.root).map((n) => [n.kind, n.state])).toEqual([
      ["recommendation", "current"], ["insight", "current"], ["pre_insight", "current"], ["finding", "current"], ["data", "current"], ["source", "current"],
    ]);
    expect(flat(t.root).find((n) => n.kind === "insight")!.details).toContain("Support current");
    const nodes = flat(t.root);
    expect(nodes.find((n) => n.kind === "data")).toMatchObject({ label: '"Fees were the main reason I left."', details: ["base: 200", "share pct: 41"] });
    expect(nodes.find((n) => n.kind === "source")!.label).toBe("exit-interviews.pdf, p. 4");
    expect(nodes.find((n) => n.kind === "finding")!.details).toEqual(["Origin: stated", "Verdict: robust", "Route: Stated"]);
  });

  // B37-F01 (Codex): rejecting the only finding broke the insight and finding in the trail, but its
  // objective still read "Coverage: answered", current, with no note.
  // CE-6: a finding committed from a table moved from the analysis plan is "planned"; the trail shows the
  // plan line and the objective it was planned for, after the finding's data point.
  it("CE-6: a planned finding shows its plan line and objective in the trail", async () => {
    const p = await project();
    const data = await id("insert into documents(tenant_id,run_id,kind,source_filename,storage_path,ingestion_type) values($1,$2,'table','survey.csv','x','raw') returning id", [tenant, p.run]);
    const line = { evidenceId: "00000000-0000-0000-0000-000000000001", revision: 2, approvedRevision: 2, question: "Do women buy more than men?", itemKind: "objective", itemText: "Understand why members leave", objectiveCandidateId: null, decisionCandidateId: null };
    const table = await id("insert into document_tables(tenant_id,run_id,document_id,table_index,ingestion_type,crosstab,crosstab_status,plan_line) values($1,$2,$3,1000,'aggregated','{}','committed',$4) returning id", [tenant, p.run, data, JSON.stringify(line)]);
    await q("update findings set origin = 'generated', source_table_id = $2, source_document_id = null where id = $1", [p.finding, table]);
    const t = await trail(p.run, p.rec);
    const finding = flat(t.root).find((n) => n.kind === "finding")!;
    expect(finding.details).toContain("Route: Planned");
    const plan = finding.children.find((n) => n.kind === "plan")!;
    expect(plan).toMatchObject({ label: "Do women buy more than men?", state: "current", details: ["For the objective: Understand why members leave", "Approved in the analysis plan"] });
    expect(finding.children[0].kind).toBe("data");
    // Moved before it was approved at this wording: shown, with a caution.
    await q("update document_tables set plan_line = jsonb_set(plan_line, '{approvedRevision}', 'null') where id = $1", [table]);
    const unapproved = flat((await trail(p.run, p.rec)).root).find((n) => n.kind === "plan")!;
    expect(unapproved).toMatchObject({ state: "caution", note: expect.stringMatching(/not approved at this wording/) });
  });

  it("B37-F01: rejecting the sole finding makes the objective it answered not current in the trail, saying why", async () => {
    const p = await project();
    await decide(p.rec, p.decision);
    await (await import("../objectiveValidator")).generateObjectiveValidation(tenant, p.run);
    const { setFindingStatus } = await import("../findingActions");
    expect(await setFindingStatus(p.run, p.finding, "rejected")).toEqual({ ok: true });
    const t = await trail(p.run, p.rec);
    const objective = t.purpose.find((n) => n.kind === "objective")!;
    expect(objective).toMatchObject({ label: "Understand why members leave", state: "broken", details: expect.arrayContaining(["Coverage: answered"]) });
    expect(objective.note).toMatch(/^Not supported now: an insight this conclusion cites no longer has valid support/);
    expect(flat(t.root).find((n) => n.kind === "insight")!.state).toBe("broken");
    // Checking again cites nothing unsupported: no accepted insight has valid support, so it refuses and the trail keeps saying so.
    await expect((await import("../objectiveValidator")).generateObjectiveValidation(tenant, p.run)).rejects.toThrow(/No accepted insight has valid support now/);
    expect((await trail(p.run, p.rec)).purpose.find((n) => n.kind === "objective")!.state).toBe("broken");
  });

  it("shows each break: out-of-date coverage, a decision no longer current, a finding deleted from beneath it, no source, unchecked coverage, no decision", async () => {
    const p = await project();
    await decide(p.rec, p.decision);
    await (await import("../objectiveValidator")).generateObjectiveValidation(tenant, p.run);
    await q("insert into objective_candidates(tenant_id,run_id,candidate_text,rationale,source,status) values($1,$2,'A later objective','r','researcher_authored','accepted')", [tenant, p.run]);
    await q("update decision_candidates set status='rejected' where id=$1", [p.decision]);
    let t = await trail(p.run, p.rec);
    expect(t.purpose.find((n) => n.kind === "decision")).toMatchObject({ state: "caution", note: "No longer a current decision." });
    expect(t.purpose.find((n) => n.kind === "objective")).toMatchObject({ state: "caution", note: expect.stringMatching(/^Out of date: the objectives and the decisions changed/) });
    await q("delete from verdicts where finding_id=$1", [p.finding]);
    await q("delete from findings where id=$1", [p.finding]);
    t = await trail(p.run, p.rec);
    // Deleting a finding removes the pre-insight written from it (foreign key cascade): the insight now
    // says it has nothing beneath it, as a break.
    expect(flat(t.root).find((n) => n.kind === "pre_insight")).toMatchObject({ label: "No supporting pre-insights remain", state: "broken" });

    const bare = await project({ withSource: false, quote: "" });
    t = await trail(bare.run, bare.rec);
    expect(t.purpose.map((n) => [n.label, n.state])).toEqual([
      ["Decision served: not recorded", "broken"],
      ["Objective answered: not checked yet", "broken"],
    ]);
    expect(flat(t.root).find((n) => n.kind === "source")).toMatchObject({ label: "Source not recorded", state: "broken" });
  });

  it("prints the trail in the Word report's appendix, with every break and qualification stated", async () => {
    const p = await project({ withSource: false, quote: "" });
    const t = await trail(p.run, p.rec);
    const { trailOutline, unreadableTrail } = await import("../evidenceTrail");
    const lines = trailOutline(t as never);
    expect(lines[0]).toMatchObject({ depth: 0, state: "broken", text: "Decision: Decision served: not recorded [Break in the trail: No decision was recorded for this recommendation.]" });
    expect(lines.find((l) => l.text.startsWith("Source:"))).toMatchObject({ depth: 5, text: "Source: Source not recorded [Break in the trail: The finding names no source file.]" });
    const { buildNarrativeReportDocx } = await import("../docxReport");
    const JSZip = (await import("jszip")).default;
    const base = {
      title: "Trail", decisionStatement: null, audience: null, businessProblem: null, researchObjective: null, entryPoint: null, methodology: null,
      executiveSummary: "S.", situation: "S.", complication: "C.", question: "Q?", governingThought: "T.", documents: [], findings: [], chartImagesByTheme: [],
      objectiveItems: [], unmappedInsightHeadlines: [], pillars: [], recommendationsIntro: "", recommendations: [], caveats: [], generatedAt: "2026-10-26T10:00:00Z",
    };
    const text = async (input: object) =>
      (await (await JSZip.loadAsync(await buildNarrativeReportDocx(input as Parameters<typeof buildNarrativeReportDocx>[0]))).file("word/document.xml")!.async("string")).replace(/<[^>]+>/g, "");
    const doc = await text({ ...base, evidenceTrails: [t, unreadableTrail("Raise the joining fee", "connection reset")] });
    expect(doc).toContain("Appendix: evidence trails");
    expect(doc).toContain("Source: Source not recorded [Break in the trail: The finding names no source file.]");
    expect(doc).toContain("Recommendation: Raise the joining fee [Break in the trail: The evidence trail could not be read: connection reset]");
    expect(await text(base)).not.toContain("Appendix: evidence trails");
  });

  it("refuses a recommendation of another project", async () => {
    const a = await project();
    const b = await project();
    await expect(trail(a.run, b.rec)).rejects.toThrow(/not in this project/);
  });
});
describe.skipIf(!!TEST_DATABASE_URL)("CE-5 evidence trail of a recommendation", () => {
  it.skip(DISPOSABLE_DB_SKIP_REASON, () => {});
});
