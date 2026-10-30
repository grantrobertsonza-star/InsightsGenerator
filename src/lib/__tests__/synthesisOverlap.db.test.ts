// Batch 64, Codex EC10K-F04: two overlapping synthesis passes read the same unclaimed pre-insights and each
// inserted its own accepted-to-be insight from them (no recheck at the write). The write is now one
// transaction under a per-project lock that reads each candidate's pre-insights again. Real disposable
// PostgreSQL, the ACTUAL synthesizer and recommendation generator; only the model is controlled.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createDisposableDb, DISPOSABLE_DB_SKIP_REASON, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";

vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn(async () => {}) }));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));
vi.mock("../recommendationQualityScorer", () => ({ refreshRecommendationQuality: vi.fn(async () => {}) }));
vi.mock("../objectiveQualityScorer", () => ({ refreshObjectiveQuality: vi.fn(async () => {}) }));
vi.mock("../contradictionDetector", async (orig) => ({ ...(await orig<object>()), refreshContradictions: vi.fn(async () => {}) }));
type Req = { tool_choice?: { name?: string }; messages: { content: string }[] };
// barrier: the first clustering call waits until a second one arrives, so both passes have read the
// same unclaimed pre-insights before either writes.
const model = vi.hoisted(() => ({ barrier: false, waiting: null as null | (() => void) }));
vi.mock("../anthropic", () => ({
  CLAUDE_MODEL: "controlled",
  anthropic: {
    messages: {
      create: vi.fn(async (req: Req) => {
        const name = req.tool_choice?.name ?? "";
        const text = String(req.messages[0].content);
        const idx = (re: RegExp) => [...text.matchAll(re)].map((m) => Number(m[1]));
        let input: unknown;
        if (name === "record_clusters") {
          if (model.barrier) {
            if (!model.waiting) await new Promise<void>((resolve) => (model.waiting = resolve));
            else {
              model.waiting();
              model.waiting = null;
              model.barrier = false;
            }
          }
          input = { clusters: [{ label: "Service access", member_indices: idx(/^(\d+)\. /gm) }] };
        } else if (name === "record_synthesized_insight")
          input = { headline: "Service access needs attention", observation: "Waiting is common.", tension: "Access constrains service.", implication: "Review capacity.", action_plan_status: "has_action", materiality_rationale: "It bears on expansion.", passes_validity_gate: true };
        else if (name === "record_recommendations")
          input = { recommendations: idx(/^(\d+)\. Headline:/gm).map((index) => ({ index, action_text: "Pilot more service capacity", owner_role: "Ops", owner_feasibility_note: "Existing team.", timeline: "Next quarter", metric: "Waiting time", priority: "high", assumptions_and_risks: "Observational.", alternatives_considered: "Keep capacity.", decision_indices: [0] })) };
        else throw new Error(`unexpected tool ${name}`);
        return { stop_reason: "tool_use", usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "tool_use", name, input }] };
      }),
    },
  },
}));
vi.setConfig({ testTimeout: 120000, hookTimeout: 120000 });

describe.skipIf(!TEST_DATABASE_URL)("overlapping synthesis writes each pattern once (EC10K-F04)", () => {
  let db: DisposableDb;
  const tenant = randomUUID();
  const q = async (sql: string, args: unknown[] = []) => (await db.pool.query(sql, args)).rows;
  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    await q("insert into tenants(id,name) values($1,'Synthesis overlap')", [tenant]);
    // A switch the rollback case uses to make the source-link insert fail inside the write transaction.
    await q("create table test_fail_sources(on_ boolean)");
    await q(`create function test_fail_sources_fn() returns trigger language plpgsql as $$ begin if exists (select 1 from test_fail_sources) then raise exception 'injected failure while linking sources'; end if; return new; end $$`);
    await q("create trigger test_fail_sources_tr before insert on synthesized_insight_sources for each row execute function test_fail_sources_fn()");
  });
  afterAll(async () => {
    const { pool, claimPool } = await import("../db");
    await pool.end();
    await claimPool.end();
    await db?.drop();
  });
  beforeEach(() => {
    model.barrier = false;
    model.waiting = null;
  });

  const newRun = async () => (await q("insert into runs(tenant_id,entry_point,decision_statement) values($1,'generate','Whether to expand service capacity') returning id", [tenant]))[0].id as string;
  const preInsights = async (run: string, texts: string[]) => {
    const ids: string[] = [];
    for (const text of texts) {
      const f = (await q("insert into findings(tenant_id,run_id,origin,finding_text,status,theme) values($1,$2,'stated',$3,'accepted','Access') returning id", [tenant, run, text]))[0].id;
      await q("insert into verdicts(tenant_id,finding_id,verdict_tier,rationale,verification_method,corroboration_level) values($1,$2,'robust','Supported.','single_pass','single_source')", [tenant, f]);
      ids.push((await q("insert into insights(tenant_id,run_id,finding_id,headline,observation,tension,implication,support_snapshot) values($1,$2,$3,$4,'o','t','i',finding_support_parts($3)) returning id", [tenant, run, f, `Pre ${text}`]))[0].id);
    }
    return ids;
  };
  const synthesized = async (run: string) => q("select id, review_status, triangulation_count from synthesized_insights where run_id=$1 order by created_at, id", [run]);
  const links = async (run: string) => q("select s.pre_insight_id, count(*)::int n from synthesized_insight_sources s join synthesized_insights si on si.id=s.synthesized_insight_id where si.run_id=$1 group by s.pre_insight_id", [run]);

  it("two passes that read the same pre-insights write one insight; the other is recorded, not written", async () => {
    const run = await newRun();
    await preInsights(run, ["Waiting was common.", "Help came late."]);
    const { synthesizeInsights } = await import("../insightSynthesizer");
    model.barrier = true;
    await Promise.all([synthesizeInsights(tenant, run), synthesizeInsights(tenant, run)]);
    const rows = await synthesized(run);
    expect(rows).toHaveLength(1);
    expect(rows[0].triangulation_count).toBe(2);
    expect((await links(run)).every((l) => l.n === 1)).toBe(true);
    const recorded = await q("select detail from trace where run_id=$1 and event='insight_synthesizer_claimed_meanwhile'", [run]);
    expect(recorded).toHaveLength(1);
    expect(recorded[0].detail.not_written[0].reason).toMatch(/2 of its 2 pre-insights were claimed/);
  });

  it("a lost reply and sequential retries write nothing more; the researcher's decision and recommendation stand", async () => {
    const run = await newRun();
    await preInsights(run, ["Waiting was common.", "Help came late."]);
    const { synthesizeInsights } = await import("../insightSynthesizer");
    await synthesizeInsights(tenant, run); // committed; the caller never saw the reply
    const [first] = await synthesized(run);
    // The researcher accepts it (set directly: the action itself needs a signed-in request).
    await q("update synthesized_insights set review_status='accepted' where id=$1", [first.id]);
    await (await import("../recommendationAgent")).generateSynthesizedRecommendations(tenant, run);
    const recs = await q("select id, synthesized_insight_id from recommendations where run_id=$1", [run]);
    for (let retry = 0; retry < 3; retry++) await synthesizeInsights(tenant, run);
    expect(await synthesized(run)).toEqual([{ ...first, review_status: "accepted" }]);
    expect(await q("select id, synthesized_insight_id from recommendations where run_id=$1", [run])).toEqual(recs);
  });

  it("a genuinely different later synthesis (new pre-insights) is written beside the first", async () => {
    const run = await newRun();
    await preInsights(run, ["Waiting was common.", "Help came late."]);
    const { synthesizeInsights } = await import("../insightSynthesizer");
    await synthesizeInsights(tenant, run);
    const [first] = await synthesized(run);
    await q("update synthesized_insights set review_status='accepted' where id=$1", [first.id]);
    const later = await preInsights(run, ["Staff were polite.", "Staff explained the delays."]);
    await synthesizeInsights(tenant, run);
    const rows = await synthesized(run);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ ...first, review_status: "accepted" });
    const secondLinks = await q("select pre_insight_id from synthesized_insight_sources where synthesized_insight_id=$1 order by pre_insight_id", [rows[1].id]);
    expect(secondLinks.map((l) => l.pre_insight_id)).toEqual([...later].sort());
  });

  it("a failure while writing rolls the whole write back; the retry writes exactly one", async () => {
    const run = await newRun();
    await preInsights(run, ["Waiting was common.", "Help came late."]);
    const { synthesizeInsights } = await import("../insightSynthesizer");
    await q("insert into test_fail_sources values (true)");
    try {
      await expect(synthesizeInsights(tenant, run)).rejects.toThrow(/injected failure while linking sources/);
    } finally {
      await q("delete from test_fail_sources");
    }
    expect(await synthesized(run)).toEqual([]);
    await synthesizeInsights(tenant, run);
    expect(await synthesized(run)).toHaveLength(1);
    expect((await links(run)).length).toBe(2);
  });

  it("a pre-insight whose finding was rejected while the model answered keeps its cluster from being written", async () => {
    const run = await newRun();
    const pres = await preInsights(run, ["Waiting was common.", "Help came late."]);
    const { synthesizeInsights } = await import("../insightSynthesizer");
    model.barrier = true;
    const pass = synthesizeInsights(tenant, run);
    while (!model.waiting) await new Promise((r) => setTimeout(r, 5));
    await q("update findings set status='rejected' where id=(select finding_id from insights where id=$1)", [pres[0]]);
    model.waiting!();
    model.waiting = null;
    model.barrier = false;
    await pass;
    expect(await synthesized(run)).toEqual([]);
    expect((await q("select detail from trace where run_id=$1 and event='insight_synthesizer_claimed_meanwhile'", [run]))[0].detail.not_written[0].reason).toMatch(/1 of its 2 pre-insights/);
  });
});

describe.skipIf(!!TEST_DATABASE_URL)("real-database checks for batch 64", () => {
  it.skip(DISPOSABLE_DB_SKIP_REASON, () => {});
});
