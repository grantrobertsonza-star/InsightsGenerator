// REC-001 and REC-002 against a REAL PostgreSQL (disposable database from the migrations) through
// the app's own db.ts. Only the model, the quality scorers and Next's revalidatePath are mocked.
//   REC-001  the actual add actions refuse an anchor from another project (or a deleted / not
//            accepted one) and write nothing; a valid anchor is written.
//   REC-002  a generation run where one batch fails and the model skips an insight reports exactly
//            how many are missing (error + persisted trace row), keeps what was written, and a retry
//            covers only the missing insights - no duplicates.
// Skipped, with a printed reason, when TEST_DATABASE_URL is not set.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createDisposableDb, DISPOSABLE_DB_SKIP_REASON, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";

const TENANT = "00000000-0000-4000-8000-0000000000cc";
const model = vi.hoisted(() => ({ mode: "partial" as "partial" | "all", calls: 0 }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn() }));
vi.mock("../recommendationQualityScorer", () => ({ refreshRecommendationQuality: vi.fn() }));
vi.mock("../objectiveQualityScorer", () => ({ refreshObjectiveQuality: vi.fn() }));
vi.mock("../anthropic", () => ({
  CLAUDE_MODEL: "test-model",
  anthropic: {
    messages: {
      create: vi.fn(async (req: { messages: { content: string }[] }) => {
        model.calls++;
        const count = (req.messages[0].content.match(/^\d+\. Headline:/gm) ?? []).length;
        const firstBatch = /Headline: Insight 01\b/.test(req.messages[0].content);
        if (model.mode === "partial" && !firstBatch) throw new Error("overloaded");
        const skip = model.mode === "partial" ? 3 : -1; // the model leaves one insight out
        const recommendations = Array.from({ length: count }, (_, index) => index)
          .filter((index) => index !== skip)
          .map((index) => ({
            index,
            action_text: `Act ${index}`,
            owner_role: "Lead",
            owner_feasibility_note: "n",
            timeline: "Q1",
            metric: "m",
            priority: "high",
            assumptions_and_risks: "a",
            alternatives_considered: "b",
          }));
        return { stop_reason: "tool_use", usage: {}, content: [{ type: "tool_use", input: { recommendations } }] };
      }),
    },
  },
}));

const fields = {
  action_text: "Do the thing",
  owner_role: "Lead",
  owner_feasibility_note: "n",
  timeline: "Q1",
  metric: "m",
  priority: "high" as const,
  assumptions_and_risks: "a",
  alternatives_considered: "b",
};

describe.skipIf(!TEST_DATABASE_URL)("recommendation integrity (real database)", () => {
  let db: DisposableDb;
  let runA = "";
  let runB = "";
  const one = async (sql: string, p: unknown[]) => (await db.pool.query(sql, p)).rows[0].id as string;
  const synthesized = async (run: string, headline: string, status = "accepted") => {
    const f = await one(`insert into findings (tenant_id, run_id, origin, finding_text, status) values ($1, $2, 'generated', $3, 'accepted') returning id`, [TENANT, run, headline]);
    const pi = await one(`insert into insights (tenant_id, run_id, finding_id, headline, observation, tension, implication) values ($1, $2, $3, $4, 'o', 't', 'i') returning id`, [TENANT, run, f, headline]);
    const si = await one(
      `insert into synthesized_insights (tenant_id, run_id, headline, observation, tension, implication, triangulation_count, source_theme_count, review_status)
       values ($1, $2, $3, 'o', 't', 'i', 1, 1, $4) returning id`,
      [TENANT, run, headline, status],
    );
    await db.pool.query(`insert into synthesized_insight_sources (tenant_id, synthesized_insight_id, pre_insight_id) values ($1, $2, $3)`, [TENANT, si, pi]);
    return { si, pi };
  };
  const recCount = async (where: string, p: unknown[]) => Number((await db.pool.query(`select count(*) from recommendations where ${where}`, p)).rows[0].count);

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = TENANT;
    await db.pool.query(`insert into tenants (id, name) values ($1, 'T')`, [TENANT]);
    runA = await one(`insert into runs (tenant_id, decision_statement) values ($1, 'Decide A') returning id`, [TENANT]);
    runB = await one(`insert into runs (tenant_id, decision_statement) values ($1, 'Decide B') returning id`, [TENANT]);
  }, 120000);
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool?.end?.();
    await db?.drop();
  });
  beforeEach(() => {
    model.calls = 0;
  });

  it("REC-001: an anchor from another project, or one not accepted, is refused and nothing is written; a valid one is", async () => {
    const { addOwnSynthesizedRecommendation, addOwnRecommendation } = await import("../recommendationActions");
    const foreign = await synthesized(runB, "Insight in project B");
    const rejected = await synthesized(runA, "Rejected insight in A", "rejected");
    const own = await synthesized(runA, "Own insight in A");

    const cross = await addOwnSynthesizedRecommendation(runA, foreign.si, fields);
    expect(cross.ok).toBe(false);
    const crossPre = await addOwnRecommendation(runA, foreign.pi, fields);
    expect(crossPre.ok).toBe(false);
    expect((await addOwnSynthesizedRecommendation(runA, rejected.si, fields)).ok).toBe(false);
    expect((await addOwnSynthesizedRecommendation(runA, "00000000-0000-4000-8000-00000000dead", fields)).ok).toBe(false);
    expect(await recCount("run_id = $1", [runA])).toBe(0);
    expect(await recCount("synthesized_insight_id = $1 or insight_id = $2", [foreign.si, foreign.pi])).toBe(0);

    expect(await addOwnSynthesizedRecommendation(runA, own.si, fields)).toEqual({ ok: true });
    expect(await addOwnRecommendation(runA, own.pi, fields)).toEqual({ ok: true });
    expect(await recCount("run_id = $1", [runA])).toBe(2);
  });

  it("REC-002: a partial run says how many are missing, persists that outcome, keeps what was written, and a retry fills only the gap", async () => {
    const { generateSynthesizedRecommendations } = await import("../recommendationAgent");
    const run = await one(`insert into runs (tenant_id, decision_statement) values ($1, 'Decide C') returning id`, [TENANT]);
    for (let i = 1; i <= 12; i++) await synthesized(run, `Insight ${String(i).padStart(2, "0")}`);

    model.mode = "partial"; // batch 1 (10 insights): one skipped; batch 2 (2 insights): the call fails
    await expect(generateSynthesizedRecommendations(TENANT, run)).rejects.toThrow(
      /Recommendations were written for 9 of 12 insights; 3 still have none \(.*overloaded.*\)\. The ones written are kept/,
    );
    expect(await recCount("run_id = $1", [run])).toBe(9);
    const trace = (await db.pool.query(`select detail from trace where run_id = $1 and event = 'synthesized_recommendation_run' order by occurred_at`, [run])).rows;
    expect(trace[0].detail).toMatchObject({ requested: 12, covered: 9, missing: 3, complete: false });

    model.mode = "all";
    await generateSynthesizedRecommendations(TENANT, run); // complete this time: no error
    expect(await recCount("run_id = $1", [run])).toBe(12);
    const perInsight = await db.pool.query(
      `select synthesized_insight_id, count(*)::int n from recommendations where run_id = $1 group by 1 having count(*) > 1`,
      [run],
    );
    expect(perInsight.rows).toEqual([]); // no duplicates
    const last = (await db.pool.query(`select detail from trace where run_id = $1 and event = 'synthesized_recommendation_run' order by occurred_at desc limit 1`, [run])).rows[0];
    expect(last.detail).toMatchObject({ requested: 3, covered: 3, missing: 0, complete: true });
  });
});

describe.skipIf(!!TEST_DATABASE_URL)("recommendation integrity (real database)", () => {
  it.skip(DISPOSABLE_DB_SKIP_REASON, () => {});
});
