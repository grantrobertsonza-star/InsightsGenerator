// REC500-F01, REC500-F02 and REC500-F03 (Codex, 2026-10-24), through the actual server actions on a
// real disposable PostgreSQL. Controlled: the model (the quality scorer's answer), Next's cache and
// the signed-in request. The quality scorer itself is the actual one.
//   F01  an edit opened before another editor's save, or against a deleted (or deleted and
//        recreated) recommendation, is refused with what is stored and saves nothing; a healthy edit,
//        a deliberate replacement after a conflict, and two editors at once (one wins, one is told)
//   F02  the old quality score is cleared with the wording in one transaction: a fault that refuses
//        only the clearing rolls the edit back and is reported; a healthy edit is scored again by the
//        actual scorer; without the quality columns the edit still saves
//   F03  one stored recommendation per add request, for both anchor kinds: a resend after a lost
//        reply, two sends at once, a refused send then a valid one; a changed resend is refused; a new
//        key is a new recommendation; without migration 0113 the add is refused and nothing stored
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";

vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn() }));
const scorer = vi.hoisted(() => ({ calls: 0 }));
vi.mock("../anthropic", () => ({
  CLAUDE_MODEL: "test-model",
  anthropic: {
    messages: {
      create: vi.fn(async (req: { messages: { content: string }[] }) => {
        scorer.calls++;
        const n = (req.messages[0].content.match(/^\d+\. Action:/gm) ?? []).length;
        const scores = Array.from({ length: n }, (_, index) => ({ index, actionability_score: 3, feasibility_score: 3, evidence_score: 1, impact_score: 3, rationale: "rescored" }));
        return { stop_reason: "tool_use", usage: {}, content: [{ type: "tool_use", name: "record_scores", input: { scores } }] };
      }),
    },
  },
}));
vi.setConfig({ testTimeout: 60000 });

const TENANT = "00000000-0000-4000-8000-0000000000d2";
const fields = (action: string) => ({
  action_text: action,
  owner_role: "Lead",
  owner_feasibility_note: "n",
  timeline: "Q1",
  metric: "m",
  priority: "high" as const,
  assumptions_and_risks: "a",
  alternatives_considered: "b",
});

describe.skipIf(!TEST_DATABASE_URL)("REC500-F01/F02/F03 recommendation writes (real database)", () => {
  let db: DisposableDb;
  let run = "";
  const one = async (sql: string, p: unknown[]) => (await db.pool.query(sql, p)).rows[0];
  const actions = async () => await import("../recommendationActions");
  async function anchors() {
    const f = (await one("insert into findings (tenant_id, run_id, origin, finding_text, status) values ($1,$2,'generated','f','accepted') returning id", [TENANT, run])).id;
    const pi = (await one("insert into insights (tenant_id, run_id, finding_id, headline, observation, tension, implication) values ($1,$2,$3,'Pre','o','t','i') returning id", [TENANT, run, f])).id as string;
    const si = (await one(
      "insert into synthesized_insights (tenant_id, run_id, headline, observation, tension, implication, triangulation_count, source_theme_count, review_status) values ($1,$2,'Synth','o','t','i',1,1,'accepted') returning id",
      [TENANT, run],
    )).id as string;
    return { pi, si };
  }
  /** A model recommendation on a synthesized insight, scored 95 / strong as an earlier scoring left it. */
  async function scored(si: string, action = "Model action") {
    return (await one(
      `insert into recommendations (tenant_id, run_id, synthesized_insight_id, action_text, owner_role, owner_feasibility_note, timeline, metric, priority, assumptions_and_risks, alternatives_considered, source, status, rec_quality_score, rec_quality_tier, rec_quality_rationale, rec_actionability_score, rec_feasibility_score, rec_evidence_score, rec_impact_score)
       values ($1,$2,$3,$4,'Lead','n','Q1','m','high','a','b','ai_suggested','pending',95,'strong','old',5,5,5,5) returning id`,
      [TENANT, run, si, action],
    )).id as string;
  }
  const row = async (id: string) => (await db.pool.query("select action_text, status, edited, rec_quality_score, rec_quality_tier, rec_quality_rationale from recommendations where id = $1", [id])).rows[0];

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = TENANT;
    await db.pool.query("insert into tenants (id, name) values ($1, 'T')", [TENANT]);
    run = (await one("insert into runs (tenant_id, decision_statement) values ($1, 'Decide') returning id", [TENANT])).id;
  }, 120000);
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end();
    await db.drop();
  });

  describe("F01 edits", () => {
    it("an editor opened before another save is refused with what is stored; nothing is saved; replacing deliberately works", async () => {
      const { si } = await anchors();
      const id = await scored(si);
      const { updateAndAcceptRecommendation } = await actions();
      const opened = fields("Model action");
      expect(await updateAndAcceptRecommendation(run, id, fields("Winning action"), opened)).toEqual({ ok: true });
      const stale = await updateAndAcceptRecommendation(run, id, fields("Earlier losing draft"), opened);
      expect(stale).toMatchObject({ ok: false, conflict: true, current: fields("Winning action") });
      expect((await row(id)).action_text).toBe("Winning action");
      // "Replace with mine": the stored fields become the opened state.
      expect(await updateAndAcceptRecommendation(run, id, fields("Earlier losing draft"), fields("Winning action"))).toEqual({ ok: true });
      expect((await row(id)).action_text).toBe("Earlier losing draft");
    });

    it("a deleted, or deleted and recreated, recommendation is refused as gone and nothing is written", async () => {
      const { si } = await anchors();
      const id = await scored(si, "To delete");
      const { updateAndAcceptRecommendation, deleteRecommendation } = await actions();
      await deleteRecommendation(run, id);
      const recreated = await scored(si, "To delete");
      const r = await updateAndAcceptRecommendation(run, id, fields("Edit of a deleted one"), fields("To delete"));
      expect(r).toMatchObject({ ok: false, conflict: true, current: null });
      if (!r.ok) expect(r.error).toMatch(/no longer in the project/);
      expect((await row(recreated)).action_text).toBe("To delete");
      expect(Number((await one("select count(*) as n from recommendations where action_text = 'Edit of a deleted one'", [])).n)).toBe(0);
    });

    it("two editors opened on the same wording save at once: one is saved, the other is told", async () => {
      const { si } = await anchors();
      const id = await scored(si, "Shared start");
      const { updateAndAcceptRecommendation } = await actions();
      const results = await Promise.all([
        updateAndAcceptRecommendation(run, id, fields("Editor one"), fields("Shared start")),
        updateAndAcceptRecommendation(run, id, fields("Editor two"), fields("Shared start")),
      ]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.filter((r) => !r.ok && "conflict" in r)).toHaveLength(1);
      expect(["Editor one", "Editor two"]).toContain((await row(id)).action_text);
    });

    it("a field set that is not a recommendation is refused at the boundary", async () => {
      const { si } = await anchors();
      const id = await scored(si, "Boundary");
      const { updateAndAcceptRecommendation } = await actions();
      expect((await updateAndAcceptRecommendation(run, id, { ...fields("x"), priority: "urgent" as never })).ok).toBe(false);
      expect((await row(id)).action_text).toBe("Boundary");
    });
  });

  describe("F02 quality score", () => {
    it("a healthy edit clears the old score with the wording and the actual scorer scores the new wording", async () => {
      const { si } = await anchors();
      const id = await scored(si, "Old wording");
      const { updateAndAcceptRecommendation } = await actions();
      const calls = scorer.calls;
      expect(await updateAndAcceptRecommendation(run, id, fields("Researcher changed action"), fields("Old wording"))).toEqual({ ok: true });
      expect(scorer.calls).toBeGreaterThan(calls);
      expect(await row(id)).toMatchObject({ action_text: "Researcher changed action", status: "accepted", edited: true, rec_quality_score: 7, rec_quality_tier: "weak", rec_quality_rationale: "rescored" });
    });

    it("a fault that refuses only the clearing of the score rolls the edit back and is reported", async () => {
      const { si } = await anchors();
      const id = await scored(si, "Before fault");
      await db.pool.query(`create or replace function rec_quality_clear_fault() returns trigger language plpgsql as $$
        begin
          if old.rec_quality_score is not null and new.rec_quality_score is null then raise exception 'synthetic quality clear fault'; end if;
          return new;
        end $$`);
      await db.pool.query("create trigger rec_quality_clear_fault before update on recommendations for each row execute function rec_quality_clear_fault()");
      try {
        const { updateAndAcceptRecommendation } = await actions();
        await expect(updateAndAcceptRecommendation(run, id, fields("Researcher changed action"), fields("Before fault"))).rejects.toThrow(/synthetic quality clear fault/);
        expect(await row(id)).toMatchObject({ action_text: "Before fault", edited: false, rec_quality_score: 95, rec_quality_tier: "strong" });
      } finally {
        await db.pool.query("drop trigger rec_quality_clear_fault on recommendations");
      }
      // Recovery: the same edit saves once the fault is gone.
      const { updateAndAcceptRecommendation } = await actions();
      expect(await updateAndAcceptRecommendation(run, id, fields("Researcher changed action"), fields("Before fault"))).toEqual({ ok: true });
      expect((await row(id)).rec_quality_rationale).toBe("rescored");
    });
  });

  describe("F03 adds", () => {
    it("a resend of the same add request, after a lost reply, stores one recommendation for either anchor", async () => {
      const { pi, si } = await anchors();
      const { addOwnRecommendation, addOwnSynthesizedRecommendation } = await actions();
      for (const [add, anchor] of [[addOwnRecommendation, pi], [addOwnSynthesizedRecommendation, si]] as const) {
        const key = randomUUID();
        const first = await add(run, anchor, fields("Own action"), key);
        const again = await add(run, anchor, fields("Own action"), key);
        expect(first).toMatchObject({ ok: true, alreadySaved: false });
        expect(again).toMatchObject({ ok: true, alreadySaved: true });
        if (first.ok && again.ok) expect(again.id).toBe(first.id);
        expect(Number((await one("select count(*) as n from recommendations where client_request_key = $1", [key])).n)).toBe(1);
      }
    });

    it("two sends of one request at once store one; a new key is a deliberate second recommendation", async () => {
      const { si } = await anchors();
      const { addOwnSynthesizedRecommendation } = await actions();
      const key = randomUUID();
      const both = await Promise.all([1, 2].map(() => addOwnSynthesizedRecommendation(run, si, fields("Raced action"), key)));
      expect(both.every((r) => r.ok)).toBe(true);
      expect(both.filter((r) => r.ok && r.alreadySaved)).toHaveLength(1);
      expect((await addOwnSynthesizedRecommendation(run, si, fields("Raced action"), randomUUID())).ok).toBe(true);
      expect(Number((await one("select count(*) as n from recommendations where synthesized_insight_id = $1 and action_text = 'Raced action'", [si])).n)).toBe(2);
    });

    it("a refused send then a valid one with the same key stores one; a changed resend of a stored request is refused", async () => {
      const { pi } = await anchors();
      const { addOwnRecommendation } = await actions();
      const key = randomUUID();
      expect((await addOwnRecommendation(run, randomUUID(), fields("Retry action"), key)).ok).toBe(false);
      expect(await addOwnRecommendation(run, pi, fields("Retry action"), key)).toMatchObject({ ok: true, alreadySaved: false });
      const changed = await addOwnRecommendation(run, pi, fields("Retry action, edited after"), key);
      expect(changed.ok).toBe(false);
      if (!changed.ok) expect(changed.error).toMatch(/already saved, as it was then/);
      expect(Number((await one("select count(*) as n from recommendations where client_request_key = $1", [key])).n)).toBe(1);
      expect((await addOwnRecommendation(run, pi, fields("Retry action"), "not-a-key")).ok).toBe(false);
    });
  });

  describe("without the optional columns", () => {
    it("without the quality columns an edit still saves; without migration 0113 an add is refused and nothing is stored", async () => {
      const { pi, si } = await anchors();
      const id = await scored(si, "No quality");
      await db.pool.query(
        "alter table recommendations drop column rec_quality_score, drop column rec_quality_tier, drop column rec_quality_rationale, drop column rec_actionability_score, drop column rec_feasibility_score, drop column rec_evidence_score, drop column rec_impact_score",
      );
      await db.pool.query("alter table recommendations drop column client_request_key");
      vi.resetModules();
      const { updateAndAcceptRecommendation, addOwnRecommendation } = await actions();
      expect(await updateAndAcceptRecommendation(run, id, fields("Edited without quality"), fields("No quality"))).toEqual({ ok: true });
      expect((await db.pool.query("select action_text from recommendations where id = $1", [id])).rows[0].action_text).toBe("Edited without quality");
      const add = await addOwnRecommendation(run, pi, fields("Needs 0113"), randomUUID());
      expect(add.ok).toBe(false);
      if (!add.ok) expect(add.error).toMatch(/migration 0113/);
      expect(Number((await one("select count(*) as n from recommendations where action_text = 'Needs 0113'", [])).n)).toBe(0);
    });
  });
});
