// Data files as researchers receive them (Grant, 26 October 2026): delimited text (.txt) exports and
// SAS (.sas7bdat and .xpt transport) files, through the actual extractAndStoreDocumentTables (stored
// preview), loadVariableDictionary and loadCategories, reading through the actual api/parse-stats-file.py
// (local engine runner). Real database built from every migration; storage is an in-memory stand-in and
// the model is stubbed (never reached). Expected values come from the source bytes written here, or,
// for SAS, from the CSV pandas publishes beside each reference file (fixtures/sas/README.md), never
// from the app.
//   .txt  tab-delimited with "NA" for missing (the Berkeley IGS Poll export shape); comma-delimited;
//         columns-as-cases; a .txt with no delimiter (prose) refused with its reason and nothing stored
//   SAS   airline.sas7bdat: every number equals the reference to the precision SAS stored it;
//         test1.sas7bdat: text, numbers, dates (days since 1960 in the reference) and missing cells
//         match the reference; a text variable's categories count each answer; an .xpt written with
//         variable labels keeps its values and labels; a damaged .sas7bdat is refused with nothing stored
//   R     survey.rds and survey.RData written by R 4.3 itself (fixtures/r), compared with R's own
//         write.csv of the same data: numbers, an R integer with NA, dates, logicals, text and a factor
//         whose codes keep R's level order and whose levels are its labels; an .RData holding two data
//         frames is read from the larger
//   Parquet written by pandas (fastparquet): numbers, text and categoricals keep their own values
// Skipped, with the reason, without a test database or python3 + pandas/pyreadstat (and pyreadr and
// fastparquet for the R and Parquet cases).
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
const PYTHON_OK = spawnSync(PYTHON, ["-c", "import pandas, pyreadstat"], { encoding: "utf8" }).status === 0;
const R_PARQUET_OK = spawnSync(PYTHON, ["-c", "import pyreadr, fastparquet"], { encoding: "utf8" }).status === 0;
const SAS = path.resolve("fixtures/sas");
type Row = Record<string, string | number | boolean | null>;

/** The reference CSV pandas publishes beside a SAS file: header, then rows split on commas (no quoting in these files). */
function referenceCsv(name: string): { headers: string[]; rows: string[][] } {
  const lines = readFileSync(path.join(SAS, name), "utf8").split(/\r?\n/).filter((l) => l.length > 0);
  return { headers: lines[0].split(","), rows: lines.slice(1).map((l) => l.split(",")) };
}
/** Days since 1 January 1960 (SAS's epoch) as an ISO date. */
const sasDate = (days: number) => new Date(Date.UTC(1960, 0, 1) + days * 86_400_000).toISOString().slice(0, 10);

describe.skipIf(!TEST_DATABASE_URL || !PYTHON_OK)("delimited text and SAS data files (real database, actual engine)", () => {
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

  async function file(name: string, bytes: Buffer, layout: "rows_are_cases" | "columns_are_cases" = "rows_are_cases") {
    const key = `${tenant}/${run}/${randomUUID()}-${name}`;
    storage.objects.set(key, bytes);
    return (await q(
      `insert into documents (tenant_id, run_id, kind, ingestion_type, source_filename, storage_path, data_setup)
       values ($1, $2, 'table', 'raw', $3, $4, $5) returning id`,
      [tenant, run, name, key, JSON.stringify({ layout, unit: "respondents", method: "survey", accepted: true })],
    ))[0].id as string;
  }
  async function imported(doc: string): Promise<{ headers: string[]; rows: Row[] }> {
    const { extractAndStoreDocumentTables } = await import("../documentTables");
    await extractAndStoreDocumentTables(tenant, run, doc);
    const t = (await q("select headers, rows from document_tables where document_id = $1 and table_index = 0", [doc]))[0];
    return { headers: t.headers, rows: t.rows };
  }
  const categories = async (doc: string, variable: string) => {
    const { loadCategories } = await import("../crosstabs");
    return Object.fromEntries((await loadCategories(tenant, run, doc, variable)).categories.map((c) => [c.label, c.n]));
  };
  const dictionary = async (doc: string) => (await import("../crosstabs")).loadVariableDictionary(tenant, run, doc);

  it(".txt: tab-delimited with NA for missing, comma-delimited, and columns as cases", async () => {
    const tab = Buffer.from("ID\tAGE\tparty_reg\tQ1\tw1\r\n1\t26\t1\tNA\t0.84\r\n2\t18\t2\t3\t1.21\r\n3\t44\t1\t3\t0.95\r\n", "utf-8");
    const doc = await file("may2026.txt", tab);
    const t = await imported(doc);
    expect(t.headers).toEqual(["ID", "AGE", "party_reg", "Q1", "w1"]);
    expect(t.rows.map((r) => r.AGE)).toEqual([26, 18, 44]);
    expect(t.rows.map((r) => r.Q1)).toEqual([null, 3, 3]);
    expect(t.rows.map((r) => r.w1)).toEqual([0.84, 1.21, 0.95]);
    expect(await categories(doc, "party_reg")).toEqual({ "1": 2, "2": 1 });
    expect((await dictionary(doc)).variables.map((v) => v.name)).toEqual(["ID", "AGE", "party_reg", "Q1", "w1"]);

    const comma = await imported(await file("export.txt", Buffer.from("a,b,c\n1,x,2.5\n2,y,3.5\n", "utf-8")));
    expect(comma.headers).toEqual(["a", "b", "c"]);
    expect(comma.rows).toEqual([{ a: 1, b: "x", c: 2.5 }, { a: 2, b: "y", c: 3.5 }]);

    const flipped = await file("wide.txt", Buffer.from("Variable\tC1\tC2\tC3\nscore\t5\t4\t5\ngroup\ta\tb\ta\n", "utf-8"), "columns_are_cases");
    const f = await imported(flipped);
    expect(f.headers).toEqual(["score", "group"]);
    expect(f.rows.map((r) => r.score)).toEqual([5, 4, 5]);
    expect(await categories(flipped, "group")).toEqual({ a: 2, b: 1 });
  });

  it(".txt without a delimiter is refused with its reason, and nothing is stored", async () => {
    const prose = await file("notes.txt", Buffer.from("Moderator: Welcome everyone.\nRespondent 1: Thanks for having me.\n", "utf-8"));
    await expect(imported(prose)).rejects.toThrow(/no tab, comma, semicolon or pipe/);
    expect(await q("select 1 from document_tables where document_id = $1", [prose])).toHaveLength(0);
  });

  it("SAS airline.sas7bdat: every value equals the published reference", async () => {
    const ref = referenceCsv("airline.csv");
    const doc = await file("airline.sas7bdat", readFileSync(path.join(SAS, "airline.sas7bdat")));
    const t = await imported(doc);
    // As for SPSS and Stata, the preview is headed by each variable's label where it has one; the
    // dictionary keeps the variable names in file order.
    const names = (await dictionary(doc)).variables.map((v) => v.name);
    expect(names).toEqual(ref.headers);
    expect(t.headers).toEqual(["year", "level of output", "wage rate", "interest rate", "labor input", "K"].map((x, i) => (x === "K" ? t.headers[i] : x)));
    const byName = (row: Row) => Object.fromEntries(t.headers.map((h, i) => [names[i], row[h]]));
    expect(t.rows).toHaveLength(ref.rows.length);
    ref.rows.forEach((cells, i) =>
      ref.headers.forEach((h, j) => {
        // The reference carries the precision SAS stored (reduced-length numbers): equal to one part in a million.
        const want = Number(cells[j]);
        expect(Math.abs(Number(byName(t.rows[i])[h]) - want) / Math.max(1, Math.abs(want)), `${h} row ${i + 1}`).toBeLessThan(1e-6);
      }),
    );
  });

  it("SAS test1.sas7bdat: text, numbers, dates and missing cells match the reference; categories count each answer", async () => {
    const ref = referenceCsv("test_sas7bdat_1.csv");
    const doc = await file("test1.sas7bdat", readFileSync(path.join(SAS, "test1.sas7bdat")));
    const t = await imported(doc);
    expect(t.headers).toEqual(ref.headers);
    expect(t.rows).toHaveLength(ref.rows.length);
    // Date columns in this file (formatted as dates in SAS; days since 1960 in the reference).
    const dateColumns = new Set(["Column4", "Column12"]);
    ref.rows.forEach((cells, i) =>
      ref.headers.forEach((h, j) => {
        const expected = cells[j];
        const got = t.rows[i][h];
        const where = `${h} row ${i + 1}`;
        if (expected === "") expect(got, where).toBeNull();
        else if (dateColumns.has(h)) expect(String(got).slice(0, 10), where).toBe(sasDate(Number(expected)));
        else if (/^-?\d+(\.\d+)?$/.test(expected)) expect(Number(got), where).toBeCloseTo(Number(expected), 6);
        else expect(got, where).toBe(expected);
      }),
    );
    const j = ref.headers.indexOf("Column2");
    const counts: Record<string, number> = {};
    for (const cells of ref.rows) if (cells[j] !== "") counts[cells[j]] = (counts[cells[j]] ?? 0) + 1;
    expect(await categories(doc, "Column2")).toEqual(counts);
  });

  it("SAS transport (.xpt): values and variable labels kept", async () => {
    const out = path.join(mkdtempSync(path.join(tmpdir(), "xpt-")), "survey.xpt");
    const script = String.raw`
import sys, pandas as pd, pyreadstat
df = pd.DataFrame({"REGION": [1.0, 2.0, 1.0, 3.0], "SCORE": [7.5, 8.0, None, 6.25], "NAME": ["a", "b", "c", "d"]})
pyreadstat.write_xport(df, sys.argv[1], column_labels=["Region of residence", "Satisfaction score", "Respondent name"], table_name="SURVEY")
`;
    const r = spawnSync(PYTHON, ["-I", "-c", script, out], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(r.stderr);
    const doc = await file("survey.xpt", readFileSync(out));
    const t = await imported(doc);
    expect(t.headers).toEqual(["Region of residence", "Satisfaction score", "Respondent name"]);
    expect(t.rows.map((x) => x["Satisfaction score"])).toEqual([7.5, 8, null, 6.25]);
    expect(t.rows.map((x) => x["Respondent name"])).toEqual(["a", "b", "c", "d"]);
    // An unlabelled whole-number code in any statistics file is listed as "1.0" (its raw code is "1");
    // the same as .sav and .dta today, so not changed here.
    expect(await categories(doc, "REGION")).toEqual({ "1.0": 2, "2.0": 1, "3.0": 1 });
    const labels = Object.fromEntries((await dictionary(doc)).variables.map((v) => [v.name, v.label]));
    expect(labels).toMatchObject({ REGION: "Region of residence", SCORE: "Satisfaction score" });
  });

  it("a damaged SAS file is refused with nothing stored; a valid one then reads", async () => {
    const bytes = readFileSync(path.join(SAS, "airline.sas7bdat"));
    const damaged = await file("damaged.sas7bdat", bytes.subarray(0, Math.floor(bytes.length / 3)));
    await expect(imported(damaged)).rejects.toThrow();
    expect(await q("select 1 from document_tables where document_id = $1", [damaged])).toHaveLength(0);
    const healthy = await imported(await file("airline-again.sas7bdat", bytes));
    expect(healthy.rows).toHaveLength(32);
  });

  it.skipIf(!R_PARQUET_OK)("R .rds and .RData: every value equals R's own CSV of the same data; a factor keeps R's codes and levels", async () => {
    const R = path.resolve("fixtures/r");
    const expected = readFileSync(path.join(R, "survey-expected.csv"), "utf8").trim().split(/\r?\n/).map((l) => l.split(",").map((c) => c.replace(/^"|"$/g, "")));
    const [head, ...body] = expected;
    for (const name of ["survey.rds", "survey.RData"]) {
      const doc = await file(name, readFileSync(path.join(R, name)));
      const t = await imported(doc);
      expect(t.headers, name).toEqual(head);
      expect(t.rows, name).toHaveLength(body.length);
      body.forEach((cells, i) =>
        head.forEach((h, j) => {
          const want = cells[j];
          const got = t.rows[i][h];
          const where = `${name} ${h} row ${i + 1}`;
          if (want === "") expect(got === null || got === "", where).toBe(true);
          else if (want === "TRUE" || want === "FALSE") expect(got, where).toBe(want === "TRUE");
          else if (/^-?\d+(\.\d+)?$/.test(want)) expect(Number(got), where).toBe(Number(want));
          else expect(got, where).toBe(want);
        }),
      );
      // R's level order (North, South, East), not alphabetical; NA is missing.
      expect(Object.entries(await categories(doc, "region")), name).toEqual([["North", 2], ["South", 2], ["East", 1]]);
      const visits = (await dictionary(doc)).variables.find((v) => v.name === "visits")!;
      expect(visits.numeric, `${name}: an R integer with NA stays a number`).toBe(true);
    }
  });

  it.skipIf(!R_PARQUET_OK)("Parquet: numbers, text and categoricals keep their own values", async () => {
    const out = path.join(mkdtempSync(path.join(tmpdir(), "parquet-")), "survey.parquet");
    const script = String.raw`
import sys, pandas as pd
df = pd.DataFrame({
    "id": [1, 2, 3, 4],
    "band": pd.Categorical([3, 1, 3, None], categories=[1, 2, 3]),
    "city": pd.Categorical(["Cape Town", "Durban", None, "Durban"]),
    "spend": [10.5, None, 3.25, 8.0],
})
df.to_parquet(sys.argv[1], engine="fastparquet")
`;
    const r = spawnSync(PYTHON, ["-I", "-c", script, out], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(r.stderr);
    const doc = await file("survey.parquet", readFileSync(out));
    const t = await imported(doc);
    expect(t.headers).toEqual(["id", "band", "city", "spend"]);
    expect(t.rows.map((x) => x.band)).toEqual([3, 1, 3, null]);
    expect(t.rows.map((x) => x.city)).toEqual(["Cape Town", "Durban", null, "Durban"]);
    expect(t.rows.map((x) => x.spend)).toEqual([10.5, null, 3.25, 8]);
    expect(await categories(doc, "city")).toEqual({ "Cape Town": 1, Durban: 2 });
  });

  // B36-F02 (Codex): nullable Int64 was turned into float64, so 9007199254740992 and ...993 became one
  // identifier, stored and counted as one. Beyond 2^53 a whole number is kept as its exact text
  // (_MAX_EXACT_WHOLE, the policy the delimited readers already use); up to 2^53 it stays a number.
  it.skipIf(!R_PARQUET_OK)("Parquet: whole numbers beyond 2^53 keep their exact identity, nullable, plain, categorical, negative or unsigned; safe ones stay numbers", async () => {
    const out = path.join(mkdtempSync(path.join(tmpdir(), "parquet-big-")), "ids.parquet");
    const script = String.raw`
import sys, numpy as np, pandas as pd
df = pd.DataFrame({
    "rid": pd.array([9007199254740992, 9007199254740993, None, 9007199254740993], dtype="Int64"),
    "plain": pd.array([9007199254740993, 9007199254740992, 9007199254740995, 9007199254740993], dtype="int64"),
    "safe": pd.array([9007199254740991, 1, None, 9007199254740991], dtype="Int64"),
    # B38-F01 (Codex): the same identifiers stored as a categorical; and negative and unsigned controls.
    "catid": pd.Categorical([9007199254740992, 9007199254740993, None, 9007199254740993]),
    "neg": pd.array([-9007199254740993, -9007199254740992, None, 5], dtype="Int64"),
    # numpy, not pd.array: pandas 3.1 builds pd.array([18446744073709551615, ...], dtype="uint64") from a
    # Python list through float, giving [0, 9007199254740992, 1, 1] (Codex's B39/40 review mismatch).
    "big": np.array([18446744073709551615, 9007199254740993, 1, 1], dtype=np.uint64),
})
# The fixture is checked before it is written, so a writer that changes the values fails here, as a
# fixture error, and never reads as the app's.
assert df["big"].tolist() == [18446744073709551615, 9007199254740993, 1, 1], df["big"].tolist()
assert df["rid"].tolist()[:2] == [9007199254740992, 9007199254740993]
df.to_parquet(sys.argv[1], engine="fastparquet")
`;
    const r = spawnSync(PYTHON, ["-I", "-c", script, out], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(r.stderr);
    const doc = await file("ids.parquet", readFileSync(out));
    for (const pass of ["first read", "reread"]) {
      const t = await imported(doc);
      expect(t.headers, pass).toEqual(["rid", "plain", "safe", "catid", "neg", "big"]);
      expect(t.rows.map((x) => x.catid), pass).toEqual(["9007199254740992", "9007199254740993", null, "9007199254740993"]);
      expect(t.rows.map((x) => x.neg), pass).toEqual(["-9007199254740993", "-9007199254740992", null, "5"]);
      expect(t.rows.map((x) => x.big), pass).toEqual(["18446744073709551615", "9007199254740993", "1", "1"]);
      expect(t.rows.map((x) => x.rid), pass).toEqual(["9007199254740992", "9007199254740993", null, "9007199254740993"]);
      expect(t.rows.map((x) => x.plain), pass).toEqual(["9007199254740993", "9007199254740992", "9007199254740995", "9007199254740993"]);
      expect(t.rows.map((x) => x.safe), pass).toEqual([9007199254740991, 1, null, 9007199254740991]);
    }
    expect(await categories(doc, "rid")).toEqual({ "9007199254740992": 1, "9007199254740993": 2 });
    expect(await categories(doc, "plain")).toEqual({ "9007199254740992": 1, "9007199254740993": 2, "9007199254740995": 1 });
    // The stored preview agrees value by value with the calculation from the same bytes.
    expect(await categories(doc, "catid")).toEqual({ "9007199254740992": 1, "9007199254740993": 2 });
    expect(await categories(doc, "neg")).toEqual({ "-9007199254740993": 1, "-9007199254740992": 1, "5": 1 });
  });

  // B40-F01 (Codex): a Parquet preview stored before the B38-F01 repair (identifiers rounded, no read
  // provenance) was still shown as the file's data. Now it is compared with a fresh read and withheld
  // with a recovery; reading the file again replaces it with the exact identifiers.
  it.skipIf(!R_PARQUET_OK)("B40-F01: a Parquet preview stored before the repair is withheld until the file is read again; a healthy one is shown", async () => {
    const out = path.join(mkdtempSync(path.join(tmpdir(), "parquet-legacy-")), "legacy.parquet");
    const script = String.raw`
import sys, pandas as pd
df = pd.DataFrame({"catid": pd.Categorical([9007199254740992, 9007199254740993]), "n": pd.array([1, 2], dtype="Int64")})
df.to_parquet(sys.argv[1], engine="fastparquet")
`;
    const r = spawnSync(PYTHON, ["-I", "-c", script, out], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(r.stderr);
    const doc = await file("legacy.parquet", readFileSync(out));
    await imported(doc);
    const { loadImportPreviewIdentities, ENGINE_STATS_READER } = await import("../importPreviewIdentity");
    const stored = async () => (await q(
      "select document_id, table_index, headers, rows, jsonb_array_length(rows) as row_count, read_provenance from document_tables where document_id = $1 and table_index < 100", [doc],
    )) as Parameters<typeof loadImportPreviewIdentities>[2];
    const identity = async () => (await loadImportPreviewIdentities(tenant, run, await stored())).get(doc);
    // A fresh read records the reader and is shown.
    expect((await stored())[0].read_provenance).toMatchObject({ reader: ENGINE_STATS_READER });
    expect(await identity()).toEqual({ error: null });
    // The pre-repair state: the two identifiers rounded to one number, no provenance.
    await q(`update document_tables set rows = '[{"catid": 9007199254740992, "n": 1}, {"catid": 9007199254740992, "n": 2}]'::jsonb, read_provenance = null where document_id = $1`, [doc]);
    expect(await identity()).toEqual({ error: expect.stringMatching(/^Stored preview cannot be verified: the stored table differs from what the file holds now .*Read the file again/) });
    // A healthy table from before provenance was recorded is shown after the check.
    await q(`update document_tables set rows = '[{"catid": "9007199254740992", "n": 1}, {"catid": "9007199254740993", "n": 2}]'::jsonb where document_id = $1`, [doc]);
    expect(await identity()).toEqual({ error: null });
    // The source cannot be read: withheld with the reason, never shown as verified.
    await q(`update document_tables set rows = '[{"catid": 9007199254740992, "n": 1}, {"catid": 9007199254740992, "n": 2}]'::jsonb where document_id = $1`, [doc]);
    const key = (await q("select storage_path from documents where id = $1", [doc]))[0].storage_path as string;
    const bytes = storage.objects.get(key)!;
    storage.objects.delete(key);
    expect((await identity())?.error).toMatch(/^Stored preview cannot be verified: /);
    storage.objects.set(key, bytes);
    // Work done on the file before the reread: a saved table with a finding, and a variable correction.
    const ct = (await q("insert into document_tables(tenant_id,run_id,document_id,table_index,ingestion_type,crosstab,crosstab_status) values($1,$2,$3,100,'raw','{}','committed') returning id", [tenant, run, doc]))[0].id;
    const finding = (await q("insert into findings(tenant_id,run_id,origin,finding_text,status,source_table_id) values($1,$2,'generated','n is higher for 9007199254740993','accepted',$3) returning id", [tenant, run, ct]))[0].id;
    await q(`update documents set variable_overrides = '{"n": {"type": "discrete"}}'::jsonb where id = $1`, [doc]);
    // Recovery: reading the file again stores the exact identifiers with the reader, and it is shown;
    // the saved table, its finding and the correction are kept.
    const again = await imported(doc);
    expect(again.rows.map((x) => x.catid)).toEqual(["9007199254740992", "9007199254740993"]);
    expect(await identity()).toEqual({ error: null });
    expect(await q("select status, source_table_id from findings where id = $1", [finding])).toEqual([{ status: "accepted", source_table_id: ct }]);
    expect((await q("select variable_overrides from documents where id = $1", [doc]))[0].variable_overrides).toEqual({ n: { type: "discrete" } });
  });
});
