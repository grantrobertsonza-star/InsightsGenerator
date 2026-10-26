// OBJ-REV-005 frozen acceptance: "independent total-column, mean/percent, base 29/30, equality and
// mixed-stance fixtures agree through the persisted assessment". The reading rules already have
// hand-computed unit tests (evidenceStanceReference.test.ts); this runs the same kinds of case
// through the REAL evaluator and persistence (evaluateObjectiveEvidenceAction, then the loader the
// UI uses), so what is stored and read back is what is checked. Hand-computed references:
//   total column  p = 55%, n_eff 400: se = sqrt(.55*.45/400)*100 = 2.4875; 95% = 50.1 to 59.9
//                 against a threshold of 50 "above" -> supports
//   base 29 / 30  the same share on a total base of 29 is too thin (silent); on 30 it is read
//   mean          3.5 with sem 0.06: 3.38 to 3.62 (stored to one decimal: 3.4 to 3.6), above 3 ->
//                 supports; the same row against a declared percent expectation is not read
//   equality      Male 50% vs Female 48%, n_eff 1000 each: diff 2, se = sqrt(.25/1000 +
//                 .2496/1000)*100 = 2.235; 95% = -2.4 to 6.4, inside a margin of 10 -> against
//                 ("no meaningful difference")
//   mixed         two data files, Yes 70% in one and 30% in the other, threshold 50 above: one
//                 supports, one against; the question's combined stance is mixed
// Real disposable PostgreSQL through the app's own db.ts. Controlled boundaries only, as in
// objectiveEvidenceClosure.db.test.ts: the planner, table builder/loader and set-up lookups
// return fixed tables; the model is never asked (a judged reading would fail the test).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";
import type { CrosstabResult } from "../parseStatsFile";
// G6: actions and routes take the tenant from the signed-in request; tests supply the seeded one.
vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());

const state = vi.hoisted(() => ({ tables: {} as Record<string, string>, results: {} as Record<string, unknown>, judged: 0 }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn() }));
vi.mock("../anthropic", () => ({
  CLAUDE_MODEL: "controlled",
  anthropic: {
    messages: {
      create: vi.fn(async () => {
        state.judged += 1;
        return { usage: {}, content: [{ type: "tool_use", input: { stance: "supports", summary: "JUDGED-NOT-EXPECTED", choice: "none" } }] };
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
  buildCrosstab: vi.fn(async (_t: string, _r: string, documentId: string) => ({ tableId: state.tables[documentId] })),
  loadCrosstab: vi.fn(async (_t: string, _r: string, tableId: string) => ({ result: state.results[tableId] })),
}));

type Base = { n: number; w: number; nEff: number };
const b = (n: number): Base => ({ n, w: n, nEff: n });
const share = (label: string, pct: [number, number], total: number, groupBase: number, totalBase: number) => ({
  label, rawCode: label === "Yes" ? "1" : "2",
  count: [null, null], pct, rowPct: [null, null], p: [null, null], sig: [0, 0],
  base: [b(groupBase), b(groupBase)],
  total: { count: null, pct: total, base: b(totalBase) },
});
function table(rows: unknown[]): CrosstabResult {
  return {
    version: 2, weightVar: null, weightLabel: null, overall: false,
    blocks: [{ var: "gender", label: "Gender" }],
    columns: ["Male", "Female"].map((name, i) => ({ block: 0, blockLabel: "Gender", name, n: 100, w: 100, nEff: 100, var: "gender", rawCode: String(i + 1) })),
    total: b(200),
    questions: [{ key: "purchase", label: "Purchase", kind: "single", rows }],
  } as unknown as CrosstabResult;
}
const yesTotal = (total: number, totalBase: number) => table([share("Yes", [total, total], total, 200, totalBase), share("No", [100 - total, 100 - total], 100 - total, 200, totalBase)]);
const meanTable = () =>
  table([{ label: "Average", isMean: true, count: [null, null], pct: [3.5, 3.5], rowPct: [null, null], p: [null, null], sig: [0, 0], base: [b(200), b(200)], total: { count: null, pct: 3.5, base: b(400) }, desc: { sem: 0.06 } }]);
const level = (threshold: number, measure: string | null, answer: string | null = "Yes") => ({ kind: "level", answer, question: null, direction: "above", threshold, measure });

describe.skipIf(!TEST_DATABASE_URL)("OBJ-REV-005 reference cases through the persisted assessment (real database)", () => {
  let db: DisposableDb;
  const tenant = randomUUID();
  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    await db.pool.query("insert into tenants(id,name) values($1,'Synthetic evidence references')", [tenant]);
  }, 120000);
  afterAll(async () => { const { pool } = await import("../db"); await pool.end(); await db.drop(); });

  /** A run whose data files each get the given table; one evidence question with `expectation`. */
  async function evaluate(expectation: object, perFile: CrosstabResult[]) {
    const run = (await db.pool.query("insert into runs(tenant_id,project_name,research_objective) values($1,'References','Understand purchase') returning id", [tenant])).rows[0].id as string;
    for (const [i, result] of perFile.entries()) {
      const doc = (await db.pool.query("insert into documents(tenant_id,run_id,kind,source_filename,storage_path,ingestion_type) values($1,$2,'table',$3,'synthetic','raw') returning id", [tenant, run, `file-${i}.csv`])).rows[0].id as string;
      const t = (await db.pool.query("insert into document_tables(tenant_id,run_id,document_id,table_index,ingestion_type,crosstab) values($1,$2,$3,0,'raw','{}') returning id", [tenant, run, doc])).rows[0].id as string;
      state.tables[doc] = t;
      state.results[t] = result;
    }
    const id = (await db.pool.query(
      "insert into objective_evidence(tenant_id,run_id,item_kind,item_order,item_text,question,request_text,supports_if,against_if,expectation) values($1,$2,'objective',0,'Understand purchase','Reference question?','purchase by gender','Higher','Lower',$3) returning id",
      [tenant, run, JSON.stringify(expectation)],
    )).rows[0].id as string;
    const { evaluateObjectiveEvidenceAction, loadObjectiveEvidenceAction } = await import("../objectiveEvidenceActions");
    const e = await evaluateObjectiveEvidenceAction(run);
    expect(e).toMatchObject({ ok: true, remaining: 0 });
    const loaded = await loadObjectiveEvidenceAction(run);
    if (!loaded.ok) throw new Error(loaded.error);
    return loaded.questions.find((q) => q.id === id)!;
  }

  it("a level read from the total column of a banner table stores the hand-computed interval and supports", async () => {
    state.judged = 0;
    const q = await evaluate(level(50, "percent"), [yesTotal(55, 400)]);
    expect(q.results).toHaveLength(1);
    expect(q.results[0]).toMatchObject({ stance: "supports", basis: "computed", error: null });
    expect(q.results[0].estimate).toMatchObject({ measure: "percent", label: "Yes", value: 55, lo: 50.1, hi: 59.9, n: 400 });
    expect(state.judged).toBe(0);
  });

  it("base 29 is too thin and stored silent; base 30 is read", async () => {
    const thin = await evaluate(level(50, "percent"), [yesTotal(55, 29)]);
    expect(thin.results[0]).toMatchObject({ stance: "silent", basis: "computed" });
    const enough = await evaluate(level(50, "percent"), [yesTotal(55, 30)]);
    expect(enough.results[0].stance).not.toBe("silent");
    expect(enough.results[0].estimate).toMatchObject({ value: 55, n: 30 });
  });

  it("a mean is read with its own standard error; a percent expectation on it is not read", async () => {
    const mean = await evaluate(level(3, "mean", null), [meanTable()]);
    expect(mean.results[0]).toMatchObject({ stance: "supports", basis: "computed" });
    expect(mean.results[0].estimate).toMatchObject({ measure: "mean", value: 3.5, lo: 3.4, hi: 3.6 });
    const mismatch = await evaluate(level(3, "percent", null), [meanTable()]);
    expect(mismatch.results[0]).toMatchObject({ stance: "inconclusive", basis: "computed" });
    expect(mismatch.results[0].estimate?.value ?? null).toBeNull();
  });

  it("a gap inside a declared margin is stored as no meaningful difference (against)", async () => {
    const equal = table([share("Yes", [50, 48], 49, 1000, 2000), share("No", [50, 52], 51, 1000, 2000)]);
    const q = await evaluate({ kind: "comparison", answer: "Yes", question: null, groupA: "Male", groupB: "Female", direction: "higher", margin: 10, measure: "percent" }, [equal]);
    expect(q.results[0]).toMatchObject({ stance: "against", basis: "computed" });
    // diffLo/diffHi hold the gap's interval; lo/hi hold group A's own (50 +/- 1.96 * 1.581 = 46.9 to 53.1).
    expect(q.results[0].estimate).toMatchObject({ diff: 2, diffLo: -2.4, diffHi: 6.4, lo: 46.9, hi: 53.1 });
  });

  it("two data files pointing opposite ways persist both answers and combine to mixed", async () => {
    const q = await evaluate(level(50, "percent"), [yesTotal(70, 400), yesTotal(30, 400)]);
    expect(q.results.map((r) => r.stance).sort()).toEqual(["against", "supports"]);
    expect(q.stance).toBe("mixed");
    expect(state.judged).toBe(0);
  });
});
