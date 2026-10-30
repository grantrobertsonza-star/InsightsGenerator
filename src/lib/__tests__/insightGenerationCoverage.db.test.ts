// Batch 64, Codex EC10K-F01 and EC10K-F02 (insight stage). Real disposable PostgreSQL; the ACTUAL
// insight generator and its automatic wrapper (refreshInsights); the model is the only thing controlled.
//   F01: a pass wrote the valid subset and reported done; findings left out of the answer, or returned
//     with a blank part, were never accounted for, and the automatic wrapper stopped at its pass limit
//     (480 of 500) reporting success. Now every eligible finding is written or named with its reason, a
//     finished answer that left findings out is asked once more for just those, the wrapper reports what
//     remains, and a retry drafts only the rest (one pre-insight per finding, never two).
//   F02: a cut-off, refused, other-tool or wrong-shape answer was published as finished pre-insights.
//     Now it is refused visibly, earlier pre-insights stay, and the next finished answer recovers.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createDisposableDb, DISPOSABLE_DB_SKIP_REASON, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";

vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn(async () => {}) }));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));
type Req = { tool_choice?: { name?: string }; messages: { content: string }[] };
type Item = { index: number; headline: string; observation: string; tension: string; implication: string };
const model = vi.hoisted(() => ({
  // Shapes each answer: the items the model would write for the listed findings, and the response around them.
  answer: null as null | ((items: Item[], text: string, call: number) => { stop?: string; name?: string; input?: unknown; throws?: boolean }),
  calls: 0,
}));
vi.mock("../anthropic", () => ({
  CLAUDE_MODEL: "controlled",
  anthropic: {
    messages: {
      create: vi.fn(async (req: Req) => {
        const name = req.tool_choice?.name ?? "";
        if (name !== "record_insights") throw new Error(`unexpected tool ${name}`);
        const text = String(req.messages[0].content);
        const items = [...text.matchAll(/^(\d+)\. \[[^\n]*?\] (.*)$/gm)].map((m) => ({ index: Number(m[1]), headline: "Access matters", observation: m[2], tension: "It constrains service.", implication: "Review capacity." }));
        model.calls += 1;
        const shaped = model.answer ? model.answer(items, text, model.calls) : {};
        if (shaped.throws) throw new Error("Temporary provider outage");
        return {
          stop_reason: shaped.stop ?? "tool_use",
          usage: { input_tokens: 1, output_tokens: 1 },
          content: [{ type: "tool_use", name: shaped.name ?? name, input: shaped.input ?? { insights: items } }],
        };
      }),
    },
  },
}));
vi.setConfig({ testTimeout: 120000, hookTimeout: 120000 });

describe.skipIf(!TEST_DATABASE_URL)("insight generation accounts for every verified finding (EC10K-F01, F02)", () => {
  let db: DisposableDb;
  const tenant = randomUUID();
  const q = async (sql: string, args: unknown[] = []) => (await db.pool.query(sql, args)).rows;
  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    await q("insert into tenants(id,name) values($1,'Insight coverage')", [tenant]);
  });
  afterAll(async () => {
    const { pool, claimPool } = await import("../db");
    await pool.end();
    await claimPool.end();
    await db?.drop();
  });
  beforeEach(() => {
    model.answer = null;
    model.calls = 0;
  });

  async function project(count: number, entry: "generate" | "validate" = "generate", decision: string | null = null): Promise<{ run: string; findings: string[] }> {
    const run = (await q("insert into runs(tenant_id,entry_point,decision_statement,research_objective) values($1,$2,$3,'Understand access') returning id", [tenant, entry, decision]))[0].id as string;
    const rows = await q(
      "insert into findings(tenant_id,run_id,origin,finding_text,status,theme) select $1,$2,'stated','Finding '||lpad(g::text,4,'0')||' reports access constraints.','accepted','Access' from generate_series(1,$3::int) g returning id",
      [tenant, run, count],
    );
    await q("insert into verdicts(tenant_id,finding_id,verdict_tier,rationale,verification_method,corroboration_level) select $1,id,'robust','Supported.','single_pass','single_source' from findings where run_id=$2", [tenant, run]);
    return { run, findings: rows.map((r) => r.id as string) };
  }
  const insightCount = async (run: string) => Number((await q("select count(*)::int n, count(distinct finding_id)::int d from insights where run_id=$1", [run]))[0].n);
  const distinctCovered = async (run: string) => Number((await q("select count(distinct finding_id)::int d from insights where run_id=$1", [run]))[0].d);
  const traces = async (run: string, event: string) => q("select detail from trace where run_id=$1 and event=$2 order by occurred_at", [run, event]);

  it("healthy: every verified finding gets one pre-insight, the wrapper reports complete and nothing partial is traced", async () => {
    const { run } = await project(4);
    const { refreshInsights, loadInsightCoverageGap } = await import("../insightGenerator");
    expect(await refreshInsights(tenant, run)).toBeNull();
    expect(await insightCount(run)).toBe(4);
    expect(await traces(run, "insight_generator_partial")).toEqual([]);
    expect((await loadInsightCoverageGap(tenant, run)).uncovered).toBe(0);
  });

  it("skipped and malformed entries among valid ones: asked again for just those, in the same pass", async () => {
    const { run } = await project(4);
    // First answer: finding 0 complete, 1 with a blank part, an index outside the list, 2 and 3 left out.
    model.answer = (items, _t, call) =>
      call === 1 ? { input: { insights: [items[0], { ...items[1], tension: "  " }, { ...items[0], index: 99 }] } } : {};
    const { generateInsights } = await import("../insightGenerator");
    const result = await generateInsights(tenant, run);
    expect(model.calls).toBe(2);
    // The follow-up listed only the three not written.
    expect(result).toMatchObject({ attempted: 4, written: 4, notWritten: [], remaining: 0 });
    expect(await insightCount(run)).toBe(4);
  });

  it("a finding the model keeps leaving out is named, the wrapper reports it, and a retry drafts only it", async () => {
    const { run, findings } = await project(4);
    model.answer = (items, text) => ({ input: { insights: items.filter((i) => !new RegExp(`^${i.index}\\. \\[[^\\n]*\\] Finding 0002`, "m").test(text)) } });
    const { generateInsights, refreshInsights, loadInsightCoverageGap } = await import("../insightGenerator");
    const pass = await generateInsights(tenant, run);
    expect(pass.written).toBe(3);
    expect(pass.notWritten).toEqual([{ findingId: findings[1], reason: "omitted" }]);
    expect(pass.remaining).toBe(1);
    const partial = await traces(run, "insight_generator_partial");
    expect(partial).toHaveLength(1);
    expect(partial[0].detail.not_written).toEqual([{ findingId: findings[1], reason: "omitted" }]);
    // Bounded work never reads as complete: the wrapper says what is left.
    const message = await refreshInsights(tenant, run);
    // The retry pass offers only that finding; it is left out again, so the pass wrote nothing.
    expect(message).toMatch(/No usable insights came back this time \(1 of 1 finding\(s\) not written \(left out of the answer: 1.*1 verified finding\(s\) still have no insight\.$/);
    expect((await traces(run, "insight_generator_error")).length).toBeGreaterThan(0);
    expect(await loadInsightCoverageGap(tenant, run)).toMatchObject({ uncovered: 1, waitingForDecision: false });
    // Recovery: a finished, complete answer covers it; nothing is drafted twice.
    model.answer = null;
    expect(await refreshInsights(tenant, run)).toBeNull();
    expect(await insightCount(run)).toBe(4);
    expect(await distinctCovered(run)).toBe(4);
    expect((await loadInsightCoverageGap(tenant, run)).uncovered).toBe(0);
  });

  it("total failure writes nothing, keeps the pre-insights already there, and the wrapper returns the failure", async () => {
    const { run, findings } = await project(3);
    const { generateInsights, refreshInsights } = await import("../insightGenerator");
    model.answer = (items) => ({ input: { insights: items.slice(0, 1) } });
    await generateInsights(tenant, run).catch(() => undefined); // one written before the failure
    const before = await q("select id, finding_id, headline from insights where run_id=$1 order by id", [run]);
    expect(before.length).toBeGreaterThanOrEqual(1);
    model.answer = () => ({ throws: true });
    await expect(generateInsights(tenant, run)).rejects.toThrow(/No usable insights came back this time.*Temporary provider outage/);
    const message = await refreshInsights(tenant, run);
    expect(message).toMatch(/No usable insights came back this time/);
    expect((await traces(run, "insight_generator_error")).length).toBeGreaterThan(0);
    expect(await q("select id, finding_id, headline from insights where run_id=$1 order by id", [run])).toEqual(before);
    model.answer = null;
    expect(await refreshInsights(tenant, run)).toBeNull();
    expect(await distinctCovered(run)).toBe(findings.length);
    expect(await insightCount(run)).toBe(findings.length);
  });

  for (const [label, shape] of [
    ["cut off at max_tokens", { stop: "max_tokens" }],
    ["refused", { stop: "refusal" }],
    ["another tool's block", { name: "record_findings" }],
    ["a wrong-shape answer", { input: { insights: "not a list" } }],
  ] as const) {
    it(`an unfinished answer (${label}) publishes nothing, keeps earlier pre-insights, and the next finished answer recovers`, async () => {
      const { run, findings } = await project(3);
      const { generateInsights, refreshInsights } = await import("../insightGenerator");
      // An earlier pre-insight that must survive the refused pass.
      model.answer = (items) => ({ input: { insights: items.slice(0, 1) } });
      await generateInsights(tenant, run).catch(() => undefined);
      const before = await q("select id, finding_id, headline, observation from insights where run_id=$1 order by id", [run]);
      // Every listed finding answered in full, inside an unfinished response.
      model.answer = () => shape;
      await expect(generateInsights(tenant, run)).rejects.toThrow(/No usable insights came back this time/);
      expect(await q("select id, finding_id, headline, observation from insights where run_id=$1 order by id", [run])).toEqual(before);
      const message = await refreshInsights(tenant, run);
      expect(message).toMatch(/nothing from it was used/);
      model.answer = null;
      expect(await refreshInsights(tenant, run)).toBeNull();
      expect(await insightCount(run)).toBe(findings.length);
      expect(await distinctCovered(run)).toBe(findings.length);
    });
  }

  it("one unfinished chunk among finished ones: the finished chunk is kept, the rest is reported and recovered", async () => {
    const { run } = await project(20); // chunks of 15 and 5
    model.answer = (items) => (items.length === 5 ? { stop: "max_tokens" } : {});
    const { generateInsights, refreshInsights } = await import("../insightGenerator");
    const pass = await generateInsights(tenant, run);
    expect(pass.written).toBe(15);
    expect(pass.notWritten.map((n) => n.reason)).toEqual(Array(5).fill("call_failed"));
    expect(pass.remaining).toBe(5);
    expect(pass.failures.join(" ")).toMatch(/cut off before it finished/);
    model.answer = null;
    expect(await refreshInsights(tenant, run)).toBeNull();
    expect(await insightCount(run)).toBe(20);
  });

  it("bounded passes: 500 verified findings, the first automatic refresh says 20 remain, the second completes without duplicates", async () => {
    const { run } = await project(500);
    const { refreshInsights, MAX_AUTOMATIC_INSIGHT_PASSES } = await import("../insightGenerator");
    expect(MAX_AUTOMATIC_INSIGHT_PASSES).toBe(8);
    const first = await refreshInsights(tenant, run);
    expect(await insightCount(run)).toBe(480);
    expect(first).toMatch(/^20 verified finding\(s\) still have no insight after 8 pass\(es\); 20 were not reached within the pass limit/);
    const recorded = await traces(run, "insight_generator_incomplete");
    expect(recorded.at(-1)!.detail).toMatchObject({ remaining: 20, passes: 8, not_written: 0 });
    expect(await refreshInsights(tenant, run)).toBeNull();
    expect(await insightCount(run)).toBe(500);
    expect(await distinctCovered(run)).toBe(500);
  });

  it("a validate project with no decision yet is waiting, not incomplete", async () => {
    const { run } = await project(2, "validate", null);
    const { generateInsights, refreshInsights, loadInsightCoverageGap } = await import("../insightGenerator");
    expect(await generateInsights(tenant, run)).toMatchObject({ waitingForDecision: true, written: 0 });
    expect(await refreshInsights(tenant, run)).toBeNull();
    expect(await loadInsightCoverageGap(tenant, run)).toMatchObject({ waitingForDecision: true });
    expect(model.calls).toBe(0);
  });
});

describe.skipIf(!!TEST_DATABASE_URL)("real-database checks for batch 64", () => {
  it.skip(DISPOSABLE_DB_SKIP_REASON, () => {});
});
