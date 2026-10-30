// Closing assertions for OBJ-REV-006 and OBJ-REV-007 that the existing suites do not reach
// (independent acceptance, 2026-10-16):
//   006   the response selector path with REAL persistence and reload: a share comparison whose
//         stored expectation names no answer is resolved to an explicit "Yes" on a Purchase Yes/No
//         by Gender table, persisted, and read back through the loader the UI uses with the
//         resolved response, the computed figures and a computed basis tied to its table. A
//         generic question over non-boolean answers is persisted as refused (inconclusive, no
//         figure), never as computed support.
//   007a  after the evaluated table is deleted (result stale), the UI's Continue path re-offers the
//         pair and leaves exactly one current result row for it, no duplicate.
//   007b  a failing edit or evaluate transaction leaves the prior result and question revision
//         unchanged (rolled back, not half-applied).
// Real disposable PostgreSQL through the app's own db.ts. Controlled boundaries only: the model,
// the table planner/builder/loader and the saved set-up lookups (as in
// objectiveEvaluationRecovery.db.test.ts), usage logging, storage and next/cache.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createDisposableDb, DISPOSABLE_DB_SKIP_REASON, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";
import type { CrosstabResult } from "../parseStatsFile";
// G6: actions and routes take the tenant from the signed-in request; tests supply the seeded one.
vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());

const state = vi.hoisted(() => ({
  tableId: "",
  result: null as unknown,
  modelChoice: "none",
  selectorCalls: 0,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn() }));
vi.mock("../anthropic", () => ({
  CLAUDE_MODEL: "controlled",
  anthropic: {
    messages: {
      create: vi.fn(async (req: { tool_choice: { name: string } }) => {
        if (req.tool_choice.name === "choose_answer") {
          state.selectorCalls += 1;
          return { usage: {}, stop_reason: "tool_use", content: [{ type: "tool_use", name: "choose_answer", input: { choice: state.modelChoice } }] };
        }
        // A judged reading would mean the computed path was skipped; make it obvious if it happens.
        return { usage: {}, stop_reason: "tool_use", content: [{ type: "tool_use", name: req.tool_choice.name, input: { stance: "supports", summary: "JUDGED-NOT-EXPECTED" } }] };
      }),
    },
  },
}));
vi.mock("../crosstabAsk", () => ({
  planCrosstabFromText: vi.fn(async () => ({ rows: [{ kind: "var", name: "purchase" }], columns: [{ name: "gender" }], filters: [], unclear: [] })),
}));
vi.mock("../dataSetup", () => ({
  loadDataSetupWithStatus: vi.fn(async () => ({ ok: true, setup: { unit: "respondents", layout: "rows_are_cases", method: "survey", accepted: false, wave: null, design: null } })),
}));
vi.mock("../crosstabs", () => ({
  loadVariableDictionaryWithStatus: vi.fn(async () => ({ ok: true, dictionary: { variables: [{ name: "gender", label: "Gender", nValid: 200, nDistinct: 2, pctValid: 100, weightLike: false, inSet: null }], sets: [] } })),
  loadVariableDictionary: vi.fn(),
  buildCrosstab: vi.fn(async () => ({ tableId: state.tableId })),
  loadCrosstab: vi.fn(async () => ({ result: state.result })),
}));

const base = (n: number) => ({ n, w: n, nEff: n });
function row(label: string, rawCode: string, pct: [number, number]) {
  return {
    label, rawCode,
    count: [null, null], pct, rowPct: [null, null], p: [null, null], sig: [0, 0],
    base: [base(100), base(100)],
    total: { count: null, pct: (pct[0] + pct[1]) / 2, base: base(200) },
  };
}
function purchaseTable(rows: ReturnType<typeof row>[]): CrosstabResult {
  return {
    version: 2, weightVar: null, weightLabel: null,
    blocks: [{ var: "gender", label: "Gender" }],
    // Banner columns carry their variable and raw code, as the engine reports them.
    columns: ["Male", "Female"].map((name, i) => ({ block: 0, blockLabel: "Gender", name, n: 100, w: 100, nEff: 100, var: "gender", rawCode: String(i + 1) })),
    total: base(200),
    questions: [{ key: "purchase", label: "Purchase", kind: "single", rows }],
  } as unknown as CrosstabResult;
}
const yesNo = () => purchaseTable([row("Yes", "1", [60, 40]), row("No", "2", [40, 60])]);
const channels = () => purchaseTable([row("Bought online", "1", [60, 40]), row("Bought in store", "2", [20, 40]), row("Did not buy", "3", [20, 20])]);
// The stored expectation names no answer and no question: the selector must run.
const unnamed = { kind: "comparison", answer: null, question: null, groupA: "Male", groupB: "Female", measure: "percent", direction: "higher" };

describe.skipIf(!TEST_DATABASE_URL)("OBJ-REV-006/007 objective evidence closing assertions (real database)", () => {
  let db: DisposableDb;
  const tenant = randomUUID();
  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    await db.pool.query("insert into tenants(id,name) values($1,'Synthetic evidence closure')", [tenant]);
  }, 120000);
  afterAll(async () => { const { pool } = await import("../db"); await pool.end(); await db.drop(); });

  /** A fresh run with one raw data file, so evaluatePending sees only this test's pairs. */
  async function project() {
    const run = (await db.pool.query("insert into runs(tenant_id,project_name,research_objective) values($1,'Closure','Understand purchase') returning id", [tenant])).rows[0].id as string;
    const doc = (await db.pool.query("insert into documents(tenant_id,run_id,kind,source_filename,storage_path,ingestion_type) values($1,$2,'table','survey.csv','synthetic','raw') returning id", [tenant, run])).rows[0].id as string;
    return { run, doc };
  }
  async function newTable(run: string, doc: string, index: number) {
    state.tableId = (await db.pool.query("insert into document_tables(tenant_id,run_id,document_id,table_index,ingestion_type,crosstab) values($1,$2,$3,$4,'raw','{}') returning id", [tenant, run, doc, index])).rows[0].id;
    return state.tableId;
  }
  async function question(run: string, text: string, supportsIf: string) {
    return (await db.pool.query(
      "insert into objective_evidence(tenant_id,run_id,item_kind,item_order,item_text,question,request_text,supports_if,against_if,expectation) values($1,$2,'objective',0,'Understand purchase',$3,'purchase by gender',$4,'Women higher',$5) returning id",
      [tenant, run, text, supportsIf, JSON.stringify(unnamed)],
    )).rows[0].id as string;
  }
  const resultRows = async (id: string) =>
    (await db.pool.query("select table_id,had_table,stance,basis,estimate,summary,error,evaluated_at from objective_evidence_results where evidence_id=$1", [id])).rows;
  const questionRow = async (id: string) =>
    (await db.pool.query("select question,question_revision,source,expectation from objective_evidence where id=$1", [id])).rows[0];
  async function loaded(run: string, id: string) {
    const { loadObjectiveEvidenceAction } = await import("../objectiveEvidenceActions");
    const r = await loadObjectiveEvidenceAction(run);
    if (!r.ok) throw new Error(`loader failed: ${r.error}`);
    return { load: r, q: r.questions.find((x) => x.id === id)! };
  }

  it("OBJ-REV-006: an unnamed share on Purchase Yes/No by Gender resolves to Yes, persists computed figures with its table, and survives reload", async () => {
    const { run, doc } = await project();
    const table = await newTable(run, doc, 0);
    state.result = yesNo(); state.modelChoice = "1"; state.selectorCalls = 0;
    const id = await question(run, "Does purchase differ between men and women?", "Men buy more than women");
    const { evaluateObjectiveEvidenceAction } = await import("../objectiveEvidenceActions");
    expect(await evaluateObjectiveEvidenceAction(run)).toEqual({ ok: true, done: 1, remaining: 0 });
    expect(state.selectorCalls).toBe(1);

    const { load, q } = await loaded(run, id);
    expect(load.remaining).toBe(0);
    expect(q.results).toHaveLength(1);
    const r = q.results[0];
    expect(r).toMatchObject({ table_id: table, stance: "supports", basis: "computed", error: null, stale: false });
    expect(r.estimate).toMatchObject({ measure: "percent", label: "Yes", groupA: "Male", groupB: "Female" });
    expect(r.estimate!.diff).toBeCloseTo(20, 6);
    // The saved reading keeps the exact categories it read, not only their wording.
    expect(r.estimate).toMatchObject({
      answerIdentity: { question: "purchase", rawCode: "1" },
      groupAIdentity: { variable: "gender", rawCode: "1" },
      groupBIdentity: { variable: "gender", rawCode: "2" },
    });
    expect(r.summary).toMatch(/Male 60% vs Female 40%/);
    expect(r.summary).toContain('the share answering "Yes" to "Purchase" was matched');
    expect(q).toMatchObject({ stance: "supports", basis: "computed" });
    expect((await resultRows(id))[0].had_table).toBe(true);
  });

  it("OBJ-REV-006: a generic question over non-boolean answers persists as refused, never as computed support, across reload", async () => {
    const { run, doc } = await project();
    await newTable(run, doc, 0);
    state.result = channels(); state.modelChoice = "1"; state.selectorCalls = 0; // a table-valid but arbitrary pick
    const id = await question(run, "Do men purchase more often than women?", "Men purchase more often than women");
    const { evaluateObjectiveEvidenceAction } = await import("../objectiveEvidenceActions");
    expect(await evaluateObjectiveEvidenceAction(run)).toEqual({ ok: true, done: 1, remaining: 0 });

    const { q } = await loaded(run, id);
    const r = q.results[0];
    expect(r.stance).toBe("inconclusive");
    expect(r.stance).not.toBe("supports");
    expect(r.estimate?.value ?? null).toBeNull();
    expect(r.estimate?.diff ?? null).toBeNull();
    expect(r.summary).toMatch(/^Needs your resolution/);
    expect(r.summary).not.toContain("JUDGED-NOT-EXPECTED");
    expect(q.stance).not.toBe("supports");

    // The model declining ("none") is likewise refused, not computed.
    await db.pool.query("delete from objective_evidence_results where evidence_id=$1", [id]);
    state.modelChoice = "none";
    expect(await evaluateObjectiveEvidenceAction(run)).toEqual({ ok: true, done: 1, remaining: 0 });
    const again = (await loaded(run, id)).q.results[0];
    expect(again.stance).toBe("inconclusive");
    expect(again.estimate?.value ?? null).toBeNull();
  });

  it("OBJ-REV-007a: a stale result is re-offered by Continue and replaced in place, leaving exactly one current row", async () => {
    const { run, doc } = await project();
    const first = await newTable(run, doc, 0);
    state.result = yesNo(); state.modelChoice = "1";
    const id = await question(run, "Does purchase differ between men and women?", "Men buy more than women");
    const { evaluateObjectiveEvidenceAction } = await import("../objectiveEvidenceActions");
    expect(await evaluateObjectiveEvidenceAction(run)).toEqual({ ok: true, done: 1, remaining: 0 });

    await db.pool.query("delete from document_tables where id=$1", [first]);
    const stale = await loaded(run, id);
    expect(stale.q.results).toHaveLength(1);
    expect(stale.q.results[0].stale).toBe(true);
    expect(stale.q.stance).toBeNull();
    expect(stale.load.remaining).toBe(1);

    const second = await newTable(run, doc, 1);
    expect(await evaluateObjectiveEvidenceAction(run)).toEqual({ ok: true, done: 1, remaining: 0 });
    const rows = await resultRows(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ table_id: second, had_table: true, stance: "supports", basis: "computed", error: null });
    const fresh = await loaded(run, id);
    expect(fresh.q.results.filter((x) => !x.stale)).toHaveLength(1);
    expect(fresh.q.results).toHaveLength(1);
    expect(fresh.load.remaining).toBe(0);
    // A further Continue has nothing to do and adds nothing.
    expect(await evaluateObjectiveEvidenceAction(run)).toEqual({ ok: true, done: 0, remaining: 0 });
    expect(await resultRows(id)).toHaveLength(1);
  });

  it("OBJ-REV-007b: a failing edit transaction leaves the prior result and question revision unchanged", async () => {
    const { run, doc } = await project();
    await newTable(run, doc, 0);
    state.result = yesNo(); state.modelChoice = "1";
    const id = await question(run, "Does purchase differ between men and women?", "Men buy more than women");
    const { evaluateObjectiveEvidenceAction, editObjectiveEvidenceAction } = await import("../objectiveEvidenceActions");
    expect(await evaluateObjectiveEvidenceAction(run)).toEqual({ ok: true, done: 1, remaining: 0 });
    const beforeQ = await questionRow(id);
    const beforeR = await resultRows(id);
    expect(beforeR).toHaveLength(1);

    // The edit's question update runs first, then its result delete; failing the delete must undo both.
    await db.pool.query(`create function refuse_result_delete() returns trigger language plpgsql as $$ begin raise exception 'Synthetic edit outage'; end $$;
      create trigger refuse_result_delete before delete on objective_evidence_results for each row execute function refuse_result_delete()`);
    try {
      const edit = await editObjectiveEvidenceAction(run, id, { question: "Do men buy more often than women?" });
      expect(edit).toMatchObject({ ok: false });
      expect((edit as { error: string }).error).toMatch(/Synthetic edit outage/);
    } finally {
      await db.pool.query("drop trigger refuse_result_delete on objective_evidence_results; drop function refuse_result_delete()");
    }
    expect(await questionRow(id)).toEqual(beforeQ);
    expect(await resultRows(id)).toEqual(beforeR);
    expect((await loaded(run, id)).q.results[0]).toMatchObject({ stance: "supports", stale: false });
  });

  it("OBJ-REV-007b: a failing evaluate transaction leaves the prior result and question revision unchanged", async () => {
    const { run, doc } = await project();
    await newTable(run, doc, 0);
    state.result = yesNo(); state.modelChoice = "1";
    const id = await question(run, "Does purchase differ between men and women?", "Men buy more than women");
    const { evaluateEvidenceQuestion } = await import("../objectiveEvidence");
    expect(await evaluateEvidenceQuestion(tenant, run, { id: doc, name: "survey.csv" }, id)).toBe(true);
    const beforeQ = await questionRow(id);
    const beforeR = await resultRows(id);

    // Re-evaluating against a different table would overwrite the row; every write to it fails
    // (the result write and the failure record alike), so nothing may change.
    await newTable(run, doc, 1);
    state.result = purchaseTable([row("Yes", "1", [30, 70]), row("No", "2", [70, 30])]);
    await db.pool.query(`create function refuse_result_write() returns trigger language plpgsql as $$ begin raise exception 'Synthetic evaluate outage'; end $$;
      create trigger refuse_result_write before insert or update on objective_evidence_results for each row execute function refuse_result_write()`);
    try {
      expect(await evaluateEvidenceQuestion(tenant, run, { id: doc, name: "survey.csv" }, id)).toBe(false);
    } finally {
      await db.pool.query("drop trigger refuse_result_write on objective_evidence_results; drop function refuse_result_write()");
    }
    expect(await questionRow(id)).toEqual(beforeQ);
    expect(await resultRows(id)).toEqual(beforeR);
  });
});

describe.skipIf(!!TEST_DATABASE_URL)("OBJ-REV-006/007 objective evidence closing assertions (real database)", () => {
  it.skip(DISPOSABLE_DB_SKIP_REASON, () => {});
});
