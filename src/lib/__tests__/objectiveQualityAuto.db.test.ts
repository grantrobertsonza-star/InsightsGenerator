// Automatic objective scoring (Grant, 2026-10-21: "pre-automate as much as possible"). Real
// disposable PostgreSQL and the actual scorer and status loader; the model is the mocked boundary
// and counts its calls. Covers: 25 objectives scored in two batches; a partial reply keeps what
// came back, records why the rest are unscored, and a later pass scores only those; an unchanged
// list makes no model call; one reworded objective rescores only it; a failure is recorded and
// surfaced; objectives that are only suggested (not accepted) are not scored.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createDisposableDb, TEST_DATABASE_URL, DISPOSABLE_DB_SKIP_REASON, type DisposableDb } from "./helpers/disposableDb";
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn() }));
const model = vi.hoisted(() => ({
  calls: [] as string[][],
  /** Objectives (by text) the reply leaves out. */
  omit: new Set<string>(),
  fail: false,
}));
vi.mock("../anthropic", () => ({
  CLAUDE_MODEL: "controlled",
  anthropic: {
    messages: {
      create: vi.fn(async (req: { messages: { content: string }[] }) => {
        const text = req.messages[0].content;
        const listed = text.split("Objectives:\n")[1].split("\n").map((l) => l.replace(/^\d+\.\s*/, ""));
        model.calls.push(listed);
        if (model.fail) throw new Error("Synthetic scorer outage");
        const scores = listed
          .map((t, index) => ({ t, index }))
          .filter(({ t }) => !model.omit.has(t))
          .map(({ index }) => ({ index, specific_score: 5, measurable_score: 3, answerable_score: 3, relevant_score: 5, rationale: "Synthetic rationale", suggestion: "" }));
        return { usage: {}, stop_reason: "tool_use", content: [{ type: "tool_use", input: { scores } }] };
      }),
    },
  },
}));

describe.skipIf(!TEST_DATABASE_URL)("automatic objective scoring (real database)", () => {
  let db: DisposableDb;
  const tenant = randomUUID();
  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    await db.pool.query("insert into tenants(id,name) values($1,'Synthetic scoring')", [tenant]);
  }, 120000);
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end();
    await db.drop();
  });
  beforeEach(() => {
    model.calls.length = 0;
    model.omit.clear();
    model.fail = false;
  });
  // research_objective is the accepted objectives as syncResearchObjective writes it.
  const newRun = async (objectives: string[]) =>
    (await db.pool.query("insert into runs(tenant_id,project_name,research_objective) values($1,'Scoring',$2) returning id", [tenant, objectives.map((t, i) => `${i + 1}. ${t}`).join("\n")])).rows[0].id as string;
  const setObjectives = (run: string, objectives: string[]) =>
    db.pool.query("update runs set research_objective=$2 where id=$1", [run, objectives.map((t, i) => `${i + 1}. ${t}`).join("\n")]);
  const scoredTexts = async (run: string) => (await db.pool.query("select item_text from objective_quality where run_id=$1 order by item_order", [run])).rows.map((r) => r.item_text as string);
  const objectives = (n: number) => Array.from({ length: n }, (_, i) => `Objective number ${i + 1}`);

  it("scores 25 objectives in two batches and makes no call when nothing changed", async () => {
    const { scoreObjectiveQuality, refreshObjectiveQuality } = await import("../objectiveQualityScorer");
    const list = objectives(25);
    const run = await newRun(list);
    const r = await scoreObjectiveQuality(tenant, run);
    expect(model.calls.map((c) => c.length)).toEqual([20, 5]);
    expect(r).toMatchObject({ scored: 25, unscored: 0, skipped: false, truncated: false });
    expect(await scoredTexts(run)).toEqual(list);
    await refreshObjectiveQuality(tenant, run);
    expect(model.calls).toHaveLength(2);
  });

  it("a partial reply keeps what came back, records why the rest are unscored, and the next pass scores only them", async () => {
    const { scoreObjectiveQuality } = await import("../objectiveQualityScorer");
    const { loadObjectiveQualityStatus, unscoredReasonFor, unscoredReasonText } = await import("../objectiveQualityStatus");
    const list = objectives(6);
    const run = await newRun(list);
    model.omit = new Set([list[1], list[4]]);
    const r = await scoreObjectiveQuality(tenant, run);
    expect(r).toMatchObject({ scored: 4, unscored: 2 });
    expect(await scoredTexts(run)).toEqual([list[0], list[2], list[3], list[5]]);
    const status = await loadObjectiveQualityStatus(tenant, run);
    if ("error" in status) throw new Error(status.error);
    expect(unscoredReasonText(unscoredReasonFor(status, list[1]), true)).toBe("The scorer returned no score for this objective. Rescore to try again.");
    expect(unscoredReasonFor(status, list[0])).toEqual({ kind: "never" }); // scored: no recorded reason
    model.omit.clear();
    model.calls.length = 0;
    await scoreObjectiveQuality(tenant, run);
    expect(model.calls).toEqual([[list[1], list[4]]]);
    expect(await scoredTexts(run)).toEqual(list);
    const after = await loadObjectiveQualityStatus(tenant, run);
    if ("error" in after) throw new Error(after.error);
    expect(after.unscored.size).toBe(0);
  });

  it("rewording one objective rescores only it; a change of spelling only (case, full stop) rescores nothing", async () => {
    const { scoreObjectiveQuality } = await import("../objectiveQualityScorer");
    const list = objectives(4);
    const run = await newRun(list);
    await scoreObjectiveQuality(tenant, run);
    model.calls.length = 0;
    const reworded = [list[0], "A clearly different second objective", list[2], list[3]];
    await setObjectives(run, reworded);
    await scoreObjectiveQuality(tenant, run);
    expect(model.calls).toEqual([["A clearly different second objective"]]);
    expect(await scoredTexts(run)).toEqual(reworded);
    model.calls.length = 0;
    const respelt = [list[0].toUpperCase() + ".", ...reworded.slice(1)];
    await setObjectives(run, respelt);
    const r = await scoreObjectiveQuality(tenant, run);
    expect(model.calls).toEqual([]);
    expect(r.kept).toBe(4);
    expect(await scoredTexts(run)).toEqual(respelt);
  });

  it("a failure is recorded and surfaced, keeps the earlier scores, and recovers", async () => {
    const { scoreObjectiveQuality, refreshObjectiveQuality } = await import("../objectiveQualityScorer");
    const { loadObjectiveQualityStatus, unscoredReasonFor, unscoredReasonText } = await import("../objectiveQualityStatus");
    const list = objectives(3);
    const run = await newRun(list);
    await scoreObjectiveQuality(tenant, run);
    await setObjectives(run, [...list, "A fourth objective added later"]);
    model.fail = true;
    await expect(scoreObjectiveQuality(tenant, run)).rejects.toThrow(/Synthetic scorer outage/);
    await refreshObjectiveQuality(tenant, run); // the automatic path never throws
    expect(await scoredTexts(run)).toEqual(list);
    const status = await loadObjectiveQualityStatus(tenant, run);
    if ("error" in status) throw new Error(status.error);
    expect(unscoredReasonText(unscoredReasonFor(status, "A fourth objective added later"), true)).toBe("Scoring failed: Synthetic scorer outage. Rescore to try again.");
    model.fail = false;
    await refreshObjectiveQuality(tenant, run);
    expect(await scoredTexts(run)).toEqual([...list, "A fourth objective added later"]);
  });

  it("scores only accepted objectives (the ones in research_objective), and says so for a suggested one", async () => {
    const { syncResearchObjective } = await import("../runSync");
    const { scoreObjectiveQuality } = await import("../objectiveQualityScorer");
    const { unscoredReasonText } = await import("../objectiveQualityStatus");
    const run = (await db.pool.query("insert into runs(tenant_id,project_name) values($1,'Accepted only') returning id", [tenant])).rows[0].id as string;
    await db.pool.query(
      `insert into objective_candidates(tenant_id,run_id,candidate_text,rationale,source,status) values
       ($1,$2,'An accepted objective','r','researcher_authored','accepted'),($1,$2,'A suggested objective','r','ai_suggested','pending')`,
      [tenant, run],
    );
    const { pool } = await import("../db");
    const client = await pool.connect();
    try {
      await client.query("select set_config('app.current_tenant_id', $1, false)", [tenant]);
      await syncResearchObjective(client, run);
    } finally {
      client.release();
    }
    await scoreObjectiveQuality(tenant, run);
    expect(model.calls).toEqual([["An accepted objective"]]);
    expect(await scoredTexts(run)).toEqual(["An accepted objective"]);
    expect(unscoredReasonText({ kind: "never" }, false)).toBe("Accept this objective to have it scored.");
  });

  it("matches a stored score to its objective by identity, not exact text", async () => {
    const { objectiveQualityLookup } = await import("../objectiveQualityStatus");
    const find = objectiveQualityLookup([{ item_text: "Measure loyalty by segment", n: 1 }]);
    expect(find("- measure loyalty by segment.")?.n).toBe(1);
    expect(find("Measure churn")).toBeUndefined();
  });
});
describe.skipIf(!!TEST_DATABASE_URL)("automatic objective scoring (real database)", () => {
  it.skip(DISPOSABLE_DB_SKIP_REASON, () => {});
});
