import { PYTHON } from "./helpers/pythonEngine";
// Engine identity repair, cache path: the columns-as-cases typing fix (api/parse-stats-file.py
// _flip_types, dictionary version 8) must actually reach EXISTING projects, whose documents carry a
// dictionary cached by the old engine. Real disposable database, the app's actual
// loadVariableDictionary / loadVariableOverrides, and the ACTUAL engine's dictionary for the file
// (computed with python3 below); only the storage download + engine transport (runStatsTool) is
// replaced, by a stub that returns that real engine output and records each call.
//   - a version-7 cache of a columns-as-cases file (identifier typed as a number, as the old flip
//     typing left it) is not reused: the engine is called, the identifier comes back as text, and
//     the current-version result replaces the cache; the next read reuses it without an engine call
//   - the researcher's saved correction (documents.variable_overrides) is unchanged by the rebuild
//     and still read back after it, as after a reload
//   - a version-7 cache of a rows-as-cases file is still reused (its typing did not change)
// Skipped, with the reason printed, without TEST_DATABASE_URL or python3 + pandas.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createDisposableDb, DISPOSABLE_DB_SKIP_REASON, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";

// storage path -> the real engine's dictionary, and every call the app made to the engine
const { engineCalls, engineOutput } = vi.hoisted(() => ({ engineCalls: [] as unknown[][], engineOutput: new Map<string, unknown>() }));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: { storage: { from: vi.fn() } } }));
vi.mock("../parseStatsFile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../parseStatsFile")>()),
  runStatsTool: vi.fn(async (...args: unknown[]) => {
    engineCalls.push(args);
    const out = engineOutput.get(args[1] as string);
    if (!out) throw new Error(`no engine output prepared for ${String(args[1])}`);
    return structuredClone(out);
  }),
}));

const ENGINE = path.join(process.cwd(), "api", "parse-stats-file.py");
const PYTHON_PROBE = spawnSync(PYTHON, ["-c", "import pandas, openpyxl"], { encoding: "utf8" });
const PYTHON_OK = PYTHON_PROBE.status === 0;

// Variables in rows, one column per case; RespID mixes a padded and a plain identifier.
const WIDE = ["Variable,R1,R2,R3,R4", "RespID,001,002, 003 ,004", "Score,5,4,3,5"].join("\n");
const LONG = ["RespID,Score", "001,5", "002,4", "003,3", "004,5"].join("\n");

function realDictionary(csv: string, layout: string): Record<string, unknown> {
  const dir = mkdtempSync(path.join(tmpdir(), "dict-upgrade-"));
  const driver = path.join(dir, "driver.py");
  writeFileSync(
    driver,
    String.raw`
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("engine", sys.argv[1]); eng = importlib.util.module_from_spec(spec); spec.loader.exec_module(eng)
print(json.dumps(eng.dictionary(sys.argv[2].encode(), "f.csv", {"layout": sys.argv[3]})))
`,
  );
  const r = spawnSync(PYTHON, ["-I", driver, ENGINE, csv, layout], { encoding: "utf8", timeout: 120_000 });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout.trim().split("\n").pop()!);
}

type Variable = { name: string; numeric?: boolean; text?: boolean };
const variable = (d: { variables: Variable[] }, name: string) => d.variables.find((v) => v.name === name)!;

describe.skipIf(!TEST_DATABASE_URL || !PYTHON_OK)("old dictionary caches after the columns-as-cases typing repair (real database, real engine output)", () => {
  let db: DisposableDb;
  const tenant = randomUUID();
  let run = "";
  let flippedDoc = "";
  let rowsDoc = "";
  const correction = { Score: { type: "continuous" } };

  beforeAll(async () => {
    db = await createDisposableDb();
    await db.pool.query(`insert into tenants (id, name) values ($1, 'T')`, [tenant]);
    run = (await db.pool.query(`insert into runs (tenant_id, project_name) values ($1, 'P') returning id`, [tenant])).rows[0].id;

    const fresh = realDictionary(WIDE, "columns_are_cases") as { version: number; variables: Variable[]; layout?: string };
    expect(fresh.version).toBe(14);
    expect(variable(fresh, "RespID")).toMatchObject({ numeric: false, text: true });
    // What the old engine cached for this file: version 7, the identifier typed as a number.
    const stale = structuredClone(fresh) as typeof fresh;
    stale.version = 7;
    stale.layout = "columns_are_cases";
    Object.assign(variable(stale, "RespID"), { numeric: true, text: false });

    const rowsCache = { ...realDictionary(LONG, "rows_are_cases"), version: 7, layout: "rows_are_cases" };

    const doc = async (name: string, layout: string, dictionary: unknown, overrides: unknown) =>
      (
        await db.pool.query(
          `insert into documents (tenant_id, run_id, kind, ingestion_type, source_filename, storage_path, data_setup, variable_dictionary, variable_overrides)
           values ($1, $2, 'table', 'raw', $3, $4, $5, $6, $7) returning id`,
          [tenant, run, name, `${tenant}/${run}/${name}`, JSON.stringify({ layout, unit: "respondents", method: "survey", accepted: true }), JSON.stringify(dictionary), JSON.stringify(overrides ?? {})],
        )
      ).rows[0].id as string;
    flippedDoc = await doc("wide.csv", "columns_are_cases", stale, correction);
    rowsDoc = await doc("long.csv", "rows_are_cases", rowsCache, null);
    engineOutput.set(`${tenant}/${run}/wide.csv`, fresh);
    engineOutput.set(`${tenant}/${run}/long.csv`, realDictionary(LONG, "rows_are_cases"));

    (globalThis as { pgPool?: unknown }).pgPool = undefined;
    process.env.DATABASE_URL = db.url;
  }, 180000);

  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end().catch(() => {});
    await db?.drop();
  });

  it("a version-7 columns-as-cases cache is rebuilt by the engine; the correction survives; the rebuilt cache is reused", async () => {
    const { loadVariableDictionary } = await import("../crosstabs");
    const { loadVariableOverrides } = await import("../variableOverrides");

    const first = await loadVariableDictionary(tenant, run, flippedDoc);
    expect(engineCalls).toHaveLength(1);
    expect(engineCalls[0][0]).toBe("dictionary");
    expect(engineCalls[0][3]).toMatchObject({ layout: "columns_are_cases" });
    expect(variable(first as unknown as { variables: Variable[] }, "RespID")).toMatchObject({ numeric: false, text: true });

    const stored = (await db.pool.query(`select variable_dictionary, variable_overrides from documents where id = $1`, [flippedDoc])).rows[0];
    expect(stored.variable_dictionary.version).toBe(14);
    expect(stored.variable_overrides).toEqual(correction);

    // As after a reload: the cache is now current, so no engine call, and the correction reads back.
    const again = await loadVariableDictionary(tenant, run, flippedDoc);
    expect(engineCalls).toHaveLength(1);
    expect(variable(again as unknown as { variables: Variable[] }, "RespID").text).toBe(true);
    expect(await loadVariableOverrides(tenant, run, flippedDoc)).toEqual(correction);
  });

  it("a version-7 rows-as-cases CSV cache is rebuilt too: the one reader (batch 26) changed how CSV and Excel files are read in both layouts", async () => {
    const { loadVariableDictionary, minimumDictionaryVersion } = await import("../crosstabs");
    const before = engineCalls.length;
    const d = await loadVariableDictionary(tenant, run, rowsDoc);
    expect(engineCalls.length).toBe(before + 1);
    expect((d as unknown as { version: number }).version).toBe(14);
    // Rebuilt once, then reused.
    await loadVariableDictionary(tenant, run, rowsDoc);
    expect(engineCalls.length).toBe(before + 1);
    expect(minimumDictionaryVersion("rows_are_cases", "ordinary.csv")).toBe(13);
    expect(minimumDictionaryVersion("columns_are_cases", "wide.xlsx")).toBe(14);
    expect(minimumDictionaryVersion("rows_are_cases", "declared.sav")).toBe(9);
    expect(minimumDictionaryVersion("rows_are_cases", "survey.dta")).toBe(7);
  });

  it("a pre-guard version9 cache cannot bypass reinspection; failed upgrade preserves corrections and retry recovers", async () => {
    const { loadVariableDictionary } = await import("../crosstabs");
    const file = `${tenant}/${run}/wide.csv`;
    const fresh = engineOutput.get(file);
    const old = structuredClone(fresh) as { version: number };
    old.version = 9;
    await db.pool.query("update documents set variable_dictionary = $2 where id = $1", [flippedDoc, JSON.stringify(old)]);
    engineOutput.delete(file);
    await expect(loadVariableDictionary(tenant, run, flippedDoc)).rejects.toThrow(/no engine output/);
    const failed = (await db.pool.query("select variable_dictionary, variable_overrides from documents where id = $1", [flippedDoc])).rows[0];
    expect(failed.variable_dictionary).toEqual(old);
    expect(failed.variable_overrides).toEqual(correction);
    engineOutput.set(file, fresh);
    await loadVariableDictionary(tenant, run, flippedDoc);
    const retried = (await db.pool.query("select variable_dictionary, variable_overrides from documents where id = $1", [flippedDoc])).rows[0];
    expect(retried.variable_dictionary.version).toBe(14);
    expect(retried.variable_overrides).toEqual(correction);
  });
  it("Import retains the original group definition while corrected calculations and clear/retry use one authoritative dictionary", async () => {
    const dictionary = realDictionary("Q1_1,Q1_2\n1,0\n0,1\n1,1\n0,0\n", "rows_are_cases");
    const id = (await db.pool.query(
      "insert into documents(tenant_id,run_id,kind,ingestion_type,source_filename,storage_path,data_setup,variable_dictionary,variable_overrides) values($1,$2,'table','raw','groups.csv','synthetic-groups',$3,$4,$5) returning id",
      [tenant,run,JSON.stringify({layout:"rows_are_cases"}),JSON.stringify(dictionary),JSON.stringify({Q1_1:{questionType:"single"}})],
    )).rows[0].id;
    const { loadImportQuestionDefinitions } = await import("../importQuestionDefinitions");
    const { loadVariableDictionary } = await import("../crosstabs");
    const { saveVariableOverride } = await import("../variableOverrides");
    expect(await loadImportQuestionDefinitions(tenant,run,id)).toEqual({types:{Q1_1:"multi",Q1_2:"multi"},error:null});
    expect((await loadVariableDictionary(tenant,run,id)).sets).toEqual([]);
    await saveVariableOverride(tenant,run,id,"Q1_1",{questionType:null});
    expect((await loadVariableDictionary(tenant,run,id)).sets?.[0].vars).toEqual(["Q1_1","Q1_2"]);
    const missing = await loadImportQuestionDefinitions(tenant,run,randomUUID());
    expect(missing.error).toBeTruthy();
    expect(missing.types).toEqual({});
    expect((await loadImportQuestionDefinitions(tenant,run,id)).error).toBeNull();
  });
});

describe.skipIf(!!TEST_DATABASE_URL && PYTHON_OK)("old dictionary caches after the columns-as-cases typing repair (real database, real engine output)", () => {
  it.skip(!TEST_DATABASE_URL ? DISPOSABLE_DB_SKIP_REASON : "python3 with pandas/openpyxl not available: engine output NOT computed", () => {});
});
