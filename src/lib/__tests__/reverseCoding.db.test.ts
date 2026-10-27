// Import step 3: reverse-coded battery items (reverseCoding.ts; engine _reversal_suggestions and
// _apply_reversals), through the actual actions, loaders and the local engine, with a real disposable
// PostgreSQL. Storage and the model are the mocked boundaries. A designed .sav whose expected figures are
// computed by plain arithmetic in its generator, independently of the engine:
//   - the reversed item is suggested on both signs (its "not" wording and a negative item-rest
//     correlation); no other item is
//   - confirming it records the scale (1 to 5) and the evidence; confirming again changes nothing; an
//     item outside any battery is refused with nothing saved; a file column already named Q1_3_r makes
//     the derived name Q1_3_r2
//   - the derived variable is in the dictionary in the battery's place; its categories are the
//     original's turned around, the "don't know" code kept as it was; its mean matches the independent
//     value, and the original column is unchanged
//   - the respondent check flags the one respondent who gave the same answer to items worded in
//     opposite directions
//   - undo removes the derived variable and puts the original back in its battery
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";
import { PYTHON } from "./helpers/pythonEngine";

vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/db", async () => await import("../db"));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", async (orig) => ({ ...(await orig<object>()), after: vi.fn() }));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn(async () => {}) }));
vi.mock("../anthropic", () => ({ CLAUDE_MODEL: "controlled", anthropic: { messages: { create: vi.fn(async () => { throw new Error("test: no model call expected"); }) } } }));
const storage = vi.hoisted(() => ({ objects: new Map<string, Buffer>() }));
vi.mock("../supabaseAdmin", () => ({
  supabaseAdmin: {
    storage: {
      from: () => ({
        download: async (key: string) => (storage.objects.has(key) ? { data: new Blob([new Uint8Array(storage.objects.get(key)!)]), error: null } : { data: null, error: { message: "not found" } }),
        remove: async () => ({ data: [], error: null }),
        upload: async () => ({ data: {}, error: null }),
      }),
    },
  },
}));

vi.setConfig({ testTimeout: 120_000, hookTimeout: 180_000 });
const PYTHON_OK = spawnSync(PYTHON, ["-c", "import pandas, pyreadstat"], { encoding: "utf8" }).status === 0;

type Expected = { n: number; original: Record<string, number>; reversed: Record<string, number>; meanOriginal: number; meanReversed: number; sumOriginal: number; sumReversed: number };

/** 60 respondents, battery Q1_1..Q1_5 on 1..5 with "Don't know" = 9; Q1_3 worded and answered the other way. */
function designed(withCollision: boolean): { bytes: Buffer; expected: Expected } {
  const dir = mkdtempSync(path.join(tmpdir(), "reverse-"));
  const out = path.join(dir, "battery.sav");
  const script = String.raw`
import sys, json, pandas as pd, pyreadstat
n = 60
cols = {"ID": [float(i + 1) for i in range(n)]}
for j in range(1, 6):
    col = []
    for i in range(n):
        base = (i % 5) + 1
        v = min(5, max(1, base + ((i + j) % 3) - 1))
        if j == 3:
            v = 6 - v
        col.append(float(v))
    cols[f"Q1_{j}"] = col
cols["Q1_3"][0] = 9.0                      # respondent 1: "Don't know" on the reversed item
for j in range(1, 6):
    cols[f"Q1_{j}"][1] = 4.0               # respondent 2: 4 to every item, including the reversed one
if sys.argv[2] == "1":
    cols["Q1_3_r"] = [0.0] * n             # a column already named like the derived variable
labels = {f"Q1_{j}": {1.0: "Strongly disagree", 2.0: "Disagree", 3.0: "Neither", 4.0: "Agree", 5.0: "Strongly agree", 9.0: "Don't know"} for j in range(1, 6)}
names = ["ID"] + [f"Q1_{j}" for j in range(1, 6)] + (["Q1_3_r"] if sys.argv[2] == "1" else [])
texts = {"ID": "ID", "Q1_1": "Brand statements: I trust the brand", "Q1_2": "Brand statements: The brand is good value", "Q1_3": "Brand statements: I would not recommend the brand",
         "Q1_4": "Brand statements: The brand is reliable", "Q1_5": "Brand statements: I like the brand", "Q1_3_r": "Existing column"}
pyreadstat.write_sav(pd.DataFrame(cols)[names], sys.argv[1], column_labels=[texts[c] for c in names], variable_value_labels=labels)
orig = [v for v in cols["Q1_3"] if v != 9.0]
rev = [6 - v for v in orig]
count = lambda xs: {str(int(k)): xs.count(k) for k in sorted(set(xs))}
print(json.dumps({"n": n, "original": count(cols["Q1_3"]), "reversed": count([6 - v if v != 9.0 else 9.0 for v in cols["Q1_3"]]),
                  "meanOriginal": sum(orig) / len(orig), "meanReversed": sum(rev) / len(rev), "sumOriginal": sum(orig), "sumReversed": sum(rev)}))
`;
  const r = spawnSync(PYTHON, ["-I", "-c", script, out, withCollision ? "1" : "0"], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  return { bytes: readFileSync(out), expected: JSON.parse(r.stdout) };
}

describe.skipIf(!TEST_DATABASE_URL || !PYTHON_OK)("import step 3: reverse-coded battery items (real database, actual engine)", () => {
  let db: DisposableDb;
  const tenant = process.env.DEFAULT_TENANT_ID ?? randomUUID();
  let run = "";
  const q = async (sql: string, p: unknown[] = []) => (await db.pool.query(sql, p)).rows;

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    (globalThis as { pgPool?: unknown }).pgPool = undefined;
    await db.pool.query("insert into tenants (id, name) values ($1, 'T') on conflict do nothing", [tenant]);
    run = (await db.pool.query("insert into runs (tenant_id, project_name) values ($1, 'P') returning id", [tenant])).rows[0].id;
  });
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end().catch(() => {});
    await db?.drop();
  });

  async function file(bytes: Buffer) {
    const key = `${tenant}/${run}/${randomUUID()}-battery.sav`;
    storage.objects.set(key, bytes);
    return (await q(
      `insert into documents (tenant_id, run_id, kind, ingestion_type, source_filename, storage_path, data_setup)
       values ($1, $2, 'table', 'raw', 'battery.sav', $3, $4) returning id`,
      [tenant, run, key, JSON.stringify({ layout: "rows_are_cases", unit: "respondents", method: "survey", accepted: true })],
    ))[0].id as string;
  }
  const quality = async (doc: string) => (await import("../respondentQuality")).loadRespondentQuality(tenant, run, doc);
  const actions = () => import("../variableOverrideActions");
  const stored = async (doc: string) => (await q("select variable_overrides from documents where id = $1", [doc]))[0].variable_overrides;

  it("suggests the reversed item, confirms it with its scale and evidence, and the derived variable is the original turned around", async () => {
    const { bytes, expected } = designed(false);
    const doc = await file(bytes);
    const before = await quality(doc);
    const grid = before.straightlining.grids.find((g) => g.stem === "Q1")!;
    expect(grid.reversalSuggestions).toEqual([
      { variable: "Q1_3", label: "Brand statements: I would not recommend the brand", wording: "not", itemRest: expect.any(Number), cases: 59, strength: "both" },
    ]);
    expect(grid.reversalSuggestions![0].itemRest!).toBeLessThan(-0.5);
    expect(grid.reversedItems).toEqual([]);

    const a = await actions();
    // Not in a battery: refused, nothing saved.
    expect(await a.confirmReversalAction(run, doc, "ID")).toMatchObject({ ok: false, error: expect.stringMatching(/not in a battery.*Nothing was saved/) });
    expect(await stored(doc)).toEqual({});
    expect(await a.confirmReversalAction(run, doc, "Q1_3")).toEqual({ ok: true, derived: "Q1_3_r" });
    expect(await a.confirmReversalAction(run, doc, "Q1_3")).toEqual({ ok: true, derived: "Q1_3_r" });
    expect((await stored(doc)).Q1_3.reverse).toMatchObject({ derived: "Q1_3_r", min: 1, max: 5, evidence: { wording: "not", cases: 59, suggested: true }, confirmedAt: expect.any(String) });

    // The dictionary: the derived variable in the battery's place, the original kept on its own.
    const { loadVariableDictionary, loadCategories, buildCrosstab } = await import("../crosstabs");
    const dict = await loadVariableDictionary(tenant, run, doc);
    const derived = dict.variables.find((v) => v.name === "Q1_3_r")!;
    expect(derived.label).toBe("Brand statements: I would not recommend the brand (reversed)");
    const set = (dict.sets ?? []).find((s) => s.vars.includes("Q1_3_r"));
    expect(set?.vars).toEqual(["Q1_1", "Q1_2", "Q1_3_r", "Q1_4", "Q1_5"]);
    expect(dict.variables.find((v) => v.name === "Q1_3")!.inSet).toBeUndefined();

    // Categories: the original's counts turned around; "Don't know" (9) kept as it was.
    const counts = async (variable: string) =>
      Object.fromEntries((await loadCategories(tenant, run, doc, variable)).categories.map((c) => [c.label, c.n]));
    const label = { "1": "Strongly disagree", "2": "Disagree", "3": "Neither", "4": "Agree", "5": "Strongly agree", "9": "Don't know" } as Record<string, string>;
    const named = (byCode: Record<string, number>) => Object.fromEntries(Object.entries(byCode).map(([k, v]) => [label[k], v]));
    expect(await counts("Q1_3_r")).toMatchObject(named(expected.reversed));
    expect(await counts("Q1_3")).toMatchObject(named(expected.original));

    // Means against the generator's own arithmetic ("Don't know" excluded).
    const mean = async (variable: string) => {
      const t = await buildCrosstab(tenant, run, doc, { columnVars: [], rowItems: [{ key: variable, label: variable, vars: [variable] }], weightVar: null, typeOverrides: undefined } as never);
      const { loadCrosstab } = await import("../crosstabs");
      const { result } = await loadCrosstab(tenant, run, t.tableId);
      // The engine's descriptive statistics for a mean row (rounded to 3 places; its sum is exact).
      const rows = result!.questions[0].rows as { desc?: { mean: number; sum: number; n: number } }[];
      return rows.find((r) => r.desc)?.desc ?? null;
    };
    await (await import("../variableOverrides")).saveVariableOverride(tenant, run, doc, "Q1_3", { type: "continuous" });
    expect(await mean("Q1_3")).toMatchObject({ n: 59, sum: expected.sumOriginal, mean: expect.closeTo(expected.meanOriginal, 3) });
    expect(await mean("Q1_3_r")).toMatchObject({ n: 59, sum: expected.sumReversed, mean: expect.closeTo(expected.meanReversed, 3) });
    expect(expected.meanOriginal + expected.meanReversed).toBeCloseTo(6, 9);

    // The respondent check flags the one contradictory straightliner (respondent 2).
    const after = (await quality(doc)).straightlining.grids.find((g) => g.stem === "Q1")!;
    expect(after.reversedItems).toEqual(["Q1_3"]);
    expect(after.reversedStraightliners).toBe(1);

    // Undo: the derived variable goes; the original is back in its battery.
    expect(await a.removeReversalAction(run, doc, "Q1_3")).toEqual({ ok: true, removed: true });
    expect(await a.removeReversalAction(run, doc, "Q1_3")).toEqual({ ok: true, removed: false });
    const back = await loadVariableDictionary(tenant, run, doc);
    expect(back.variables.some((v) => v.name === "Q1_3_r")).toBe(false);
    expect((back.sets ?? []).find((s) => s.vars.includes("Q1_3"))?.vars).toEqual(["Q1_1", "Q1_2", "Q1_3", "Q1_4", "Q1_5"]);
    expect((await stored(doc)).Q1_3).toEqual({ type: "continuous" }); // the other correction is kept
  });

  // A reversal that can no longer be built (here the file was replaced by one that has its own Q1_3_r
  // column) is refused with its reason when the variable is used, never read as an absent or empty column.
  it("a reversed variable that can no longer be built fails with its reason when used", async () => {
    const doc = await file(designed(false).bytes);
    expect(await (await actions()).confirmReversalAction(run, doc, "Q1_3")).toEqual({ ok: true, derived: "Q1_3_r" });
    const key = `${tenant}/${run}/${randomUUID()}-replaced.sav`;
    storage.objects.set(key, designed(true).bytes);
    await q("update documents set storage_path = $2 where id = $1", [doc, key]);
    const { loadCategories } = await import("../crosstabs");
    await expect(loadCategories(tenant, run, doc, "Q1_3_r")).rejects.toThrow(/Q1_3_r \(from Q1_3\) could not be built: The file already has a column named Q1_3_r/);
    // Recovery: undoing the reversal reads the file's own column again.
    expect(await (await actions()).removeReversalAction(run, doc, "Q1_3")).toMatchObject({ ok: true });
    expect((await loadCategories(tenant, run, doc, "Q1_3_r")).categories.map((c) => c.label)).toEqual(["0.0"]);
  });

  it("names the derived variable Q1_3_r2 when the file already has a Q1_3_r column", async () => {
    const doc = await file(designed(true).bytes);
    expect(await (await actions()).confirmReversalAction(run, doc, "Q1_3")).toEqual({ ok: true, derived: "Q1_3_r2" });
    const { loadCategories } = await import("../crosstabs");
    expect((await loadCategories(tenant, run, doc, "Q1_3_r")).categories.map((c) => c.label)).toEqual(["0.0"]); // the file's own column, untouched
    expect((await loadCategories(tenant, run, doc, "Q1_3_r2")).categories.length).toBeGreaterThan(2);
  });
});
