import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createDisposableDb, TEST_DATABASE_URL, DISPOSABLE_DB_SKIP_REASON, type DisposableDb } from "./helpers/disposableDb";
import type { CrosstabResult } from "../parseStatsFile";
const state = vi.hoisted(() => ({ tableId: "", gate: null as Promise<void> | null, entered: null as (() => void) | null, result: null as unknown }));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));
vi.mock("../anthropic", () => ({ anthropic: {}, CLAUDE_MODEL: "controlled" }));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn() }));
vi.mock("../crosstabAsk", () => ({ planCrosstabFromText: vi.fn(async () => ({ rows: [{ kind: "var", name: "purchase" }], columns: [{ name: "gender" }], filters: [], unclear: [] })) }));
vi.mock("../dataSetup", () => ({ loadDataSetupWithStatus: vi.fn(async () => ({ ok: true, setup: { unit: "respondents", layout: "rows_are_cases", method: "survey", accepted: false, wave: null, design: null } })) }));
vi.mock("../crosstabs", () => ({
  loadVariableDictionaryWithStatus: vi.fn(async () => ({ ok: true, dictionary: { variables: [{ name: "gender", label: "Gender", nValid: 200, nDistinct: 2, pctValid: 100, weightLike: false, inSet: null }], sets: [] } })),
  buildCrosstab: vi.fn(async () => { state.entered?.(); if (state.gate) await state.gate; return { tableId: state.tableId }; }),
  loadCrosstab: vi.fn(async () => ({ result: state.result })),
}));
describe.skipIf(!TEST_DATABASE_URL)("REV-007/013 actual evaluator revision and durable recovery", () => {
  let db: DisposableDb;
  const tenant = randomUUID(); let run: string, doc: string;
  const expectation = { kind: "comparison", answer: "Yes", question: null, groupA: "Male", groupB: "Female", measure: "percent", direction: "higher" };
  beforeAll(async () => {
    db = await createDisposableDb(); process.env.DATABASE_URL = db.url;
    await db.pool.query("insert into tenants(id,name) values($1,'Synthetic evaluator')", [tenant]);
    run = (await db.pool.query("insert into runs(tenant_id) values($1) returning id", [tenant])).rows[0].id;
    doc = (await db.pool.query("insert into documents(tenant_id,run_id,kind,source_filename,storage_path,ingestion_type) values($1,$2,'table','survey.csv','synthetic','raw') returning id", [tenant,run])).rows[0].id;
    state.tableId = (await db.pool.query("insert into document_tables(tenant_id,run_id,document_id,table_index,ingestion_type) values($1,$2,$3,0,'raw') returning id", [tenant,run,doc])).rows[0].id;
    const base = (n: number) => ({ n, w: n, nEff: n });
    state.result = { version: 2, weightVar: null, weightLabel: null, blocks: [{ var: "gender", label: "Gender" }], columns: ["Male","Female"].map(name => ({ block: 0, blockLabel: "Gender", name, n: 100, w: 100, nEff: 100 })), total: base(200), questions: [{ key: "purchase", label: "Purchase", kind: "single", rows: [
      { label: "Yes", count: [null,null], pct: [60,40], rowPct: [null,null], p: [null,null], sig: [0,0], base: [base(100),base(100)], total: { count: null, pct: 50, base: base(200) } },
      { label: "No", count: [null,null], pct: [40,60], rowPct: [null,null], p: [null,null], sig: [0,0], base: [base(100),base(100)], total: { count: null, pct: 50, base: base(200) } },
    ] }] };
  }, 120000);
  beforeEach(async () => { state.gate = null; state.entered = null; await db.pool.query("delete from objective_evidence where run_id=$1", [run]); });
  afterAll(async () => { const { pool } = await import("../db"); await pool.end(); await db.drop(); });
  const question = async (text = "Do men answer Yes more often than women?") => (await db.pool.query("insert into objective_evidence(tenant_id,run_id,item_kind,item_order,item_text,question,request_text,supports_if,against_if,expectation) values($1,$2,'objective',0,'Understand purchase',$3,'purchase by gender','Men higher','Women higher',$4) returning id", [tenant,run,text,JSON.stringify(expectation)])).rows[0].id as string;
  const results = async (id: string) => (await db.pool.query("select stance,error from objective_evidence_results where evidence_id=$1", [id])).rows;
  it("edit while evaluation is in flight refuses the old result; retry uses the edited revision", async () => {
    const { evaluateEvidenceQuestion, editEvidenceQuestion } = await import("../objectiveEvidence");
    const id = await question();
    let release!: () => void;
    state.gate = new Promise<void>(resolve => { release = resolve; });
    const entered = new Promise<void>(resolve => { state.entered = resolve; });
    const evaluating = evaluateEvidenceQuestion(tenant,run,{ id: doc, name: "survey.csv" },id);
    await entered;
    await editEvidenceQuestion(tenant,run,id,{ question: "Edited question: do men answer Yes more often?" });
    release();
    expect(await evaluating).toBe(false);
    expect(await results(id)).toEqual([]);
    state.gate = null;
    await db.pool.query("update objective_evidence set expectation=$1 where id=$2", [JSON.stringify(expectation),id]);
    expect(await evaluateEvidenceQuestion(tenant,run,{ id: doc, name: "survey.csv" },id)).toBe(true);
    expect(await results(id)).toMatchObject([{ stance: "supports", error: null }]);
  });
  it("evaluation commits before editing: the edit clears its old result", async () => {
    const { evaluateEvidenceQuestion, editEvidenceQuestion } = await import("../objectiveEvidence");
    const id = await question();
    expect(await evaluateEvidenceQuestion(tenant,run,{ id: doc, name: "survey.csv" },id)).toBe(true);
    expect(await results(id)).toHaveLength(1);
    await editEvidenceQuestion(tenant,run,id,{ question: "Different current wording" });
    expect(await results(id)).toEqual([]);
  });
  it("mixed durable write failure counts only successes, preserves pending work and retries once", async () => {
    const { evaluatePending } = await import("../objectiveEvidence");
    const failed = await question(); await question("A second purchase question");
    await db.pool.query(`create function refuse_one_result() returns trigger language plpgsql as $$ begin if new.evidence_id='${failed}'::uuid then raise exception 'Synthetic persistence outage'; end if; return new; end $$; create trigger refuse_one_result before insert on objective_evidence_results for each row execute function refuse_one_result()`);
    expect(await evaluatePending(tenant,run,2)).toEqual({ done: 1, remaining: 1 });
    expect(await evaluatePending(tenant,run,2)).toEqual({ done: 0, remaining: 1 });
    expect(await results(failed)).toEqual([]);
    await db.pool.query("drop trigger refuse_one_result on objective_evidence_results; drop function refuse_one_result()");
    expect(await evaluatePending(tenant,run,2)).toEqual({ done: 1, remaining: 0 });
    expect(await results(failed)).toHaveLength(1);
    expect(await evaluatePending(tenant,run,2)).toEqual({ done: 0, remaining: 0 });
  });
  it("persists finite total, measure, equality and effective-base boundaries without changing their meaning", async () => {
    const { evaluateEvidenceQuestion } = await import("../objectiveEvidence");
    const original = structuredClone(state.result) as CrosstabResult;
    const cases: { name: string; expected: string; expectation: Record<string, unknown>; table: CrosstabResult }[] = [];
    const level = { kind: "level", answer: "Yes", question: null, measure: "percent", direction: "above", threshold: 40 };
    cases.push({ name: "total 50 percent exceeds 40", expected: "supports", expectation: level, table: structuredClone(original) });
    cases.push({ name: "equality does not establish above", expected: "inconclusive", expectation: { ...level, threshold: 50 }, table: structuredClone(original) });
    cases.push({ name: "mean cannot use percent row", expected: "inconclusive", expectation: { ...expectation, measure: "mean" }, table: structuredClone(original) });
    for (const n of [29,30]) {
      const table = structuredClone(original);
      table.columns.forEach(c => { c.n = n; c.w = n; c.nEff = n; });
      table.questions[0].rows.forEach(r => { r.base = [{ n,w:n,nEff:n },{ n,w:n,nEff:n }]; });
      cases.push({ name: `effective base ${n}`, expected: n === 29 ? "silent" : "inconclusive", expectation, table });
    }
    for (const c of cases) {
      const id = await question(c.name);
      await db.pool.query("update objective_evidence set expectation=$1 where id=$2", [JSON.stringify(c.expectation), id]);
      state.result = c.table;
      expect(await evaluateEvidenceQuestion(tenant,run,{ id:doc,name:"survey.csv" },id), c.name).toBe(true);
      expect((await results(id))[0].stance, c.name).toBe(c.expected);
      expect((await db.pool.query("select table_id,basis from objective_evidence_results where evidence_id=$1",[id])).rows[0]).toMatchObject({table_id:state.tableId,basis:"computed"});
    }
    state.result = original;
  });
});
describe.skipIf(!!TEST_DATABASE_URL)("REV-007/013 actual evaluator revision and durable recovery", () => { it.skip(DISPOSABLE_DB_SKIP_REASON, () => {}); });
