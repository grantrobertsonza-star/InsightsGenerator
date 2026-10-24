// Codex TR500-F01 (2026-10-23): a column called `__proto__` (or another name special to plain
// JavaScript objects) keeps its values through import, storage and the preview check, in both
// layouts, and agrees with the Python engine reading the same bytes. Real database built from every
// migration; the actual workbook reader, `extractAndStoreDocumentTables`, the stored rows and
// `loadImportPreviewIdentities`. Storage is a controlled in-memory stand-in; the variable dictionary
// lookup and model-facing modules are stubbed (not reached for a raw table's values). The engine part
// runs the actual `api/parse-stats-file.py` and is skipped, with the reason, without pandas/openpyxl.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as XLSX from "xlsx";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";
import { PYTHON } from "./helpers/pythonEngine";

vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/db", async () => await import("../db"));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn(async () => {}) }));
vi.mock("../anthropic", () => ({ CLAUDE_MODEL: "controlled", anthropic: { messages: { create: vi.fn(async () => { throw new Error("test: no model call expected"); }) } } }));
vi.mock("../crosstabs", async () => ({ ...(await vi.importActual<object>("../crosstabs")), loadVariableDictionary: vi.fn(async () => ({ variables: [], sets: [] })) }));

const storage = vi.hoisted(() => ({ objects: new Map<string, Buffer>() }));
vi.mock("../supabaseAdmin", () => ({
  supabaseAdmin: {
    storage: {
      from: () => ({
        download: async (key: string) => (storage.objects.has(key) ? { data: new Blob([new Uint8Array(storage.objects.get(key)!)]), error: null } : { data: null, error: { message: "not found" } }),
        remove: async () => ({ data: [], error: null }),
      }),
    },
  },
}));

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

type Row = Record<string, string | number | null>;
const book = (aoa: (string | number | null)[][]) => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Data");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
};

// The same five cases both ways. `__proto__` holds 10, 20, 0 (a real zero) and a missing value;
// `constructor` and `toString` are missing in one case each, which must stay missing, never a
// function. `ordinary` is the control, missing in the last case.
const NAMES = ["__proto__", "constructor", "toString", "ordinary"];
const CASES: (number | null)[][] = [
  [10, 1, 5, 30],
  [20, 2, null, 40],
  [0, null, 7, 50],
  [null, 4, 8, null],
];
const longBook = () => book([NAMES, ...CASES]);
const wideBook = () => book([["Variable", ...CASES.map((_, i) => `Case ${i + 1}`)], ...NAMES.map((n, j) => [n, ...CASES.map((c) => c[j])])]);
// Object.fromEntries defines own properties, so `__proto__` is a column here, as in parsed JSON.
const expectedRows = () => CASES.map((c) => Object.fromEntries(NAMES.map((n, j) => [n, c[j]])));

describe.skipIf(!TEST_DATABASE_URL)("TR500-F01: column names special to JavaScript objects keep their values (real database)", () => {
  let db: DisposableDb;
  const tenant = randomUUID();
  const q = (sql: string, args: unknown[] = []) => db.pool.query(sql, args);

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    await q("insert into tenants(id,name) values($1,'Synthetic reserved names')", [tenant]);
  });
  afterAll(async () => {
    const { pool, claimPool } = await import("../db");
    await pool.end();
    await claimPool?.end?.();
    await db.drop();
  });
  beforeEach(() => storage.objects.clear());

  const importFile = async (layout: "rows_are_cases" | "columns_are_cases", bytes: Buffer) => {
    const run = (await q("insert into runs(tenant_id,project_name) values($1,$2) returning id", [tenant, `Reserved ${layout}`])).rows[0].id as string;
    const storagePath = `${tenant}/${run}/${randomUUID()}-reserved.xlsx`;
    storage.objects.set(storagePath, bytes);
    const setup = { unit: "respondents", layout, method: "survey", accepted: true, wave: null, design: { mode: "none", psu: null, strata: null } };
    const doc = (
      await q(
        "insert into documents(tenant_id,run_id,kind,source_filename,storage_path,ingestion_type,selected_sheet,data_setup) values($1,$2,'table','reserved.xlsx',$3,'raw','Data',$4) returning id",
        [tenant, run, storagePath, JSON.stringify(setup)],
      )
    ).rows[0].id as string;
    const { extractAndStoreDocumentTables } = await import("../documentTables");
    const ids = await extractAndStoreDocumentTables(tenant, run, doc);
    const tables = (await q("select id, document_id, table_index, headers, rows, jsonb_array_length(rows) as row_count from document_tables where id = any($1::uuid[])", [ids])).rows;
    const identity = async () => {
      const current = (await q("select id, document_id, table_index, headers, rows, jsonb_array_length(rows) as row_count from document_tables where id = any($1::uuid[])", [ids])).rows;
      const { loadImportPreviewIdentities } = await import("../importPreviewIdentity");
      return (await loadImportPreviewIdentities(tenant, run, current)).get(doc);
    };
    return { run, doc, tables, identity, reread: () => extractAndStoreDocumentTables(tenant, run, doc) };
  };

  for (const layout of ["rows_are_cases", "columns_are_cases"] as const) {
    it(`${layout}: every value is stored as the row's own value, the preview is verified, and a damaged stored preview is not`, async () => {
      const imported = await importFile(layout, layout === "rows_are_cases" ? longBook() : wideBook());
      expect(imported.tables).toHaveLength(1);
      const [table] = imported.tables as { headers: string[]; rows: Row[] }[];
      expect(table.headers).toEqual(NAMES);
      // Stored rows are what the database gives back (JSON): own properties, values intact.
      expect(table.rows).toEqual(expectedRows());
      for (const row of table.rows) for (const n of NAMES) expect(Object.hasOwn(row, n)).toBe(true);
      expect(table.rows.map((r) => r["__proto__"])).toEqual([10, 20, 0, null]);
      expect(table.rows.map((r) => r.constructor)).toEqual([1, 2, null, 4]);
      expect(await imported.identity()).toEqual({ error: null });

      // The stored preview loses the column's values (what the earlier reader did): not verified,
      // whatever an inherited property would have compared as.
      await q("update document_tables set rows = (select jsonb_agg(r - '__proto__') from jsonb_array_elements(rows) r) where document_id = $1", [imported.doc]);
      expect((await imported.identity())?.error).toMatch(/differs from selected sheet/);
      // A changed value is not verified either; a reread restores a verified preview.
      await imported.reread();
      expect(await imported.identity()).toEqual({ error: null });
      await q("update document_tables set rows = jsonb_set(rows, '{0,__proto__}', '11') where document_id = $1", [imported.doc]);
      expect((await imported.identity())?.error).toMatch(/differs from selected sheet/);
      // A stored row that lost a column whose value was missing is damaged too: it is not read as
      // "missing equals missing".
      await imported.reread();
      await q("update document_tables set rows = jsonb_set(rows, '{3}', (rows->3) - 'ordinary') where document_id = $1", [imported.doc]);
      expect((await imported.identity())?.error).toMatch(/differs from selected sheet/);
    });
  }

  it("a repeated reserved name gets its own suffixed column, and both keep their values", async () => {
    const imported = await importFile("rows_are_cases", book([["__proto__", "__proto__", "ordinary"], [1, 2, 3], [4, 5, 6]]));
    const [table] = imported.tables as { headers: string[]; rows: Row[] }[];
    expect(table.headers).toEqual(["__proto__", "__proto__ (2)", "ordinary"]);
    // Written as JSON: an object literal's `__proto__:` would set a prototype, not a column.
    expect(table.rows).toEqual(JSON.parse('[{"__proto__":1,"__proto__ (2)":2,"ordinary":3},{"__proto__":4,"__proto__ (2)":5,"ordinary":6}]'));
    expect(table.rows.map((r) => [Object.hasOwn(r, "__proto__") && r["__proto__"], r["__proto__ (2)"]])).toEqual([[1, 2], [4, 5]]);
    expect(await imported.identity()).toEqual({ error: null });
  });

  const ENGINE = path.join(process.cwd(), "api", "parse-stats-file.py");
  const PYTHON_OK = spawnSync(PYTHON, ["-c", "import pandas, openpyxl"], { encoding: "utf8" }).status === 0;
  it.skipIf(!PYTHON_OK)("the Python engine reading the identical bytes counts the same values in both layouts", async () => {
    const driver = String.raw`
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("engine", sys.argv[1]); eng = importlib.util.module_from_spec(spec); spec.loader.exec_module(eng)
out = {}
for name, file, layout in (("long", sys.argv[2], "rows_are_cases"), ("wide", sys.argv[3], "columns_are_cases")):
    b = open(file, "rb").read()
    d = eng.dictionary(b, "reserved.xlsx", {"layout": layout, "selectedSheet": "Data"})
    out[name] = {
        "cases": d.get("nCases"),
        "valid": {v["name"]: v["nValid"] for v in d["variables"]},
        "proto": sorted((float(c["label"]), c["n"]) for c in eng.categories(b, "reserved.xlsx", "__proto__", layout=layout, selected_sheet="Data")["categories"]),
    }
print(json.dumps(out))
`;
    const dir = mkdtempSync(path.join(tmpdir(), "tr500-f01-"));
    const long = longBook();
    const wide = wideBook();
    writeFileSync(path.join(dir, "driver.py"), driver);
    writeFileSync(path.join(dir, "long.xlsx"), long);
    writeFileSync(path.join(dir, "wide.xlsx"), wide);
    const r = spawnSync(PYTHON, ["-I", path.join(dir, "driver.py"), ENGINE, path.join(dir, "long.xlsx"), path.join(dir, "wide.xlsx")], { encoding: "utf8", timeout: 120_000 });
    if (r.status !== 0) throw new Error(r.stderr);
    const engine = JSON.parse(r.stdout.trim().split("\n").pop()!);

    // What the app stored from the same bytes.
    for (const [key, layout, bytes] of [["long", "rows_are_cases", long], ["wide", "columns_are_cases", wide]] as const) {
      const imported = await importFile(layout, bytes);
      const rows = (imported.tables[0] as { rows: Row[] }).rows;
      const valid = Object.fromEntries(NAMES.map((n) => [n, rows.filter((row) => row[n] !== null).length]));
      const proto = [...new Set(rows.map((row) => row["__proto__"]).filter((v): v is number => typeof v === "number"))]
        .sort((a, b) => a - b)
        .map((v) => [v, rows.filter((row) => row["__proto__"] === v).length]);
      expect(engine[key].cases).toBe(rows.length);
      for (const n of NAMES) expect(engine[key].valid[n]).toBe(valid[n]);
      expect(engine[key].proto).toEqual(proto);
    }
    expect(engine.long.valid["__proto__"]).toBe(3);
    expect(engine.long.proto).toEqual([[0, 1], [10, 1], [20, 1]]);
  });
});
