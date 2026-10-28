// CE-2 (evidence chain, 26 October 2026): which decision a recommendation serves is stored, by id.
// The actual generator against a real disposable PostgreSQL; the model is the mocked boundary and
// answers with the decision indices the test sets.
//   - the prompt lists the accepted decisions numbered; the model's indices are stored with each
//     decision's id and wording, in order (before CE-2 nothing recorded which decision an action served);
//   - invalid indices (out of range, fractional, repeated) are dropped; none named is "Not recorded",
//     never "serves every decision";
//   - a project whose decisions are only free text stores the numbered line's wording without an id;
//   - a decision rejected later reads as no longer current, with its wording kept;
//   - a retry writes no second recommendation and no second set of decisions;
//   - the main recommendation export states the decision served.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createDisposableDb, DISPOSABLE_DB_SKIP_REASON, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";
vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());

const model = vi.hoisted(() => ({ indices: [] as unknown[], prompts: [] as string[] }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn() }));
vi.mock("../recommendationQualityScorer", () => ({ refreshRecommendationQuality: vi.fn() }));
vi.mock("../objectiveQualityScorer", () => ({ refreshObjectiveQuality: vi.fn() }));
vi.mock("../anthropic", () => ({
  CLAUDE_MODEL: "test-model",
  anthropic: {
    messages: {
      create: vi.fn(async (req: { system: string; messages: { content: string }[] }) => {
        model.prompts.push(req.system);
        const count = (req.messages[0].content.match(/^\d+\. Headline:/gm) ?? []).length;
        const recommendations = Array.from({ length: count }, (_, index) => ({
          index, action_text: "Act", owner_role: "Lead", owner_feasibility_note: "n", timeline: "Q1",
          metric: "m", priority: "high", assumptions_and_risks: "a", alternatives_considered: "b", decision_indices: model.indices,
        }));
        return { stop_reason: "tool_use", usage: {}, content: [{ type: "tool_use", name: "record_recommendations", input: { recommendations } }] };
      }),
    },
  },
}));
vi.setConfig({ testTimeout: 60000 });

describe.skipIf(!TEST_DATABASE_URL)("CE-2 recommendations record the decisions they serve", () => {
  let db: DisposableDb;
  const tenant = randomUUID();
  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    await db.pool.query("insert into tenants(id,name) values($1,'Synthetic decisions served')", [tenant]);
  }, 120000);
  afterAll(async () => { const { pool } = await import("../db"); await pool.end(); await db.drop(); }, 60000);

  const id = async (sql: string, p: unknown[]) => (await db.pool.query(sql, p)).rows[0].id as string;
  const project = async (statement: string, candidates: string[]) => {
    const run = await id("insert into runs(tenant_id,project_name,entry_point,decision_statement) values($1,'R','generate',$2) returning id", [tenant, statement]);
    const ids: string[] = [];
    for (const c of candidates) ids.push(await id("insert into decision_candidates(tenant_id,run_id,candidate_text,rationale,source,status) values($1,$2,$3,'r','researcher_authored','accepted') returning id", [tenant, run, c]));
    const f = await id("insert into findings(tenant_id,run_id,origin,finding_text,status) values($1,$2,'generated','F','accepted') returning id", [tenant, run]);
    const pre = await id("insert into insights(tenant_id,run_id,finding_id,headline,observation,tension,implication) values($1,$2,$3,'Pre','o','t','i') returning id", [tenant, run, f]);
    const si = await id("insert into synthesized_insights(tenant_id,run_id,headline,observation,tension,implication,review_status,action_plan_status) values($1,$2,'Insight','o','t','i','accepted','has_action') returning id", [tenant, run]);
    await db.pool.query("insert into synthesized_insight_sources(synthesized_insight_id,pre_insight_id,tenant_id) values($1,$2,$3)", [si, pre, tenant]);
    return { run, ids, si };
  };
  const stored = async (run: string) =>
    (await db.pool.query("select d.decision_candidate_id, d.decision_text, d.origin from recommendation_decisions d join recommendations r on r.id = d.recommendation_id where r.run_id = $1 order by d.position", [run])).rows;
  const generate = async (run: string) => (await import("../recommendationAgent")).generateSynthesizedRecommendations(tenant, run);

  it("lists the decisions numbered and stores the ones named, by id and in order", async () => {
    const { run, ids } = await project("1. Fund retention\n2. Fund acquisition", ["Fund retention", "Fund acquisition"]);
    model.indices = [1, 0];
    await generate(run);
    expect(model.prompts.at(-1)).toContain("numbered:\n0. Fund retention\n1. Fund acquisition");
    expect(await stored(run)).toEqual([
      { decision_candidate_id: ids[1], decision_text: "Fund acquisition", origin: "model" },
      { decision_candidate_id: ids[0], decision_text: "Fund retention", origin: "model" },
    ]);
  });

  it("drops invalid indices, records none as not recorded, and writes nothing twice on a retry", async () => {
    const { run, ids } = await project("Fund retention", ["Fund retention"]);
    model.indices = [3, 0.5, -1, 0, 0];
    await generate(run);
    expect(await stored(run)).toEqual([{ decision_candidate_id: ids[0], decision_text: "Fund retention", origin: "model" }]);
    await generate(run);
    expect((await db.pool.query("select count(*)::int as n from recommendations where run_id=$1", [run])).rows[0].n).toBe(1);
    expect(await stored(run)).toHaveLength(1);

    const none = await project("Fund retention", ["Fund retention"]);
    model.indices = [];
    await generate(none.run);
    expect(await stored(none.run)).toEqual([]);
    const { loadMainRecommendations, exportFields } = await import("../mainRecommendationExport");
    const exp = (await loadMainRecommendations(tenant, none.run, "all"))!;
    expect(Object.fromEntries(exportFields(exp.rows[0], exp.supportOf(exp.rows[0])))["Decision served"]).toBe("Not recorded");
  });

  it("stores a free-text decision's wording without an id, and reads a later-rejected decision as no longer current", async () => {
    const free = await project("1. Raise fees\n2. Hold fees", []);
    model.indices = [1];
    await generate(free.run);
    expect(await stored(free.run)).toEqual([{ decision_candidate_id: null, decision_text: "Hold fees", origin: "model" }]);

    const { run, ids } = await project("Fund retention", ["Fund retention"]);
    model.indices = [0];
    await generate(run);
    const { loadMainRecommendations, exportFields } = await import("../mainRecommendationExport");
    const field = async () => {
      const exp = (await loadMainRecommendations(tenant, run, "all"))!;
      return Object.fromEntries(exportFields(exp.rows[0], exp.supportOf(exp.rows[0])))["Decision served"];
    };
    expect(await field()).toBe("Fund retention");
    await db.pool.query("update decision_candidates set status='rejected' where id=$1", [ids[0]]);
    expect(await field()).toBe("Fund retention (no longer a current decision)");
  });

  // B37-F02 (Codex): editing a decision's wording through the actual action kept the old wording reading
  // as a current decision served, because only the id was compared.
  it("B37-F02: a decision reworded through the actual action is no longer current; unchanged wording, free text and recovery", async () => {
    const { run, ids } = await project("Fund retention", ["Fund retention"]);
    model.indices = [0];
    await generate(run);
    const { loadMainRecommendations, exportFields } = await import("../mainRecommendationExport");
    const field = async () => {
      const exp = (await loadMainRecommendations(tenant, run, "all"))!;
      return Object.fromEntries(exportFields(exp.rows[0], exp.supportOf(exp.rows[0])))["Decision served"];
    };
    const served = async () => {
      const { withTenantRead } = await import("../db");
      const { loadRecommendationDecisions } = await import("../recommendationDecisions");
      const recId = (await db.pool.query("select id from recommendations where run_id=$1", [run])).rows[0].id;
      return withTenantRead(tenant, async (client) => (await loadRecommendationDecisions(client, run, [recId]))!.get(recId));
    };
    // Unchanged wording, and a re-save with only spacing and case changed: still current.
    await db.pool.query("update decision_candidates set candidate_text='fund  Retention' where id=$1", [ids[0]]);
    expect(await field()).toBe("Fund retention");
    await db.pool.query("update decision_candidates set candidate_text='Fund retention' where id=$1", [ids[0]]);

    const { acceptDecisionCandidate } = await import("../decisionCandidateActions");
    const r = await acceptDecisionCandidate(run, ids[0], "Stop funding retention", "Fund retention");
    expect(r).toMatchObject({ ok: true });
    expect(await served()).toEqual([
      { text: "Fund retention", candidateId: ids[0], origin: "model", current: false, state: "reworded", currentText: "Stop funding retention" },
    ]);
    expect(await field()).toBe('Fund retention (since reworded as "Stop funding retention"; written for the earlier wording)');
    // Recovery: the same wording again reads as current; a rejection reads as gone.
    await acceptDecisionCandidate(run, ids[0], "Fund retention", "Stop funding retention");
    expect(await field()).toBe("Fund retention");
    await db.pool.query("update decision_candidates set status='rejected' where id=$1", [ids[0]]);
    expect(await field()).toBe("Fund retention (no longer a current decision)");
    expect((await served())?.[0]).toMatchObject({ state: "gone", current: false, currentText: null });

    // A free-text decision: its wording is its identity, so a reworded statement is gone, not current.
    const free = await project("1. Raise fees\n2. Hold fees", []);
    model.indices = [1];
    await generate(free.run);
    const freeField = async () => {
      const exp = (await loadMainRecommendations(tenant, free.run, "all"))!;
      return Object.fromEntries(exportFields(exp.rows[0], exp.supportOf(exp.rows[0])))["Decision served"];
    };
    expect(await freeField()).toBe("Hold fees");
    await db.pool.query("update runs set decision_statement='1. Raise fees\n2. Hold fees until Q3' where id=$1", [free.run]);
    expect(await freeField()).toBe("Hold fees (no longer a current decision)");
  });

  // Evidence trail extras: the researcher chooses the decisions a recommendation serves.
  it("the researcher chooses the decisions served: saved against what was shown, refused when stale or not current, kept by regeneration", async () => {
    const { run, ids } = await project("1. Fund retention\n2. Fund acquisition", ["Fund retention", "Fund acquisition"]);
    model.indices = [0];
    await generate(run);
    const rec = (await db.pool.query("select id from recommendations where run_id=$1", [run])).rows[0].id as string;
    const { setServedDecisionsAction } = await import("../recommendationActions");
    const { servedKey } = await import("../recommendationDecisions");
    const seen = servedKey([{ candidateId: ids[0], text: "Fund retention" }]);
    // Stale: what was shown is not what is stored.
    expect(await setServedDecisionsAction(run, rec, [ids[1]], servedKey([]))).toMatchObject({ ok: false, error: expect.stringMatching(/changed since you opened it.*Nothing was saved/) });
    // Not a current decision; none chosen; malformed; another project's recommendation.
    expect(await setServedDecisionsAction(run, rec, ["text:Something else"], seen)).toMatchObject({ ok: false, error: expect.stringMatching(/no longer one of the project's decisions/) });
    expect(await setServedDecisionsAction(run, rec, [], seen)).toMatchObject({ ok: false, error: expect.stringMatching(/at least one decision/) });
    expect(await setServedDecisionsAction(run, rec, "x", seen)).toMatchObject({ ok: false });
    const other = await project("Fund retention", ["Fund retention"]);
    expect(await setServedDecisionsAction(other.run, rec, [other.ids[0]], seen)).toMatchObject({ ok: false, error: expect.stringMatching(/not in this project/) });
    expect(await stored(run)).toEqual([{ decision_candidate_id: ids[0], decision_text: "Fund retention", origin: "model" }]);
    // Saved, in the order chosen, as the researcher's.
    expect(await setServedDecisionsAction(run, rec, [ids[1], ids[0]], seen)).toEqual({ ok: true, changed: true });
    expect(await stored(run)).toEqual([
      { decision_candidate_id: ids[1], decision_text: "Fund acquisition", origin: "researcher" },
      { decision_candidate_id: ids[0], decision_text: "Fund retention", origin: "researcher" },
    ]);
    // The same choice again changes nothing; the earlier view is now stale.
    const now = servedKey([{ candidateId: ids[1], text: "Fund acquisition" }, { candidateId: ids[0], text: "Fund retention" }]);
    expect(await setServedDecisionsAction(run, rec, [ids[1], ids[0]], now)).toEqual({ ok: true, changed: false });
    expect(await setServedDecisionsAction(run, rec, [ids[0]], seen)).toMatchObject({ ok: false });
    // Regeneration does not overwrite the researcher's choice.
    await db.pool.query("update recommendations set status='accepted' where id=$1", [rec]);
    model.indices = [0];
    await generate(run);
    expect((await stored(run)).filter((d) => d.origin === "researcher")).toHaveLength(2);
  });
});
describe.skipIf(!!TEST_DATABASE_URL)("CE-2 recommendations record the decisions they serve", () => {
  it.skip(DISPOSABLE_DB_SKIP_REASON, () => {});
});
