// Decision 9, second part (Grant, 29 October 2026): the researcher chooses the header row of a CSV, TSV or Excel data
// file on the Import screen, and every reader of the file then uses it. Real disposable database and the actual
// engine; only file storage is mocked (an in-memory bucket), as in oneReaderImport.db.test.ts. Covers:
//   - the repro: a preamble holding a two-value line is misread by detection (refused), and the chosen header row
//     reads it, the rows above it named as title rows, through the save action, the stored table and the dictionary;
//   - acceptance: the screen's save rule and the rebase over a concurrent acceptance both store accepted = false;
//   - the dictionary cache: a dictionary cached under one header choice is not reused under another;
//   - the stored preview: a table read under another header choice is not the current read;
//   - refusals: an invalid value and a header row on an SPSS file are refused with nothing written; a header row past
//     the end of the file fails the read and keeps the earlier stored table.
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

function xlsx(aoa: (string | number | null)[][]): Buffer {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Data");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

// Detection sets aside rows holding at most one value; "Prepared by,Acme Research" holds two, so detection takes it for
// the header and the next lines, with three values, are refused. The researcher's header row is row 4.
const PREAMBLE_CSV = Buffer.from("Brand survey 2026\nPrepared by,Acme Research\nNote: weighted\nid,brand,score\n1,1,5\n2,2,6\n3,1,4\n", "utf-8");

describe.skipIf(!TEST_DATABASE_URL || !PYTHON_OK)("the header row chosen on Import (real database, actual engine)", () => {
  let db: DisposableDb;
  const tenant = randomUUID();
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

  async function file(name: string, bytes: Buffer, setup: Record<string, unknown> = {}) {
    const path = `${tenant}/${run}/${randomUUID()}-${name}`;
    storage.objects.set(path, bytes);
    return (await q(
      `insert into documents (tenant_id, run_id, kind, ingestion_type, source_filename, storage_path, data_setup)
       values ($1, $2, 'table', 'raw', $3, $4, $5) returning id`,
      [tenant, run, name, path, JSON.stringify({ layout: "rows_are_cases", unit: "respondents", method: "survey", accepted: true, ...setup })],
    ))[0].id as string;
  }
  const storedSetup = async (doc: string) => (await q("select data_setup from documents where id = $1", [doc]))[0].data_setup;
  const storedTable = async (doc: string) => (await q("select headers, rows, read_provenance from document_tables where document_id = $1 and table_index = 0", [doc]))[0];
  const dictionaryNames = async (doc: string) => {
    const { loadVariableDictionary } = await import("../crosstabs");
    return (await loadVariableDictionary(tenant, run, doc)).variables.map((v) => v.name);
  };
  /** The screen's save (TranscriptSetup.tsx DataSetupForm): the structure rule, then the action with its compare-and-swap. */
  async function saveFromScreen(doc: string, change: Partial<import("../dataSetupShared").DataSetup>) {
    const { saveDataSetupAction } = await import("../dataSetupActions");
    const { normaliseDataSetup } = await import("../dataSetupShared");
    const { setupStructureChanged } = await import("../dataSetupRebase");
    const previous = normaliseDataSetup(await storedSetup(doc));
    let next = { ...previous, ...change };
    if (setupStructureChanged(previous, next)) next = { ...next, accepted: false };
    return saveDataSetupAction(run, doc, next, { kind: "value", setup: previous });
  }

  it("the repro: detection misreads a preamble; the chosen header row reads it, names the rows above it, and asks for acceptance again", async () => {
    const { extractAndStoreDocumentTables } = await import("../documentTables");
    const { readDataFileAction } = await import("../dataSetupActions");
    const doc = await file("preamble.csv", PREAMBLE_CSV);
    await expect(extractAndStoreDocumentTables(tenant, run, doc)).rejects.toThrow(/header row has 2 columns/);

    expect(await saveFromScreen(doc, { headerRowsSkipped: 3 })).toEqual({ ok: true });
    expect(await storedSetup(doc)).toMatchObject({ headerRowsSkipped: 3, accepted: false });

    expect(await readDataFileAction(run, doc)).toEqual({ ok: true });
    const t = await storedTable(doc);
    expect(t.headers).toEqual(["id", "brand", "score"]);
    expect(t.rows.map((r: Record<string, unknown>) => r.score)).toEqual([5, 6, 4]);
    expect(t.read_provenance).toMatchObject({ headerRowsSkipped: 3, titleRows: ["Brand survey 2026", "Prepared by Acme Research", "Note: weighted"] });
    // Every reader of the file uses the choice: the dictionary and the categories list.
    expect(await dictionaryNames(doc)).toEqual(["id", "brand", "score"]);
    const { loadCategories } = await import("../crosstabs");
    expect((await loadCategories(tenant, run, doc, "brand")).categories.map((c) => [c.label, c.n])).toEqual([["1", 2], ["2", 1]]);

    // Accepted again by the researcher: the stored setup keeps the header row.
    const { saveDataSetupAction } = await import("../dataSetupActions");
    const { normaliseDataSetup } = await import("../dataSetupShared");
    const current = normaliseDataSetup(await storedSetup(doc));
    expect(await saveDataSetupAction(run, doc, { ...current, accepted: true }, { kind: "value", setup: current })).toEqual({ ok: true });
    expect(await storedSetup(doc)).toMatchObject({ headerRowsSkipped: 3, accepted: true });
  });

  it("a header change that met a concurrent acceptance is saved over it and still asks for acceptance again", async () => {
    const { saveDataSetupAction } = await import("../dataSetupActions");
    const { normaliseDataSetup } = await import("../dataSetupShared");
    const { rebaseSetupEdit } = await import("../dataSetupRebase");
    const doc = await file("race.csv", PREAMBLE_CSV, { accepted: false });
    const seen = normaliseDataSetup(await storedSetup(doc));
    // Another tab accepts the file between the screen's read and its save.
    expect(await saveDataSetupAction(run, doc, { ...seen, accepted: true }, { kind: "value", setup: seen })).toEqual({ ok: true });
    const edit = { ...seen, headerRowsSkipped: 3 };
    const first = await saveDataSetupAction(run, doc, edit, { kind: "value", setup: seen });
    expect(first).toMatchObject({ ok: false, conflict: true, current: { accepted: true, headerRowsSkipped: null } });
    const current = (first as { current: import("../dataSetupShared").DataSetup }).current;
    const rebased = rebaseSetupEdit(seen, edit, current);
    expect(rebased).toMatchObject({ headerRowsSkipped: 3, accepted: false });
    expect(await saveDataSetupAction(run, doc, rebased!, { kind: "value", setup: current })).toEqual({ ok: true });
    expect(await storedSetup(doc)).toMatchObject({ headerRowsSkipped: 3, accepted: false });
  });

  it("a dictionary cached under one header choice is not reused under another, and is reused under the same one", async () => {
    // An Excel sheet with a one-cell title: detected, the header is row 2; chosen as row 1, the title names the first variable.
    const doc = await file("titled.xlsx", xlsx([["Brand health tracker"], ["id", "brand", "score"], [1, 1, 5], [2, 2, 6]]));
    expect(await dictionaryNames(doc)).toEqual(["id", "brand", "score"]);
    const cached = async () => (await q("select variable_dictionary from documents where id = $1", [doc]))[0].variable_dictionary;
    expect((await cached()).headerRowsSkipped).toBeNull();
    // Marked, so a reuse of the cache shows: the same choice reuses it.
    await q(`update documents set variable_dictionary = jsonb_set(variable_dictionary, '{variables,0,label}', '"cached label"') where id = $1`, [doc]);
    const { loadVariableDictionary } = await import("../crosstabs");
    expect((await loadVariableDictionary(tenant, run, doc)).variables[0].label).toBe("cached label");

    expect(await saveFromScreen(doc, { headerRowsSkipped: 0 })).toEqual({ ok: true });
    const names = await dictionaryNames(doc);
    expect(names[0]).toBe("Brand health tracker");
    expect(names).not.toContain("score");
    expect((await cached()).headerRowsSkipped).toBe(0);

    // Back to detection: the dictionary cached under row 1 is not reused either.
    expect(await saveFromScreen(doc, { headerRowsSkipped: null })).toEqual({ ok: true });
    expect(await dictionaryNames(doc)).toEqual(["id", "brand", "score"]);
    expect((await cached()).headerRowsSkipped).toBeNull();
  });

  it("a stored table read under another header choice is not shown as the current read", async () => {
    const { extractAndStoreDocumentTables } = await import("../documentTables");
    const { loadImportPreviewIdentities } = await import("../importPreviewIdentity");
    const doc = await file("identity.csv", PREAMBLE_CSV, { headerRowsSkipped: 3 });
    await extractAndStoreDocumentTables(tenant, run, doc);
    const stored = async () => (await q(
      `select document_id, table_index, headers, rows, jsonb_array_length(rows)::int as row_count, read_provenance from document_tables where document_id = $1`,
      [doc],
    ));
    expect((await loadImportPreviewIdentities(tenant, run, await stored())).get(doc)).toEqual({ error: null });
    // The setting changed back to detection without the file being read again: the stored table is checked against a
    // fresh read under detection, which refuses this file, so the table is withheld with the recovery.
    await q("update documents set data_setup = data_setup || '{\"headerRowsSkipped\": null}'::jsonb where id = $1", [doc]);
    const identity = (await loadImportPreviewIdentities(tenant, run, await stored())).get(doc);
    expect(identity?.error).toMatch(/Stored preview cannot be verified[\s\S]*header row has 2 columns/);
  });

  it("refusals: an invalid value and a header row on an SPSS file are not written; a row past the end keeps the earlier table", async () => {
    const { saveDataSetupAction } = await import("../dataSetupActions");
    const { normaliseDataSetup } = await import("../dataSetupShared");
    const { extractAndStoreDocumentTables } = await import("../documentTables");

    const csv = await file("bounds.csv", PREAMBLE_CSV, { headerRowsSkipped: 3 });
    const before = await storedSetup(csv);
    const r = await saveDataSetupAction(run, csv, { ...normaliseDataSetup(before), headerRowsSkipped: -1 });
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/header row must be a row from 1 to 15/) });
    expect(await storedSetup(csv)).toEqual(before);

    const sav = await file("wave.sav", Buffer.from("not read"));
    const savBefore = await storedSetup(sav);
    expect(await saveDataSetupAction(run, sav, { ...normaliseDataSetup(savBefore), headerRowsSkipped: 1 })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/Only CSV, TSV, text and Excel files have a header row/),
    });
    expect(await storedSetup(sav)).toEqual(savBefore);

    // A row past the end of the file: the read fails with how many rows the file has, and the table read before stays.
    await extractAndStoreDocumentTables(tenant, run, csv);
    const earlier = await storedTable(csv);
    expect(await saveFromScreen(csv, { headerRowsSkipped: 9 })).toEqual({ ok: true });
    await expect(extractAndStoreDocumentTables(tenant, run, csv)).rejects.toThrow(/header row is set to row 10, but this file has only 7 row/);
    expect(await storedTable(csv)).toEqual(earlier);
  });
});
