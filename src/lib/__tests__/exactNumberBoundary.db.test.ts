// Codex B26-F01 (batch 28): decimal and exponent spellings of a number a double cannot hold exactly
// ("9007199254740993.0", "9007199254740993e0") used to be stored as the rounded double, so two distinct
// source values merged into one category. The one reader now keeps such a variable as text in every
// spelling (_exact_decimal in api/parse-stats-file.py). Real database built from every migration; the
// actual extractAndStoreDocumentTables, loadVariableDictionary, loadCategories and
// loadImportPreviewIdentities, reading through the actual engine (local runner). Storage is an in-memory
// stand-in; the model is stubbed (never reached). Expected values are written out from the source text.
//   - CSV and Excel text cells, rows-as-cases and columns-as-cases: four distinct written values stay
//     four distinct stored values and four categories of one each; the variable is not numeric
//   - safe controls stay numeric: plain decimals, a trailing zero, an exponent, 2^53 itself
//   - a table stored by the earlier reader with the rounded values, and a version-11 dictionary that
//     merged them, are not reused: the preview is withheld, the dictionary is rebuilt
//   - a failed re-read keeps the earlier table (still withheld); a valid re-read recovers
//   - one typing policy beyond 2^53 (Codex RP0-M01): decimal and exponent spellings are text like a bare
//     whole number, even when the double would be exact; 2^53 itself and safe values stay numbers
// Skipped, with the reason, without a test database or python3 + pandas/openpyxl/pyreadstat.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
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

vi.setConfig({ testTimeout: 90_000, hookTimeout: 180_000 });
const PYTHON_OK = spawnSync(PYTHON, ["-c", "import pandas, openpyxl, pyreadstat"], { encoding: "utf8" }).status === 0;

type Row = Record<string, string | number | null>;
type Cell = string | number | boolean | null | { date: number };

/** An .xlsx built cell by cell. { date: serial } is a number cell formatted yyyy-mm-dd. */
function xlsx(aoa: Cell[][]): Buffer {
  const ws: XLSX.WorkSheet = {};
  aoa.forEach((row, r) => row.forEach((v, c) => {
    if (v === null) return;
    const addr = XLSX.utils.encode_cell({ r, c });
    if (typeof v === "object") ws[addr] = { t: "n", v: v.date, z: "yyyy-mm-dd" };
    else if (typeof v === "number") ws[addr] = { t: "n", v };
    else if (typeof v === "boolean") ws[addr] = { t: "b", v };
    else ws[addr] = { t: "s", v };
  }));
  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: aoa.length - 1, c: Math.max(...aoa.map((r) => r.length)) - 1 } });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Data");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

describe.skipIf(!TEST_DATABASE_URL || !PYTHON_OK)("exact numbers in every spelling (Codex B26-F01; real database, actual engine)", () => {
  let db: DisposableDb;
  const tenant = process.env.DEFAULT_TENANT_ID ?? randomUUID();
  let run = "";
  const q = async (sql: string, p: unknown[] = []) => (await db.pool.query(sql, p)).rows;

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    (globalThis as { pgPool?: unknown }).pgPool = undefined;
    await db.pool.query("insert into tenants (id, name) values ($1, 'T') on conflict do nothing", [tenant]);
    run = (await db.pool.query("insert into runs (tenant_id, project_name) values ($1, 'P') returning id", [tenant])).rows[0].id;
  });
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end().catch(() => {});
    await db?.drop();
  });

  /** A table document holding these bytes, set up with a layout. */
  async function file(name: string, bytes: Buffer, layout: "rows_are_cases" | "columns_are_cases" = "rows_are_cases") {
    const path = `${tenant}/${run}/${randomUUID()}-${name}`;
    storage.objects.set(path, bytes);
    return (await q(
      `insert into documents (tenant_id, run_id, kind, ingestion_type, source_filename, storage_path, data_setup)
       values ($1, $2, 'table', 'raw', $3, $4, $5) returning id`,
      [tenant, run, name, path, JSON.stringify({ layout, unit: "respondents", method: "survey", accepted: true })],
    ))[0].id as string;
  }
  async function imported(doc: string): Promise<{ headers: string[]; rows: Row[]; provenance: Record<string, unknown> | null }> {
    const { extractAndStoreDocumentTables } = await import("../documentTables");
    await extractAndStoreDocumentTables(tenant, run, doc);
    const t = (await q("select headers, rows, read_provenance from document_tables where document_id = $1 and table_index = 0", [doc]))[0];
    return { headers: t.headers, rows: t.rows, provenance: t.read_provenance };
  }
  const categories = async (doc: string, variable: string) => {
    const { loadCategories } = await import("../crosstabs");
    return Object.fromEntries((await loadCategories(tenant, run, doc, variable)).categories.map((c) => [c.label, c.n]));
  };

  const big = ["9007199254740992.0", "9007199254740993.0", "9007199254740992e0", "9007199254740993e0"];
  const counts = Object.fromEntries(big.map((v) => [v, 1]));
  const numericFlag = async (doc: string, name: string) => {
    const { loadVariableDictionary } = await import("../crosstabs");
    return (await loadVariableDictionary(tenant, run, doc)).variables.find((v) => v.name === name)?.numeric;
  };

  it("decimal and exponent spellings beyond exact range stay distinct text, CSV and Excel, both layouts", async () => {
    const cases: [string, Buffer, "rows_are_cases" | "columns_are_cases"][] = [
      ["big-long.csv", Buffer.from(`id,big\n${big.map((v, i) => `r${i + 1},${v}`).join("\n")}\n`, "utf-8"), "rows_are_cases"],
      ["big-wide.csv", Buffer.from(`Variable,${big.map((_, i) => `C${i + 1}`).join(",")}\nbig,${big.join(",")}\n`, "utf-8"), "columns_are_cases"],
      ["big-long.xlsx", xlsx([["id", "big"], ...big.map((v, i) => [`r${i + 1}`, v])]), "rows_are_cases"],
      ["big-wide.xlsx", xlsx([["Variable", ...big.map((_, i) => `C${i + 1}`)], ["big", ...big]]), "columns_are_cases"],
    ];
    for (const [name, bytes, layout] of cases) {
      const doc = await file(name, bytes, layout);
      const t = await imported(doc);
      expect(t.rows.map((r) => r.big), name).toEqual(big);
      expect(await categories(doc, "big"), name).toEqual(counts);
      expect(await numericFlag(doc, "big"), name).toBe(false);
      // Reloaded from the database, the stored cells are still the written text.
      const reloaded = (await q("select rows from document_tables where document_id = $1 and table_index = 0", [doc]))[0].rows as Row[];
      expect(reloaded.map((r) => r.big), name).toEqual(big);
    }
  });

  it("safe numbers stay numeric: plain decimals, trailing zeros, exponents and 2^53 itself; one more than 2^53 is text", async () => {
    const doc = await file("safe.csv", Buffer.from("a,b,c\n0.1,2.50,1e3\n0.25,-3.0,2.5E-2\n", "utf-8"));
    const t = await imported(doc);
    expect(t.rows).toEqual([{ a: 0.1, b: 2.5, c: 1000 }, { a: 0.25, b: -3, c: 0.025 }]);
    for (const v of ["a", "b", "c"]) expect(await numericFlag(doc, v), v).toBe(true);
    const edge = await imported(await file("edge.csv", Buffer.from("x,y\n9007199254740992,9007199254740992.0\n1,9007199254740993\n", "utf-8")));
    expect(edge.rows.map((r) => r.x)).toEqual([9007199254740992, 1]);
    expect(edge.rows.map((r) => r.y)).toEqual(["9007199254740992.0", "9007199254740993"]);
  });

  it("one typing policy beyond 2^53 (Codex RP0-M01): every spelling is text, even a representable double; 2^53 itself and safe decimals stay numbers", async () => {
    // Each column holds one spelling and a plain 1, so the column's type follows that spelling alone.
    const spellings = ["9007199254740994", "9007199254740994.0", "1e16", "1e30", "-1e16", "9007199254740992", "9007199254740992.0", "1e15", "0.5"];
    const header = spellings.map((_, i) => `c${i}`).join(",");
    const doc = await file("boundary.csv", Buffer.from(`${header}\n${spellings.join(",")}\n${spellings.map(() => "1").join(",")}\n`, "utf-8"));
    const t = await imported(doc);
    const first = spellings.map((_, i) => t.rows[0][`c${i}`]);
    expect(first).toEqual(["9007199254740994", "9007199254740994.0", "1e16", "1e30", "-1e16", 9007199254740992, 9007199254740992, 1e15, 0.5]);
    for (const [i, v] of spellings.entries()) expect(await numericFlag(doc, `c${i}`), v).toBe(typeof first[i] === "number");
  });

  it("a table and dictionary from the earlier reader are not reused; a failed re-read keeps the old table withheld; a valid re-read recovers", async () => {
    const bytes = Buffer.from(`id,big\n${big.map((v, i) => `r${i + 1},${v}`).join("\n")}\n`, "utf-8");
    const doc = await file("legacy-big.csv", bytes);
    // What reader engine-plain-2026.10.25 and dictionary version 11 stored: the rounded double.
    const rounded = big.map((_, i) => ({ id: `r${i + 1}`, big: 9007199254740992 }));
    await q(
      `insert into document_tables (tenant_id, run_id, document_id, table_index, label, headers, rows, ingestion_type, read_provenance)
       values ($1, $2, $3, 0, 'legacy-big.csv', $4, $5, 'raw', $6)`,
      [tenant, run, doc, JSON.stringify(["id", "big"]), JSON.stringify(rounded),
        JSON.stringify({ reader: "engine-plain-2026.10.25", sheet: null, layout: "rows_are_cases", encoding: "utf-8", dateColumns: [] })],
    );
    const legacyDictionary = {
      version: 11, layout: "rows_are_cases", sets: {}, sheets: {}, nCases: 4,
      variables: [{ name: "id", label: "id", numeric: false }, { name: "big", label: "big", numeric: true }],
    };
    await q("update documents set variable_dictionary = $2 where id = $1", [doc, JSON.stringify(legacyDictionary)]);
    const { loadImportPreviewIdentities } = await import("../importPreviewIdentity");
    const stored = async () => (await q("select document_id, table_index, headers, rows, jsonb_array_length(rows) as row_count, read_provenance from document_tables where document_id = $1", [doc]));
    const identity = async () => (await loadImportPreviewIdentities(tenant, run, await stored())).get(doc)?.error ?? null;
    expect(await identity()).toMatch(/differs from what the file holds now/);
    // The dictionary is rebuilt at the current version (DICTIONARY_VERSION) with four distinct values.
    expect(await numericFlag(doc, "big")).toBe(false);
    expect(await categories(doc, "big")).toEqual(counts);
    expect((await q("select variable_dictionary->>'version' as v from documents where id = $1", [doc]))[0].v).toBe("15");
    // Reading the file again while it is unreadable fails and keeps the earlier table, still withheld.
    const { extractAndStoreDocumentTables } = await import("../documentTables");
    const original = (await q("select storage_path from documents where id = $1", [doc]))[0].storage_path;
    const broken = `${tenant}/${run}/${randomUUID()}-legacy-big.csv`;
    storage.objects.set(broken, Buffer.from('id,big\nr1,"unterminated\n', "utf-8"));
    await q("update documents set storage_path = $2 where id = $1", [doc, broken]);
    await expect(extractAndStoreDocumentTables(tenant, run, doc)).rejects.toThrow(/closing quotation mark/);
    expect((await stored())[0].rows).toEqual(rounded);
    // The valid file read again replaces it with the written values, shown without a fresh comparison.
    await q("update documents set storage_path = $2 where id = $1", [doc, original]);
    const t = await imported(doc);
    expect(t.rows.map((r) => r.big)).toEqual(big);
    expect(t.provenance).toMatchObject({ reader: (await import("../importPreviewIdentity")).ENGINE_TABLE_READER });
    expect(await identity()).toBeNull();
  });
});
