// Batch 64, Codex EC10K-F02: unfinished model results were published at several research stages. Each stage
// below took the first tool block without requiring a finished stop or checking the tool's name, so a
// response cut off at max_tokens (which can carry a complete-looking block) was written as verdicts,
// clusters, a synthesized insight, recommendations or coverage. Each now uses the authoritative rule
// (modelToolResult.ts finishedToolInput). Real disposable PostgreSQL, the ACTUAL stage functions; only the
// model is controlled. For each stage: a cut-off, refused or other-tool answer publishes nothing, the
// results already there stay as they were, and the next finished answer recovers.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { createDisposableDb, DISPOSABLE_DB_SKIP_REASON, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";
import { insertSupportedInsight } from "./helpers/supportedInsight";

vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn(async () => {}) }));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));
vi.mock("../recommendationQualityScorer", () => ({ refreshRecommendationQuality: vi.fn(async () => {}) }));
vi.mock("../objectiveQualityScorer", () => ({ refreshObjectiveQuality: vi.fn(async () => {}) }));
vi.mock("../contradictionDetector", async (orig) => ({ ...(await orig<object>()), refreshContradictions: vi.fn(async () => {}) }));
type Req = { tool_choice?: { name?: string }; messages: { content: string }[] };
const model = vi.hoisted(() => ({ fault: null as null | { tool: string; stop?: string; name?: string } }));
const lines = (text: string, re: RegExp) => [...text.matchAll(re)].map((m) => Number(m[1]));
vi.mock("../anthropic", () => ({
  CLAUDE_MODEL: "controlled",
  anthropic: {
    messages: {
      create: vi.fn(async (req: Req) => {
        const name = req.tool_choice?.name ?? "";
        const text = String(req.messages[0].content);
        let input: unknown;
        if (name === "record_verdicts") input = { verdicts: lines(text, /^(\d+)\. /gm).map((index) => ({ index, verdict_tier: "robust", rationale: "Supported by the source." })) };
        else if (name === "record_clusters") input = { clusters: [{ label: "Service access", member_indices: lines(text, /^(\d+)\. /gm) }] };
        else if (name === "record_synthesized_insight")
          input = { headline: "Service access needs attention", observation: "Waiting is common.", tension: "Access constrains service.", implication: "Review capacity.", action_plan_status: "has_action", materiality_rationale: "It bears on expansion.", passes_validity_gate: true };
        else if (name === "record_recommendations")
          input = {
            recommendations: lines(text, /^(\d+)\. (?:\[[^\]]*\] )?Headline:/gm).map((index) => ({ index, action_text: "Pilot more service capacity", owner_role: "Operations lead", owner_feasibility_note: "Existing team.", timeline: "Next quarter", metric: "Waiting time", priority: "high", assumptions_and_risks: "Observational evidence.", alternatives_considered: "Keep capacity.", decision_indices: [0] })),
          };
        else if (name === "record_validations") input = { validations: [0, 1].map((item_index) => ({ item_index, status: "partial", conclusion: "The service evidence informs the decision.", insight_indices: [0] })) };
        else throw new Error(`unexpected tool ${name}`);
        const fault = model.fault && model.fault.tool === name ? model.fault : null;
        return { stop_reason: fault?.stop ?? "tool_use", usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "tool_use", name: fault?.name ?? name, input }] };
      }),
    },
  },
}));
vi.setConfig({ testTimeout: 120000, hookTimeout: 120000 });

const FAULTS = [
  { label: "cut off at max_tokens", stop: "max_tokens" },
  { label: "refused", stop: "refusal" },
  { label: "another tool's block", name: "record_something_else" },
] as const;

describe.skipIf(!TEST_DATABASE_URL)("unfinished model results are refused at every research stage (EC10K-F02)", () => {
  let db: DisposableDb;
  const tenant = randomUUID();
  const q = async (sql: string, args: unknown[] = []) => (await db.pool.query(sql, args)).rows;
  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    await q("insert into tenants(id,name) values($1,'Unfinished stages')", [tenant]);
  });
  afterAll(async () => {
    const { pool, claimPool } = await import("../db");
    await pool.end();
    await claimPool.end();
    await db?.drop();
  });
  beforeEach(() => {
    model.fault = null;
  });

  const newRun = async () => (await q("insert into runs(tenant_id,entry_point,decision_statement,research_objective) values($1,'generate','Whether to expand service capacity','Understand service access') returning id", [tenant]))[0].id as string;
  const finding = async (run: string, text: string, verdict: string | null = "robust") => {
    const id = (await q("insert into findings(tenant_id,run_id,origin,finding_text,status,theme) values($1,$2,'stated',$3,'accepted','Access') returning id", [tenant, run, text]))[0].id as string;
    if (verdict) await q("insert into verdicts(tenant_id,finding_id,verdict_tier,rationale,verification_method,corroboration_level) values($1,$2,$3,'Earlier judgement.','single_pass','single_source')", [tenant, id, verdict]);
    return id;
  };
  const preInsight = async (run: string, text: string) => {
    const f = await finding(run, text);
    return (await q("insert into insights(tenant_id,run_id,finding_id,headline,observation,tension,implication,support_snapshot) values($1,$2,$3,$4,'o','t','i',finding_support_parts($3)) returning id", [tenant, run, f, `Pre ${text}`]))[0].id as string;
  };

  for (const fault of FAULTS) {
    it(`verification (${fault.label}): no verdict written, earlier verdicts stay, a finished answer recovers`, async () => {
      const run = await newRun();
      const judged = await finding(run, "Judged earlier.", "use_with_caution");
      const fresh = [await finding(run, "Waiting was common.", null), await finding(run, "Help came late.", null)];
      const earlier = await q("select id, verdict_tier, rationale from verdicts where finding_id=$1", [judged]);
      const { verifyFindings } = await import("../verifyFindings");
      model.fault = { tool: "record_verdicts", ...fault };
      await expect(verifyFindings(tenant, run)).rejects.toThrow(/nothing from it was used|Nothing in this pass was marked as verified/);
      expect(await q("select id from verdicts where finding_id = any($1::uuid[])", [fresh])).toEqual([]);
      expect(await q("select id, verdict_tier, rationale from verdicts where finding_id=$1", [judged])).toEqual(earlier);
      model.fault = null;
      await verifyFindings(tenant, run);
      expect((await q("select distinct finding_id from verdicts where finding_id = any($1::uuid[])", [fresh])).length).toBe(2);
    });

    it(`clustering (${fault.label}): no synthesized insight, the failure is recorded, an earlier insight stays, a finished answer recovers`, async () => {
      const run = await newRun();
      const earlier = await insertSupportedInsight(db.pool, tenant, run, "Earlier accepted");
      await preInsight(run, "Waiting was common.");
      await preInsight(run, "Help came late.");
      const { refreshSynthesizedInsights } = await import("../insightSynthesizer");
      model.fault = { tool: "record_clusters", ...fault };
      await refreshSynthesizedInsights(tenant, run);
      expect(await q("select id, review_status from synthesized_insights where run_id=$1", [run])).toEqual([{ id: earlier.insightId, review_status: "accepted" }]);
      const errors = await q("select detail from trace where run_id=$1 and event='insight_synthesizer_error'", [run]);
      expect(errors.at(-1)!.detail.message).toMatch(/The grouping of pre-insights .*nothing from it was used/);
      model.fault = null;
      await refreshSynthesizedInsights(tenant, run);
      expect((await q("select id from synthesized_insights where run_id=$1", [run])).length).toBe(2);
    });

    it(`cluster synthesis (${fault.label}, both attempts): nothing published, the reason is traced, a finished answer recovers`, async () => {
      const run = await newRun();
      await preInsight(run, "Waiting was common.");
      await preInsight(run, "Help came late.");
      const { synthesizeInsights } = await import("../insightSynthesizer");
      model.fault = { tool: "record_synthesized_insight", ...fault };
      await synthesizeInsights(tenant, run);
      expect(await q("select id from synthesized_insights where run_id=$1", [run])).toEqual([]);
      const summary = (await q("select detail from trace where run_id=$1 and event='insight_synthesizer_summary'", [run])).at(-1)!.detail;
      expect(summary.outcomes[0]).toMatchObject({ outcome: "dropped_unusable_response" });
      expect(summary.outcomes[0].detail).toMatch(/no finished result after 2 attempt\(s\)/);
      model.fault = null;
      await synthesizeInsights(tenant, run);
      expect((await q("select id from synthesized_insights where run_id=$1", [run])).length).toBe(1);
    });

    it(`synthesized recommendations (${fault.label}): none written, the run is recorded incomplete, an earlier one stays, a finished answer recovers`, async () => {
      const run = await newRun();
      const kept = await insertSupportedInsight(db.pool, tenant, run, "Has one");
      const keptRec = (await q("insert into recommendations(tenant_id,run_id,synthesized_insight_id,action_text,owner_role,owner_feasibility_note,timeline,metric,priority,assumptions_and_risks,alternatives_considered,status) values($1,$2,$3,'Earlier action','o','f','t','m','high','a','alt','accepted') returning id", [tenant, run, kept.insightId]))[0].id;
      const target = await insertSupportedInsight(db.pool, tenant, run, "Needs one");
      const { generateSynthesizedRecommendations } = await import("../recommendationAgent");
      model.fault = { tool: "record_recommendations", ...fault };
      await expect(generateSynthesizedRecommendations(tenant, run)).rejects.toThrow(/No usable recommendations came back.*nothing from it was used/);
      expect(await q("select id from recommendations where run_id=$1", [run])).toEqual([{ id: keptRec }]);
      const recorded = (await q("select detail from trace where run_id=$1 and event='synthesized_recommendation_run'", [run])).at(-1)!.detail;
      expect(recorded).toMatchObject({ requested: 1, covered: 0, complete: false });
      model.fault = null;
      await generateSynthesizedRecommendations(tenant, run);
      expect((await q("select synthesized_insight_id from recommendations where run_id=$1 order by created_at", [run])).map((r) => r.synthesized_insight_id)).toEqual([kept.insightId, target.insightId]);
    });

    it(`pre-insight recommendations (${fault.label}): none written, a finished answer recovers`, async () => {
      const run = await newRun();
      const pre = await preInsight(run, "Waiting was common.");
      const { generateRecommendations } = await import("../recommendationAgent");
      model.fault = { tool: "record_recommendations", ...fault };
      await expect(generateRecommendations(tenant, run)).rejects.toThrow(/nothing from it was used/);
      expect(await q("select id from recommendations where run_id=$1", [run])).toEqual([]);
      model.fault = null;
      await generateRecommendations(tenant, run);
      expect((await q("select insight_id from recommendations where run_id=$1", [run])).map((r) => r.insight_id)).toEqual([pre]);
    });

    it(`objective coverage (${fault.label}): nothing saved, the earlier coverage stays, a finished answer recovers`, async () => {
      const run = await newRun();
      await q("insert into objective_candidates(tenant_id,run_id,candidate_text,rationale,source,status) values($1,$2,'Understand service access','r','researcher_authored','accepted')", [tenant, run]);
      await q("insert into decision_candidates(tenant_id,run_id,candidate_text,rationale,source,status) values($1,$2,'Whether to expand service capacity','r','researcher_authored','accepted')", [tenant, run]);
      await insertSupportedInsight(db.pool, tenant, run, "Service access");
      const { generateObjectiveValidation } = await import("../objectiveValidator");
      await generateObjectiveValidation(tenant, run);
      const before = await q("select id, conclusion from objective_validations where run_id=$1 order by id", [run]);
      expect(before.length).toBe(2);
      model.fault = { tool: "record_validations", ...fault };
      await expect(generateObjectiveValidation(tenant, run)).rejects.toThrow(/The objective coverage check .*nothing from it was used/);
      expect(await q("select id, conclusion from objective_validations where run_id=$1 order by id", [run])).toEqual(before);
      model.fault = null;
      await generateObjectiveValidation(tenant, run);
      expect((await q("select id from objective_validations where run_id=$1", [run])).length).toBe(2);
    });
  }
});

// The family guard: every forced tool call in src/lib reads its result through finishedToolInput (or
// finishedToolResult, its value-returning form). A new forced call that parses the first tool block itself
// fails this test.
describe("every forced model tool call uses the finished-result rule (EC10K-F02 sweep)", () => {
  const OUTSIDE_THE_RULE: Record<string, string> = {};
  it("lists no other forced call parsed without it", () => {
    const dir = path.join(process.cwd(), "src", "lib");
    const forced = readdirSync(dir)
      .filter((f) => f.endsWith(".ts") && f !== "modelToolResult.ts")
      .filter((f) => /tool_choice:\s*\{\s*type:\s*"tool"/.test(readFileSync(path.join(dir, f), "utf8")));
    const without = forced.filter((f) => !/finishedTool(Input|Result)\(/.test(readFileSync(path.join(dir, f), "utf8"))).sort();
    expect(without).toEqual(Object.keys(OUTSIDE_THE_RULE).sort());
    // No forced call may still pick the first tool block itself, even in a file that also uses the rule.
    const stillPicking = forced.filter((f) => /content\.find\(\(\w+\)(?:: [^)]*)? => \w+\.type === "tool_use"\)/.test(readFileSync(path.join(dir, f), "utf8")));
    expect(stillPicking).toEqual([]);
    expect(forced.length).toBeGreaterThan(20);
  });
});

describe.skipIf(!!TEST_DATABASE_URL)("real-database checks for batch 64", () => {
  it.skip(DISPOSABLE_DB_SKIP_REASON, () => {});
});
