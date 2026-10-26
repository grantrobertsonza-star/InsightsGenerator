// The one reader for CSV, TSV and Excel (Grant, 24 October 2026; batch 26) against Codex's open import
// findings TP500-F01 to F03 and IP1000-F01 to F04. Real database built from every migration; the actual
// extractAndStoreDocumentTables (stored preview), loadVariableDictionary, loadCategories, the engine's
// driver columns and saveVariableOverride / loadVariableOverrides, all reading through the actual
// api/parse-stats-file.py (the local engine runner). Storage is an in-memory stand-in and the model is
// stubbed (never reached). Each check compares the stored preview AND the calculation with values
// written out here from the source bytes, not with each other alone.
//   TP500-F01  literal names ("NaN", "null", "None", "NA", "01", "TRUE", "Infinity", Unicode) stay names,
//              in both layouts and both formats; the dictionary names the same variables
//   TP500-F02  rows named q, q, q (2): the row literally named "q (2)" keeps that name and its own values
//              in preview and calculation (mean 250), the second "q" is "q (3)" (mean 25)
//   TP500-F03  a first correction of a variable named "__proto__" is stored as its own entry, reloads,
//              combines with a second field, survives a simultaneous save of the other field, clears,
//              and leaves an unrelated variable's correction alone
//   IP1000-F01 distinct text codes 001, 1, 0001, +2 stay four codes in preview and categories; a true
//              numeric column stays numeric; missing tokens stay missing
//   IP1000-F02 date-formatted Excel cells (the integer control 61, 25569, 36526, 45292, a leap day and a
//              pre-1970 date) are calendar dates in preview and categories, in both layouts; CSV date
//              text stays as written
//   IP1000-F03 UTF-8 without a byte-order mark keeps every code point (accents, combining, CJK, emoji,
//              quoted line breaks) for comma, semicolon and tab files; BOM control; Windows-1252 is read
//              and reported; bytes that are neither are refused with nothing stored
//   IP1000-F04 an unterminated quoted field is refused before anything is published, and the
//              calculation refuses it too; a failed re-read keeps the earlier table; a valid replacement
//              recovers
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
function xlsx(aoa: Cell[][], bookType: "xlsx" | "biff8" = "xlsx"): Buffer {
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
  return XLSX.write(wb, { type: "buffer", bookType }) as Buffer;
}

describe.skipIf(!TEST_DATABASE_URL || !PYTHON_OK)("one reader for CSV, TSV and Excel (real database, actual engine)", () => {
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
  const dictionaryNames = async (doc: string) => {
    const { loadVariableDictionary } = await import("../crosstabs");
    return (await loadVariableDictionary(tenant, run, doc)).variables.map((v) => v.name);
  };
  const categories = async (doc: string, variable: string) => {
    const { loadCategories } = await import("../crosstabs");
    return Object.fromEntries((await loadCategories(tenant, run, doc, variable)).categories.map((c) => [c.label, c.n]));
  };
  /** The engine's own numbers for one variable (driver analysis input), case by case. */
  const engineValues = async (doc: string, variable: string, layout: string) => {
    const { runStatsTool } = await import("../parseStatsFile");
    const d = (await q("select storage_path, source_filename from documents where id = $1", [doc]))[0];
    return (await runStatsTool<{ y: (number | null)[] }>("columns", d.storage_path, d.source_filename, { outcome: variable, predictors: [], layout })).y;
  };
  const mean = (xs: (number | string | null)[]) => xs.reduce<number>((a, b) => a + Number(b), 0) / xs.length;

  it("TP500-F01: literal names stay names in both layouts and both formats, and the dictionary names the same variables", async () => {
    const names = ["NaN", "null", "None", "NA", "01", "TRUE", "Infinity", "Café ñ"];
    const values = names.map((_, i) => i + 1);
    const longCsv = Buffer.from(`${names.join(",")}\n${values.join(",")}\n`, "utf-8");
    const wideCsv = Buffer.from(`Variable,Case 1\n${names.map((n, i) => `${n},${values[i]}`).join("\n")}\n`, "utf-8");
    const cases: [string, Buffer, "rows_are_cases" | "columns_are_cases"][] = [
      ["long.csv", longCsv, "rows_are_cases"],
      ["wide.csv", wideCsv, "columns_are_cases"],
      ["long.xlsx", xlsx([names, values]), "rows_are_cases"],
      ["wide.xlsx", xlsx([["Variable", "Case 1"], ...names.map((n, i) => [n, values[i]])]), "columns_are_cases"],
    ];
    for (const [name, bytes, layout] of cases) {
      const doc = await file(name, bytes, layout);
      const t = await imported(doc);
      expect(t.headers, name).toEqual(names);
      expect(t.rows, name).toEqual([Object.fromEntries(names.map((n, i) => [n, values[i]]))]);
      expect(await dictionaryNames(doc), name).toEqual(names);
    }
  });

  it("TP500-F02: q, q, q (2): the literal \"q (2)\" keeps its own values in preview and calculation, CSV and Excel", async () => {
    const rows: [string, number[]][] = [["q", [1, 2, 3, 4]], ["q", [10, 20, 30, 40]], ["q (2)", [100, 200, 300, 400]]];
    const wideCsv = Buffer.from(`Variable,C1,C2,C3,C4\n${rows.map(([n, v]) => `${n},${v.join(",")}`).join("\n")}\n`, "utf-8");
    const wideXlsx = xlsx([["Variable", "C1", "C2", "C3", "C4"], ...rows.map(([n, v]) => [n, ...v])]);
    for (const [name, bytes] of [["dup.csv", wideCsv], ["dup.xlsx", wideXlsx]] as const) {
      const doc = await file(name, bytes, "columns_are_cases");
      const t = await imported(doc);
      expect(t.headers, name).toEqual(["q", "q (3)", "q (2)"]);
      expect(t.rows.map((r) => r["q (2)"]), name).toEqual([100, 200, 300, 400]);
      expect(t.rows.map((r) => r["q (3)"]), name).toEqual([10, 20, 30, 40]);
      expect(mean(t.rows.map((r) => r["q (2)"]))).toBe(250);
      const calc = await engineValues(doc, "q (2)", "columns_are_cases");
      expect(calc, name).toEqual([100, 200, 300, 400]);
      expect(mean(calc)).toBe(250);
      expect(mean(await engineValues(doc, "q (3)", "columns_are_cases"))).toBe(25);
      expect(await dictionaryNames(doc), name).toEqual(["q", "q (3)", "q (2)"]);
    }
  });

  it("IP1000-F01: distinct text codes stay distinct in preview and categories; a numeric column stays numeric; missing stays missing", async () => {
    const doc = await file("codes.csv", Buffer.from('code,score,answer\n"001",1,Yes\n"001",2,NA\n"1",3,\n"0001",4,No\n"+2",5,Yes\n', "utf-8"));
    const t = await imported(doc);
    expect(t.rows.map((r) => r.code)).toEqual(["001", "001", "1", "0001", "+2"]);
    expect(t.rows.map((r) => r.score)).toEqual([1, 2, 3, 4, 5]);
    expect(t.rows.map((r) => r.answer)).toEqual(["Yes", null, null, "No", "Yes"]);
    expect(await categories(doc, "code")).toEqual({ "001": 2, "1": 1, "0001": 1, "+2": 1 });
    const { loadVariableDictionary } = await import("../crosstabs");
    const vars = (await loadVariableDictionary(tenant, run, doc)).variables;
    expect(vars.find((v) => v.name === "code")?.numeric).toBe(false);
    expect(vars.find((v) => v.name === "score")?.numeric).toBe(true);
    // A flipped file: the identifier row keeps its literal codes.
    const wide = await file("codes-wide.csv", Buffer.from("Variable,C1,C2,C3\nrespondent_id,001,1,0001\nscore,7,8,9\n", "utf-8"), "columns_are_cases");
    const w = await imported(wide);
    expect(w.rows.map((r) => r.respondent_id)).toEqual(["001", "1", "0001"]);
    expect(w.rows.map((r) => r.score)).toEqual([7, 8, 9]);
  });

  it("IP1000-F02: date-formatted Excel cells are calendar dates in preview and categories, in both layouts; CSV date text stays as written", async () => {
    // Serial numbers and the calendar dates they mean in Excel's 1900 date system, written out here.
    const serials = [61, 25569, 36526, 45292, 36585, 18429];
    const dates = ["1900-03-01", "1970-01-01", "2000-01-01", "2024-01-01", "2000-02-29", "1950-06-15"];
    const longDoc = await file("dates.xlsx", xlsx([["Observation date", "n"], ...serials.map((s, i) => [{ date: s }, i + 1])]));
    const t = await imported(longDoc);
    expect(t.rows.map((r) => r["Observation date"])).toEqual(dates);
    expect(t.provenance).toMatchObject({ dateColumns: ["Observation date"], encoding: null });
    expect(await categories(longDoc, "Observation date")).toEqual(Object.fromEntries(dates.map((d) => [d, 1])));
    const wideDoc = await file("dates-wide.xlsx", xlsx([["Variable", "C1", "C2"], ["Observation date", { date: 61 }, { date: 45292 }], ["n", 1, 2]]), "columns_are_cases");
    const w = await imported(wideDoc);
    expect(w.rows.map((r) => r["Observation date"])).toEqual(["1900-03-01", "2024-01-01"]);
    expect(w.provenance).toMatchObject({ dateColumns: ["Observation date"] });
    // A numeric column of plain serial-valued numbers (no date format) stays numeric.
    const plain = await imported(await file("serials.xlsx", xlsx([["serial"], [61], [25569]])));
    expect(plain.rows.map((r) => r.serial)).toEqual([61, 25569]);
    const csv = await imported(await file("dates.csv", Buffer.from("Observation date,n\n2024-01-01,1\n1950-06-15,2\n", "utf-8")));
    expect(csv.rows.map((r) => r["Observation date"])).toEqual(["2024-01-01", "1950-06-15"]);
  });

  it("IP1000-F03: UTF-8 without a BOM keeps every code point for each delimiter; BOM control; Windows-1252 is reported; other bytes are refused", async () => {
    const values = ["Café", "naïve", "é", "日本語", "😀", "line one\nline two"];
    const quote = (v: string) => (/[\n,;\t"]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    for (const sep of [",", ";", "\t"]) {
      const body = `name${sep}n\n${values.map((v, i) => `${quote(v)}${sep}${i + 1}`).join("\n")}\n`;
      const t = await imported(await file(`utf8-${sep === "\t" ? "tab" : sep === ";" ? "semi" : "comma"}.csv`, Buffer.from(body, "utf-8")));
      expect(t.rows.map((r) => r.name), JSON.stringify(sep)).toEqual(values);
      expect(t.rows.map((r) => [...String(r.name)].map((c) => c.codePointAt(0)))).toEqual(values.map((v) => [...v].map((c) => c.codePointAt(0))));
      expect(t.provenance).toMatchObject({ encoding: "utf-8" });
    }
    const bom = await imported(await file("bom.csv", Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("name,n\nCafé,1\n", "utf-8")])));
    expect(bom.headers).toEqual(["name", "n"]);
    expect(bom.rows[0].name).toBe("Café");
    const legacy = await imported(await file("legacy.csv", Buffer.from([...Buffer.from("name,n\nCaf"), 0xe9, ...Buffer.from(",1\n")])));
    expect(legacy.rows[0].name).toBe("Café");
    expect(legacy.provenance).toMatchObject({ encoding: "windows-1252" });
    const bad = await file("bad.csv", Buffer.from([...Buffer.from("name,n\n"), 0x81, 0x8d, ...Buffer.from(",1\n")]));
    const { extractAndStoreDocumentTables } = await import("../documentTables");
    await expect(extractAndStoreDocumentTables(tenant, run, bad)).rejects.toThrow(/neither UTF-8 nor Windows-1252/);
    expect(await q("select id from document_tables where document_id = $1", [bad])).toEqual([]);
  });

  it("IP1000-F04: an unterminated quoted field is refused before publication and by the calculation; a failed re-read keeps the earlier table; a valid replacement recovers", async () => {
    const malformed = Buffer.from('a,b\n1,"unterminated\n2,3\n', "utf-8");
    const { extractAndStoreDocumentTables } = await import("../documentTables");
    const doc = await file("malformed.csv", malformed);
    await expect(extractAndStoreDocumentTables(tenant, run, doc)).rejects.toThrow(/closing quotation mark.*Nothing was imported/);
    expect(await q("select id from document_tables where document_id = $1", [doc])).toEqual([]);
    const { loadVariableDictionary } = await import("../crosstabs");
    await expect(loadVariableDictionary(tenant, run, doc)).rejects.toThrow(/closing quotation mark/);
    // Valid quoting is read as written: line breaks inside quotes, doubled quotes, empty cells.
    const good = await file("good.csv", Buffer.from('a,b,c\n1,"two\nlines","say ""hi"""\n2,,x\n', "utf-8"));
    const g = await imported(good);
    expect(g.rows).toEqual([{ a: 1, b: "two\nlines", c: 'say "hi"' }, { a: 2, b: null, c: "x" }]);
    // A re-read that fails (the stored file replaced by malformed bytes) keeps the earlier table.
    const path = `${tenant}/${run}/${randomUUID()}-broken.csv`;
    storage.objects.set(path, malformed);
    await q("update documents set storage_path = $2 where id = $1", [good, path]);
    await expect(extractAndStoreDocumentTables(tenant, run, good)).rejects.toThrow(/closing quotation mark/);
    expect((await q("select rows from document_tables where document_id = $1", [good]))[0].rows).toEqual(g.rows);
    // A row with more values than the header is refused with its line.
    await expect(extractAndStoreDocumentTables(tenant, run, await file("ragged.csv", Buffer.from("a,b\n1,2,3\n", "utf-8")))).rejects.toThrow(/Line 2 .* 3 values/);
  });

  it("TP500-F03: a correction of a variable named __proto__ is stored, reloads, combines, survives a simultaneous save, clears, and leaves another variable alone", async () => {
    const doc = await file("proto.csv", Buffer.from("__proto__,Age\n1,30\n2,40\n3,50\n", "utf-8"));
    await imported(doc);
    const { saveVariableOverride, loadVariableOverrides } = await import("../variableOverrides");
    const stored = async () => (await q("select variable_overrides from documents where id = $1", [doc]))[0].variable_overrides;
    await saveVariableOverride(tenant, run, doc, "Age", { type: "continuous" });
    // First correction of __proto__: an own entry in the database and after a reload.
    await saveVariableOverride(tenant, run, doc, "__proto__", { type: "categorical" });
    expect((await q("select variable_overrides ? '__proto__' as has from documents where id = $1", [doc]))[0].has).toBe(true);
    let loaded = await loadVariableOverrides(tenant, run, doc);
    expect(Object.hasOwn(loaded, "__proto__")).toBe(true);
    expect(Object.getOwnPropertyDescriptor(loaded, "__proto__")?.value).toEqual({ type: "categorical" });
    // A second field combines with the first.
    await saveVariableOverride(tenant, run, doc, "__proto__", { questionType: "single" });
    expect((await stored())["__proto__"]).toEqual({ type: "categorical", questionType: "single" });
    // Two saves of different fields at once: both kept (the row lock serializes them).
    await saveVariableOverride(tenant, run, doc, "__proto__", { type: null, questionType: null });
    await Promise.all([
      saveVariableOverride(tenant, run, doc, "__proto__", { type: "discrete" }),
      saveVariableOverride(tenant, run, doc, "__proto__", { questionType: "single" }),
    ]);
    expect((await stored())["__proto__"]).toEqual({ type: "discrete", questionType: "single" });
    // Clearing one field, then the other, removes the entry; the unrelated control is unchanged.
    await saveVariableOverride(tenant, run, doc, "__proto__", { type: null });
    expect((await stored())["__proto__"]).toEqual({ questionType: "single" });
    await saveVariableOverride(tenant, run, doc, "__proto__", { questionType: null });
    loaded = await loadVariableOverrides(tenant, run, doc);
    expect(Object.hasOwn(loaded, "__proto__")).toBe(false);
    expect(await stored()).toEqual({ Age: { type: "continuous" } });
  });

  it("CAL-R1-F03: an Excel column holding both logical values and 1/0 keeps them apart, in .xlsx and .xls and both layouts", async () => {
    // Case by case: TRUE, 1, FALSE, 0, 2. pandas' DataFrame step used to turn the 1 into TRUE (or the
    // TRUE into 1), so a category's count moved to another answer.
    const mixed: Cell[] = [true, 1, false, 0, 2];
    for (const bookType of ["xlsx", "biff8"] as const) {
      const ext = bookType === "xlsx" ? "xlsx" : "xls";
      const rows = await file(`mixed-${ext}.${ext}`, xlsx([["id", "flag"], ...mixed.map((v, i) => [i + 1, v])], bookType));
      const preview = await imported(rows);
      // Logical cells beside numbers are their Excel text; the numbers stay numbers.
      expect(preview.rows.map((r) => r.flag), ext).toEqual(["TRUE", 1, "FALSE", 0, 2]);
      const counts = await categories(rows, "flag");
      expect(counts, `${ext}: each answer counted once`).toEqual({ TRUE: 1, "1": 1, FALSE: 1, "0": 1, "2": 1 });
      // Columns as cases: the same values along one row.
      const flipped = await file(`mixed-flipped-${ext}.${ext}`, xlsx([["Variable", ...mixed.map((_, i) => `C${i + 1}`)], ["flag", ...mixed]], bookType), "columns_are_cases");
      const fc = await categories(flipped, "flag");
      expect(fc, `${ext} flipped`).toEqual({ TRUE: 1, "1": 1, FALSE: 1, "0": 1, "2": 1 });
    }
    // Boundary: a variable of logical cells only keeps them as logical values, counted as before.
    {
      const only = await file("logical-only.xlsx", xlsx([["id", "flag"], [1, true], [2, false], [3, true]]));
      expect((await imported(only)).rows.map((r) => r.flag)).toEqual([true, false, true]);
      expect(Object.values(await categories(only, "flag")).sort()).toEqual([1, 2]);
    }
  });
});
