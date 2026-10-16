// REC-002 (Codex review 2026-10-16): repeated indices from the model, retries and concurrent runs
// must never create a second AI recommendation for the same insight. Drives the ACTUAL generators
// against a REAL PostgreSQL through the app's own db.ts; only the model, the quality scorers,
// usage logging and the storage client are mocked.
//   - a model response repeating an index writes one recommendation for that insight (first entry)
//   - Codex's boundary: partial run (9 of 12), then a retry whose response repeats an index ->
//     exactly 12 rows for 12 insights
//   - two concurrent runs over the same insights write one recommendation each
//   - a researcher recommendation added while the model is drafting is kept and not duplicated
//   - the pre-insight generator follows the same rule
// Skipped, with a printed reason, when TEST_DATABASE_URL is not set.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createDisposableDb, DISPOSABLE_DB_SKIP_REASON, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";

const TENANT = "00000000-0000-4000-8000-0000000000e1";
type Mode = "all" | "partial" | "repeat";
const model = vi.hoisted(() => ({
  mode: "all" as "all" | "partial" | "repeat",
  delayMs: 0,
  duringCall: null as null | (() => Promise<void>),
}));

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
        const content = req.messages[0].content;
        const count = (content.match(/^\d+\. (\[[^\]]*\] )?Headline:/gm) ?? []).length;
        if (model.duringCall) await model.duringCall();
        if (model.delayMs) await new Promise((r) => setTimeout(r, model.delayMs));
        const firstBatch = /Headline: Insight 01\b/.test(content);
        if (model.mode === "partial" && !firstBatch) throw new Error("overloaded");
        const rec = (index: number, text: string) => ({
          index,
          action_text: text,
          owner_role: "Lead",
          owner_feasibility_note: "n",
          timeline: "Q1",
          metric: "m",
          priority: "high",
          assumptions_and_risks: "a",
          alternatives_considered: "b",
        });
        let recommendations = Array.from({ length: count }, (_, i) => rec(i, `Act ${i}`));
        if (model.mode === "partial") recommendations = recommendations.filter((r) => r.index !== 3);
        if (model.mode === "repeat") recommendations = [...recommendations, rec(0, "Repeat of 0"), rec(count - 1, "Repeat of last")];
        return { stop_reason: "tool_use", usage: {}, content: [{ type: "tool_use", input: { recommendations } }] };
      }),
    },
  },
}));

vi.setConfig({ testTimeout: 30000 });

describe.skipIf(!TEST_DATABASE_URL)("recommendation retry idempotency (real database)", () => {
  let db: DisposableDb;
  const one = async (sql: string, p: unknown[]) => (await db.pool.query(sql, p)).rows[0].id as string;
  const newRun = () => one(`insert into runs (tenant_id, decision_statement) values ($1, 'Decide') returning id`, [TENANT]);
  const synthesized = async (run: string, headline: string) => {
    const f = await one(`insert into findings (tenant_id, run_id, origin, finding_text, status) values ($1, $2, 'generated', $3, 'accepted') returning id`, [TENANT, run, headline]);
    const pi = await one(
      `insert into insights (tenant_id, run_id, finding_id, headline, observation, tension, implication) values ($1, $2, $3, $4, 'o', 't', 'i') returning id`,
      [TENANT, run, f, headline],
    );
    const si = await one(
      `insert into synthesized_insights (tenant_id, run_id, headline, observation, tension, implication, triangulation_count, source_theme_count, review_status)
       values ($1, $2, $3, 'o', 't', 'i', 1, 1, 'accepted') returning id`,
      [TENANT, run, headline],
    );
    await db.pool.query(`insert into synthesized_insight_sources (tenant_id, synthesized_insight_id, pre_insight_id) values ($1, $2, $3)`, [TENANT, si, pi]);
    return { si, pi };
  };
  const seed = async (run: string, n: number) => {
    const out = [];
    for (let i = 1; i <= n; i++) out.push(await synthesized(run, `Insight ${String(i).padStart(2, "0")}`));
    return out;
  };
  const perAnchor = async (run: string, column: "synthesized_insight_id" | "insight_id") =>
    (
      await db.pool.query<{ anchor: string; n: number; texts: string[] }>(
        `select ${column} as anchor, count(*)::int n, array_agg(action_text order by created_at) texts
         from recommendations where run_id = $1 and ${column} is not null group by 1`,
        [run],
      )
    ).rows;
  const setMode = (mode: Mode) => {
    model.mode = mode;
  };

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = TENANT;
    await db.pool.query(`insert into tenants (id, name) values ($1, 'T')`, [TENANT]);
  }, 120000);
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool?.end?.();
    await db?.drop();
  });
  beforeEach(() => {
    setMode("all");
    model.delayMs = 0;
    model.duringCall = null;
  });

  it("a response repeating an index writes one recommendation per insight, keeping the first entry", async () => {
    const run = await newRun();
    await seed(run, 4);
    setMode("repeat");
    const { generateSynthesizedRecommendations } = await import("../recommendationAgent");
    await generateSynthesizedRecommendations(TENANT, run);
    const rows = await perAnchor(run, "synthesized_insight_id");
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.n === 1)).toBe(true);
    expect(rows.flatMap((r) => r.texts).sort()).toEqual(["Act 0", "Act 1", "Act 2", "Act 3"]);
  });

  it("partial run (9 of 12), then a retry whose response repeats an index: exactly 12 rows for 12 insights", async () => {
    const run = await newRun();
    await seed(run, 12);
    const { generateSynthesizedRecommendations } = await import("../recommendationAgent");
    setMode("partial");
    await expect(generateSynthesizedRecommendations(TENANT, run)).rejects.toThrow(/written for 9 of 12 insights/);
    setMode("repeat");
    await generateSynthesizedRecommendations(TENANT, run);
    const rows = await perAnchor(run, "synthesized_insight_id");
    expect(rows).toHaveLength(12);
    expect(rows.filter((r) => r.n > 1)).toEqual([]);
    const last = (
      await db.pool.query(`select detail from trace where run_id = $1 and event = 'synthesized_recommendation_run' order by occurred_at desc limit 1`, [run])
    ).rows[0];
    expect(last.detail).toMatchObject({ requested: 3, covered: 3, missing: 0, complete: true });
  });

  it("two concurrent runs over the same insights write one recommendation each", async () => {
    const run = await newRun();
    await seed(run, 5);
    model.delayMs = 150; // both runs read eligibility before either writes
    const { generateSynthesizedRecommendations } = await import("../recommendationAgent");
    await Promise.all([generateSynthesizedRecommendations(TENANT, run), generateSynthesizedRecommendations(TENANT, run)]);
    const rows = await perAnchor(run, "synthesized_insight_id");
    expect(rows).toHaveLength(5);
    expect(rows.filter((r) => r.n > 1)).toEqual([]);
  });

  it("a researcher recommendation added while the model drafts is kept and not duplicated", async () => {
    const run = await newRun();
    const [first] = await seed(run, 3);
    model.duringCall = async () => {
      model.duringCall = null;
      await db.pool.query(
        `insert into recommendations (tenant_id, run_id, synthesized_insight_id, action_text, owner_role, owner_feasibility_note, timeline,
                                      metric, priority, assumptions_and_risks, alternatives_considered, source, status)
         values ($1, $2, $3, 'Researcher action', 'Lead', 'n', 'Q1', 'm', 'high', 'a', 'b', 'researcher_authored', 'accepted')`,
        [TENANT, run, first.si],
      );
    };
    const { generateSynthesizedRecommendations } = await import("../recommendationAgent");
    await generateSynthesizedRecommendations(TENANT, run); // the insight is covered, so the run is complete
    const rows = await perAnchor(run, "synthesized_insight_id");
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.anchor === first.si)).toMatchObject({ n: 1, texts: ["Researcher action"] });
  });

  it("the pre-insight generator follows the same rule for repeated indices", async () => {
    const run = await newRun();
    await seed(run, 3);
    setMode("repeat");
    const { generateRecommendations } = await import("../recommendationAgent");
    await generateRecommendations(TENANT, run);
    const rows = await perAnchor(run, "insight_id");
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.n > 1)).toEqual([]);
  });
});

describe.skipIf(!!TEST_DATABASE_URL)("recommendation retry idempotency (real database)", () => {
  it.skip(DISPOSABLE_DB_SKIP_REASON, () => {});
});
