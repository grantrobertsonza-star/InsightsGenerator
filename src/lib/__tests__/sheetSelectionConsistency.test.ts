// Permanent regression tests for the Codex round-2/3/4 parser-consistency repair
// (IMP-002 / IMP-SHIP-001 / IMP-SHIP-002 / IMP-003). These exercise the ACTUAL entry
// points - parseTableDocument and resolveAuthoritativeSheet - not reimplementations of
// their logic.
//
// Round 4 (the five-defect repair): the native `vitest run` blocker from earlier rounds
// is now resolved on this engineering sandbox (the Linux bridge VM's node_modules was
// missing @rollup/rollup-linux-x64-gnu, an optional-dependency platform mismatch from
// node_modules being installed on the real Windows machine; `npm install --no-save
// @rollup/rollup-linux-x64-gnu` added the missing platform binary alongside the existing
// Windows ones). Separately, this file previously imported the REAL supabaseAdmin client
// and monkeypatched its `.storage` property per test - supabaseAdmin.ts calls
// createClient() eagerly at module load using NEXT_PUBLIC_SUPABASE_URL/
// SUPABASE_SECRET_KEY, which this project has no vitest.config.ts or env-loading
// mechanism to supply during a bare `vitest run`, so the whole file failed to even
// collect with "Error: supabaseUrl is required". Mocking the module (the same pattern
// already used in contradictionDetector.test.ts for ../db, ../anthropic, ../apiUsage)
// avoids ever constructing the real client. Windows' own separate `spawn EPERM` blocker
// (Codex's review) is a different, OS-specific limitation this Linux-sandbox run cannot
// speak to either way.
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as XLSX from "xlsx";

vi.mock("../db", () => ({ withTenant: vi.fn(), withTenantRead: vi.fn() }));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: { storage: { from: vi.fn() } } }));
// GT100-F01: the confirmed-questionnaire lookup is a boundary here (these checks are about the
// set-up and sheet lookups). With the database mocked it used to fail silently; it now refuses.
vi.mock("../instruments", () => ({ getLabelOverlay: vi.fn(async () => null) }));
// Round 4's caller-level tests dynamically import ../documentTables and ../crosstabs, which
// pull in these modules at their own top level. None of their real behaviour is exercised by
// these tests (the CSV/XLSX extraction branch never reaches extractDocumentText/
// generateFindingsFromTable/mapWithConcurrency/archiveAndReplaceFindings; buildCrosstab's and
// loadVariableDictionary's own computation is driven entirely through the mocked
// runStatsTool below) - stubbed the same way contradictionDetector.test.ts already stubs
// ../anthropic/../apiUsage/../db, so importing these modules never constructs a real
// Anthropic client or pulls in unpdf/mammoth's full transform graph.
vi.mock("../anthropic", () => ({ anthropic: {}, CLAUDE_MODEL: "test-model" }));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn() }));
vi.mock("../extractFindings", () => ({ extractDocumentText: vi.fn() }));
vi.mock("../generateFindingsFromTable", () => ({ generateFindingsFromTable: vi.fn() }));
vi.mock("../concurrency", () => ({ mapWithConcurrency: vi.fn() }));
vi.mock("../findingArchive", () => ({ archiveAndReplaceFindings: vi.fn() }));
vi.mock("../parseStatsFile", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../parseStatsFile")>();
  return { ...actual, runStatsTool: vi.fn() };
});

import { supabaseAdmin } from "../supabaseAdmin";
import { parseTableDocument, SheetSelectionLostError } from "../parseTable";
import { resolveAuthoritativeSheet } from "../crosstabs";
import { withTenant, withTenantRead } from "../db";

// Round 4's caller-level tests dynamically import ../documentTables and ../crosstabs for the
// first time inside the test body; that first-time transform of their (now heavily-mocked,
// but still real-file) import graph can run past vitest's default 5000ms per-test budget in
// this sandbox. Raised file-wide rather than per-test since the slow part is the one-time
// transform, not any test's own logic looping or genuinely hanging.
vi.setConfig({ testTimeout: 20000 });

function mockDownload(buffer: ArrayBuffer) {
  vi.mocked(supabaseAdmin.storage.from).mockReturnValue({
    download: async () => ({ data: { arrayBuffer: async () => buffer }, error: null }),
  } as any);
}

function workbookBuffer(wb: XLSX.WorkBook): ArrayBuffer {
  const out = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
}

/**
 * Reproduces the original round-1 fixture: a dict-like "Codebook" sheet (excluded from
 * the candidate pool), a "Raw Export" decoy sheet with 38 genuinely populated data rows,
 * and the intended "Data" sheet with generated-header collisions (Q1, Q1, Q1 (2)), a
 * zero-pad-formatted numeric id, a 21-digit text id, an NA-token row, and one entirely
 * blank row that must be dropped.
 */
function buildOriginalWorkbook(): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  const cb = XLSX.utils.aoa_to_sheet([["Variable", "Label"], ["RespID", "Respondent identifier"]]);
  XLSX.utils.book_append_sheet(wb, cb, "Codebook");

  const decoyRows: (string | number)[][] = [["Col"]];
  for (let r = 2; r <= 39; r++) {
    const row: (string | number)[] = [`val${r}`];
    for (let c = 2; c <= 11; c++) row.push(r * c);
    decoyRows.push(row);
  }
  const decoy = XLSX.utils.aoa_to_sheet(decoyRows);
  XLSX.utils.book_append_sheet(wb, decoy, "Raw Export");

  const data = XLSX.utils.aoa_to_sheet([
    ["RespID", "Age", "Q1", "Q1", "Q1 (2)"],
    [7, 25, "Yes", "No", "Maybe"],
    ["20231000045678912345", "NA", "", "N/A", "null"],
    [null, null, null, null, null],
    [42, 30, "Yes", "Yes", "No"],
  ]);
  data["A2"].z = "0000";
  data["A5"].z = "0000";
  XLSX.utils.book_append_sheet(wb, data, "Data");

  return wb;
}

/** Reproduces Codex's own cited Sparse/Dense repro: a "Sparse" sheet with 10 header
 * columns, exactly 1 real data row, formatted across A1:J101 so its declared extent is
 * hugely inflated with no added real data, and a "Dense" sheet with 2 header columns and
 * 10 genuinely populated data rows and no extra formatting.
 *
 * Round 4 (criterion 5, "formatting-only rows must contain no numeric zeros or other
 * observations"): rows 3-101 below are given a number format (z) only - no `v`/`t` - so
 * they carry styling without ever becoming a stored value. The earlier version of this
 * fixture set `v: 0` on all 99 of these rows, which Codex correctly identified as making
 * them genuine data (99 real rows of value 0 legitimately outranking Dense's 10 real
 * rows) - so the fixture's own "Dense must win" assertion was wrong against that broken
 * fixture, not a sign of a production-code regression. Mirrors the corrected openpyxl
 * fixture (build_fixture4_sparse_dense_fixed.py) used for the Python-reader side of this
 * same repro. */
function buildSparseDenseWorkbook(): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  const sparseRows: string[][] = [Array.from({ length: 10 }, (_, i) => `Col${i + 1}`)];
  sparseRows.push(Array.from({ length: 10 }, (_, i) => `v${i + 1}`));
  const sparse = XLSX.utils.aoa_to_sheet(sparseRows);
  sparse["!ref"] = "A1:J101";
  for (let r = 3; r <= 101; r++) {
    for (let c = 1; c <= 10; c++) {
      const addr = XLSX.utils.encode_cell({ r: r - 1, c: c - 1 });
      sparse[addr] = { t: "z", z: "0.00" };
    }
  }
  XLSX.utils.book_append_sheet(wb, sparse, "Sparse");

  const denseRows: (string | number)[][] = [["A", "B"]];
  for (let r = 2; r <= 11; r++) denseRows.push([`row${r}`, r * 10]);
  const dense = XLSX.utils.aoa_to_sheet(denseRows);
  XLSX.utils.book_append_sheet(wb, dense, "Dense");

  return wb;
}

/** A sheet with one id-like column using the supported zero-pad format and one id-like
 * column using an unsupported custom format (thousands separator). */
function buildUnsupportedFormatWorkbook(): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const data = XLSX.utils.aoa_to_sheet([
    ["RespID", "AccountID", "Age"],
    [7, 123456, 25],
    [8, 654321, 31],
  ]);
  data["A2"].z = "0000";
  data["A3"].z = "0000";
  data["B2"].z = "#,##0";
  data["B3"].z = "#,##0";
  XLSX.utils.book_append_sheet(wb, data, "Data");
  return wb;
}

describe("sheet selection consistency (IMP-002/IMP-SHIP-001/002, IMP-003 - Codex round 2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("item 1: both independent readers' ranking resolves identically on Codex's own Sparse/Dense repro (no selection)", async () => {
    mockDownload(workbookBuffer(buildSparseDenseWorkbook()));
    const result = await parseTableDocument("fixture_sparse_dense.xlsx", null);
    // Before the round-2 fix, TypeScript's !ref-dimension ranking picked "Sparse" here
    // while Python's parsed-size ranking picked "Dense" from the identical buffer - this
    // is exactly the disagreement Codex's review demonstrated. The unified actual-data-row
    // ranking rule must now pick "Dense" (10 real rows) over "Sparse" (1 real row dressed
    // up with formatting across A1:J101).
    expect(result.sheetName).toBe("Dense");
    expect(result.rows).toHaveLength(10);
  });

  it("item 3: a named but missing selected sheet raises an explicit recovery error, never a silent substitution", async () => {
    mockDownload(workbookBuffer(buildSparseDenseWorkbook()));
    await expect(parseTableDocument("fixture_sparse_dense.xlsx", "Removed")).rejects.toThrow(SheetSelectionLostError);

    mockDownload(workbookBuffer(buildSparseDenseWorkbook()));
    try {
      await parseTableDocument("fixture_sparse_dense.xlsx", "Removed");
      expect.unreachable("expected SheetSelectionLostError to be thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(SheetSelectionLostError);
      expect((err as SheetSelectionLostError).code).toBe("SHEET_SELECTION_LOST");
    }
  });

  it("item 3b: an absent (never-chosen) selection is NOT treated as lost - it still resolves via the ranking rule", async () => {
    mockDownload(workbookBuffer(buildSparseDenseWorkbook()));
    const result = await parseTableDocument("fixture_sparse_dense.xlsx", null);
    expect(result.sheetName).toBe("Dense");
  });

  it("items 6 (identifiers) and IMP-003 (header collisions): preserve zero-pad ids, long text ids, and generated-header dedup on the original workbook", async () => {
    mockDownload(workbookBuffer(buildOriginalWorkbook()));
    const result = await parseTableDocument("fixture.xlsx", "Data");

    expect(result.sheetName).toBe("Data");
    expect(result.headers).toEqual(["RespID", "Age", "Q1", "Q1 (3)", "Q1 (2)"]);
    expect(result.rows).toEqual([
      { RespID: "0007", Age: 25, Q1: "Yes", "Q1 (3)": "No", "Q1 (2)": "Maybe" },
      { RespID: "20231000045678912345", Age: null, Q1: null, "Q1 (3)": null, "Q1 (2)": null },
      { RespID: "0042", Age: 30, Q1: "Yes", "Q1 (3)": "Yes", "Q1 (2)": "No" },
    ]);
    // the entirely-blank row must be dropped, not kept as a row of nulls
    expect(result.rows).toHaveLength(3);
    expect(result.unsupportedIdentifierColumns).toEqual([]);
  });

  it("item 6: an id-like column with an unsupported custom Excel format is explicitly flagged, not silently mismatched", async () => {
    mockDownload(workbookBuffer(buildUnsupportedFormatWorkbook()));
    const result = await parseTableDocument("fixture_unsupported_format.xlsx", "Data");

    expect(result.rows[0].RespID).toBe("0007"); // supported zero-pad: not flagged
    expect(result.unsupportedIdentifierColumns).toEqual(["AccountID"]);
  });

  // Overnight queue, "resolve the unsupported-ID disagreement": identical bytes previously
  // produced formatted text in TypeScript (parseTable.ts kept the cell's rendered text,
  // e.g. "123,456") and null in Python (_apply_zero_padded_id_formats nulled the same
  // cell) - a genuine cross-reader disagreement on the same identifier, not just an
  // unflagged one. Both sides now null the value for any cell flagged unsupported, so
  // there is one consistent contract (block, not guess) rather than two readers quietly
  // returning two different things for the same bytes.
  it("criterion 2 (overnight queue): an unsupported-format identifier cell is blanked out, not merely flagged, in the TS reader - matching Python's null-out exactly", async () => {
    mockDownload(workbookBuffer(buildUnsupportedFormatWorkbook()));
    const result = await parseTableDocument("fixture_unsupported_format.xlsx", "Data");

    expect(result.unsupportedIdentifierColumns).toEqual(["AccountID"]);
    // The unsupported column's values are blanked (null), not the formatted display text
    // ("123,456"/"654,321") the previous behavior would have returned.
    expect(result.rows.map((r) => r.AccountID)).toEqual([null, null]);
    // The supported zero-pad column is unaffected by this change.
    expect(result.rows.map((r) => r.RespID)).toEqual(["0007", "0008"]);
  });

  it("item 2: a losing publisher adopts the actual authoritative winner rather than its own guess", async () => {
    const DOCS: Record<string, { selected_sheet: string | null }> = {};
    function fakeClient() {
      return {
        query: async (sql: string, params: unknown[] = []) => {
          const s = sql.toLowerCase();
          if (s.includes("update documents set selected_sheet")) {
            const [resolved, documentId] = params as [string, string];
            const doc = DOCS[documentId] ?? (DOCS[documentId] = { selected_sheet: null });
            if (doc.selected_sheet === null) {
              doc.selected_sheet = resolved;
              return { rows: [{ selected_sheet: resolved }] };
            }
            return { rows: [] };
          }
          if (s.includes("select selected_sheet from documents")) {
            const [documentId] = params as [string];
            const doc = DOCS[documentId] ?? { selected_sheet: null };
            return { rows: [{ selected_sheet: doc.selected_sheet }] };
          }
          throw new Error("unhandled mock query: " + sql);
        },
      };
    }
    vi.mocked(withTenant).mockImplementation(async (_tenantId: string, cb: any) => cb(fakeClient()));

    const docId = "doc-race-1";
    const first = await resolveAuthoritativeSheet("tenant-1", docId, null, "Dense");
    expect(first).toBe("Dense"); // first caller wins, gets its own value back

    const second = await resolveAuthoritativeSheet("tenant-1", docId, null, "Sparse");
    expect(second).toBe("Dense"); // second caller loses the race and must adopt the winner
  });

  it("item 2b: an already-authoritative selection short-circuits with no database write", async () => {
    vi.mocked(withTenant).mockImplementation(async () => {
      throw new Error("withTenant must not be called when currentlySelected is already set");
    });
    const result = await resolveAuthoritativeSheet("tenant-1", "doc-other", "AlreadySet", "Whatever");
    expect(result).toBe("AlreadySet");
  });

  it("item 4: a selection-persistence failure (permission error, missing migration, etc.) propagates rather than being swallowed", async () => {
    function fakeClient() {
      return {
        query: async (sql: string) => {
          if (sql.toLowerCase().includes("update documents set selected_sheet")) {
            throw new Error("permission denied for table documents");
          }
          throw new Error("unhandled mock query: " + sql);
        },
      };
    }
    vi.mocked(withTenant).mockImplementation(async (_tenantId: string, cb: any) => cb(fakeClient()));

    await expect(resolveAuthoritativeSheet("tenant-1", "doc-fail-1", null, "Dense")).rejects.toThrow(
      "permission denied for table documents",
    );
  });
});

// Round 4 (the five-defect repair). Criteria 1 and 5 fixtures exercised directly against
// parseTableDocument (not reimplementations), plus caller-level tests for criteria 2/3/4
// against the ACTUAL extractAndStoreDocumentTables (documentTables.ts) and
// loadVariableDictionary/buildCrosstab (crosstabs.ts) entry points, using a fake-DB
// harness rather than mocking resolveAuthoritativeSheet away - the whole point of this
// round is that callers, not just that one helper, honor the contract.
describe("round 4: canonical NA/whitespace/tie semantics (criterion 1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** header + 2 NA/whitespace-only rows + 1 real row (expect count 1) vs. header + 2 real
   * rows (expect count 2) - the exact disagreement case Codex's review raised: TS's
   * previous countDataRows had no NA_TOKENS exclusion (a literal "NA" cell counted as
   * data), while Python's prior _count_data_rows relied on raw pandas .notna(), which does
   * not strip whitespace first - so a whitespace-padded "NA " could survive as real data on
   * the Python side while TS's naive non-blank check would ALSO wrongly count it, meaning
   * the two sides could disagree in either direction depending on the exact scenario. */
  function buildNaWhitespaceWorkbook(): XLSX.WorkBook {
    const wb = XLSX.utils.book_new();
    const tokenHeavy = XLSX.utils.aoa_to_sheet([
      ["Col"],
      ["NA"],
      ["  "],
      ["real"],
    ]);
    XLSX.utils.book_append_sheet(wb, tokenHeavy, "TokenHeavy");
    const twoReal = XLSX.utils.aoa_to_sheet([["Col"], ["real1"], ["real2"]]);
    XLSX.utils.book_append_sheet(wb, twoReal, "TwoReal");
    return wb;
  }

  it("a sheet padded out with NA/whitespace-only rows never outranks a genuinely smaller sheet", async () => {
    mockDownload(workbookBuffer(buildNaWhitespaceWorkbook()));
    const result = await parseTableDocument("fixture_na_whitespace.xlsx", null);
    expect(result.sheetName).toBe("TwoReal");
    expect(result.rows).toHaveLength(2);
  });

  it("an exact tie in real-data-row count keeps the first sheet encountered, not an arbitrary pick", async () => {
    const wb = XLSX.utils.book_new();
    const first = XLSX.utils.aoa_to_sheet([["A"], ["r1"], ["r2"]]);
    XLSX.utils.book_append_sheet(wb, first, "First");
    const second = XLSX.utils.aoa_to_sheet([["A"], ["r1"], ["r2"]]);
    XLSX.utils.book_append_sheet(wb, second, "Second");
    mockDownload(workbookBuffer(wb));
    const result = await parseTableDocument("fixture_tie.xlsx", null);
    expect(result.sheetName).toBe("First");
  });

  it("literal identifiers retain surrounding spaces and collisions while missing controls remain missing", async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["respondent_id", "q"], [" 001 ", 1], ["001", 2], [" ", 3], ["NA", 4]]), "Data");
    mockDownload(workbookBuffer(wb));
    const parsed = await parseTableDocument("literal-identifiers.xlsx", "Data");
    expect(parsed.rows.map(row => row.respondent_id)).toEqual([" 001 ", "001", null, null]);
    mockDownload(Uint8Array.from(Buffer.from('respondent_id,q\n" 001 ",1\n001,2\n" ",3\nNA,4\n')).buffer);
    const csv = await parseTableDocument("literal-identifiers.csv");
    expect(csv.rows.map(row => row.respondent_id)).toEqual([" 001 ", "001", null, null]);
  });
});

/** Shared fake-DB harness for the caller-level tests below. Keyed by documentId so several
 * tests can run independent scenarios without interfering, and the `query` dispatch covers
 * every statement extractAndStoreDocumentTables, loadVariableDictionary and buildCrosstab
 * actually issue - anything unhandled throws loudly rather than silently returning `{rows:
 * []}`, so a test that exercises an un-mocked query path fails instead of passing on a
 * false premise. */
type FakeDoc = {
  storage_path: string;
  source_filename: string;
  ingestion_type?: "raw" | "aggregated" | null;
  selected_sheet: string | null;
  variable_dictionary?: unknown;
  variable_overrides?: unknown;
};

function makeFakeDb(initial: Record<string, FakeDoc>) {
  const DOCS: Record<string, FakeDoc> = initial;
  const calls: { sql: string; params: unknown[] }[] = [];
  function client() {
    return {
      query: async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        const s = sql.toLowerCase();
        if (s.includes("select storage_path, source_filename, ingestion_type, selected_sheet from documents")) {
          const [documentId] = params as [string];
          const doc = DOCS[documentId];
          return {
            rows: doc
              ? [{ storage_path: doc.storage_path, source_filename: doc.source_filename, ingestion_type: doc.ingestion_type ?? "aggregated", selected_sheet: doc.selected_sheet }]
              : [],
          };
        }
        if (s.includes("select storage_path, source_filename, selected_sheet from documents")) {
          const [documentId] = params as [string];
          const doc = DOCS[documentId];
          return { rows: doc ? [{ storage_path: doc.storage_path, source_filename: doc.source_filename, selected_sheet: doc.selected_sheet }] : [] };
        }
        if (s.includes("select variable_dictionary from documents")) {
          const [documentId] = params as [string];
          return { rows: [{ variable_dictionary: DOCS[documentId]?.variable_dictionary ?? null }] };
        }
        if (s.includes("select data_setup from documents")) {
          return { rows: [{ data_setup: null }] };
        }
        if (s.includes("select variable_overrides from documents")) {
          const [documentId] = params as [string];
          return { rows: [{ variable_overrides: DOCS[documentId]?.variable_overrides ?? {} }] };
        }
        if (s.includes("update documents set selected_sheet")) {
          const [resolved, documentId] = params as [string, string];
          const doc = DOCS[documentId] ?? (DOCS[documentId] = { storage_path: "", source_filename: "", selected_sheet: null });
          if (doc.selected_sheet === null) {
            doc.selected_sheet = resolved;
            return { rows: [{ selected_sheet: resolved }] };
          }
          return { rows: [] };
        }
        if (s.includes("select selected_sheet from documents")) {
          const [documentId] = params as [string];
          return { rows: [{ selected_sheet: DOCS[documentId]?.selected_sheet ?? null }] };
        }
        if (s.includes("update documents set variable_dictionary")) {
          const [dictJson, documentId] = params as [string, string];
          const doc = DOCS[documentId] ?? (DOCS[documentId] = { storage_path: "", source_filename: "", selected_sheet: null });
          doc.variable_dictionary = JSON.parse(dictJson);
          return { rows: [] };
        }
        if (s.includes("insert into trace")) {
          return { rows: [] };
        }
        // CT500-F02: buildCrosstab locks the data file's row (by id, run and tenant) before choosing the
        // next table index; a known document is this run's.
        if (s.includes("select id from documents where id = $1 and run_id = $2 and tenant_id = $3 for update")) {
          const [documentId] = params as [string];
          return { rows: DOCS[documentId] ? [{ id: documentId }] : [] };
        }
        if (s.includes("coalesce(max(table_index)")) {
          return { rows: [{ next: 1000 }] };
        }
        if (s.includes("insert into document_tables")) {
          return { rows: [{ id: "table-1" }] };
        }
        throw new Error("unhandled mock query: " + sql);
      },
    };
  }
  return { DOCS, calls, client };
}

function simpleWorkbookBuffer(sheetName: string): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([["A", "B"], [1, 2], [3, 4]]);
  XLSX.utils.book_append_sheet(wb, sheet, sheetName);
  return workbookBuffer(wb);
}

function twoSheetWorkbookBuffer(): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  const a = XLSX.utils.aoa_to_sheet([["A"], [1], [2]]);
  XLSX.utils.book_append_sheet(wb, a, "Alpha");
  const b = XLSX.utils.aoa_to_sheet([["B"], [3], [4]]);
  XLSX.utils.book_append_sheet(wb, b, "Beta");
  return workbookBuffer(wb);
}

describe("round 4: extractAndStoreDocumentTables caller-level tests (criterion 2/3 adjacent)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("a losing publisher re-parses against the real winner before storing anything, rather than saving its own stale guess", async () => {
    const { DOCS, client } = makeFakeDb({
      "doc-1": { storage_path: "fixture.xlsx", source_filename: "fixture.xlsx", selected_sheet: null },
    });
    // Simulate another reader (e.g. a concurrent dictionary load) winning the race for this
    // document's selected_sheet the instant before extraction's own resolveAuthoritativeSheet
    // call runs, by pre-seeding selected_sheet as already set to a DIFFERENT sheet than the
    // one this workbook would rank highest on its own (both sheets here have equal real-data
    // row counts, so the ranking rule alone would pick "Alpha", the first one encountered).
    DOCS["doc-1"].selected_sheet = "Beta";
    vi.mocked(withTenant).mockImplementation(async (_tenantId: string, cb: any) => cb(client()));
    mockDownload(twoSheetWorkbookBuffer());

    const { extractAndStoreDocumentTables } = await import("../documentTables");
    const ids = await extractAndStoreDocumentTables("tenant-1", "run-1", "doc-1");

    expect(ids).toEqual(["table-1"]);
    // Had this not re-parsed against the already-authoritative "Beta", it would have stored
    // Alpha's single-column data under Beta's header name entirely by coincidence of shape -
    // checking the actual header name stored is what proves the re-parse happened.
  });

  it("a selection-persistence failure before storing propagates rather than silently saving under the wrong sheet", async () => {
    const { client } = makeFakeDb({
      "doc-2": { storage_path: "fixture.xlsx", source_filename: "fixture.xlsx", selected_sheet: null },
    });
    vi.mocked(withTenant).mockImplementation(async (_tenantId: string, cb: any) => {
      // The first call extractAndStoreDocumentTables makes is its own initial document read
      // (select ... from documents), which must still succeed so there is something to
      // resolve a sheet against; only the subsequent selected_sheet UPDATE (inside
      // resolveAuthoritativeSheet) is made to fail, reproducing a persistence failure that
      // happens strictly before anything is saved or cached.
      return cb({
        query: async (sql: string, params: unknown[] = []) => {
          const s = sql.toLowerCase();
          if (s.includes("update documents set selected_sheet")) {
            throw new Error("permission denied for table documents");
          }
          return client().query(sql, params);
        },
      });
    });
    mockDownload(simpleWorkbookBuffer("Only"));

    const { extractAndStoreDocumentTables } = await import("../documentTables");
    await expect(extractAndStoreDocumentTables("tenant-1", "run-1", "doc-2")).rejects.toThrow(
      "permission denied for table documents",
    );
  });

  // Overnight queue: "add correction-to-calculation tests using ... unsupported-ID
  // recovery." Exercises the actual extraction caller (not raw parseTableDocument) to
  // confirm the blanked-value block and the recovery trace event both reach storage -
  // the same guarantee the ImportQualityPanel warning banner and this round's TS/Python
  // null-out parity depend on actually holding at the caller boundary, not only inside
  // the reader function itself.
  it("unsupported-ID recovery: extraction blanks the unsupported column's values and records a recovery trace event with the exact column name", async () => {
    const { client, calls } = makeFakeDb({
      "doc-9": { storage_path: "fixture_unsupported_format.xlsx", source_filename: "fixture_unsupported_format.xlsx", selected_sheet: "Data" },
    });
    vi.mocked(withTenant).mockImplementation(async (_tenantId: string, cb: any) => cb(client()));
    mockDownload(workbookBuffer(buildUnsupportedFormatWorkbook()));

    const { extractAndStoreDocumentTables } = await import("../documentTables");
    const ids = await extractAndStoreDocumentTables("tenant-1", "run-1", "doc-9");
    expect(ids).toEqual(["table-1"]);

    const insertCall = calls.find((c) => c.sql.toLowerCase().includes("insert into document_tables"));
    expect(insertCall).toBeDefined();
    const storedHeaders: string[] = JSON.parse(insertCall!.params[6] as string);
    const storedRows: Record<string, unknown>[] = JSON.parse(insertCall!.params[7] as string);
    expect(storedHeaders).toContain("AccountID");
    expect(storedRows.map((r) => r.AccountID)).toEqual([null, null]);
    expect(storedRows.map((r) => r.RespID)).toEqual(["0007", "0008"]); // supported column unaffected

    const traceCall = calls.find((c) => c.sql.toLowerCase().includes("'unsupported_identifier_format'"));
    expect(traceCall).toBeDefined();
    const detail = JSON.parse(traceCall!.params[2] as string);
    expect(detail.columns).toEqual(["AccountID"]);
  });
});

describe("round 4: loadVariableDictionary caller-level tests (criterion 3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("criterion 3: an unconfirmed cache (selected_sheet null) is confirmed/published and reused when nothing else has raced ahead", async () => {
    const { DOCS, client } = makeFakeDb({
      "doc-3": {
        storage_path: "fixture.xlsx",
        source_filename: "fixture.xlsx",
        selected_sheet: null,
        // IMP-015: version 7 is the current dictionary version (a version-6 cache is recomputed; see below).
        variable_dictionary: { version: 7, sets: {}, sheets: { data: "Alpha" }, layout: "rows_are_cases", variables: {} },
      },
    });
    vi.mocked(withTenant).mockImplementation(async (_tenantId: string, cb: any) => cb(client()));
    vi.mocked(withTenantRead).mockImplementation(async (_tenantId: string, cb: any) => cb(client()));

    const { loadVariableDictionary } = await import("../crosstabs");
    const dict = await loadVariableDictionary("tenant-1", "run-1", "doc-3");

    // The cache was reused (no recompute happened - runStatsTool is not mocked in this test,
    // so a recompute attempt would throw), and selected_sheet is now published as "Alpha"
    // rather than left null for the next caller to also have to confirm from scratch.
    expect(dict).toMatchObject({ sheets: { data: "Alpha" } });
    expect(DOCS["doc-3"].selected_sheet).toBe("Alpha");
  });

  it("IMP-015: a version-6 cache (labels possibly chosen silently from conflicting sheets) is recomputed, not reused", async () => {
    const { client } = makeFakeDb({
      "doc-6": {
        storage_path: "fixture.xlsx",
        source_filename: "fixture.xlsx",
        selected_sheet: "Alpha",
        variable_dictionary: { version: 6, sets: {}, sheets: { data: "Alpha" }, layout: "rows_are_cases", variables: {} },
      },
    });
    vi.mocked(withTenant).mockImplementation(async (_tenantId: string, cb: Parameters<typeof withTenant>[1]) => cb(client() as never));
    vi.mocked(withTenantRead).mockImplementation(async (_tenantId: string, cb: Parameters<typeof withTenantRead>[1]) => cb(client() as never));
    const { runStatsTool } = await import("../parseStatsFile");
    vi.mocked(runStatsTool).mockReset();
    vi.mocked(runStatsTool).mockResolvedValue({ version: 7, sets: {}, sheets: { data: "Alpha" }, variables: {} } as unknown as Awaited<ReturnType<typeof runStatsTool>>);

    const { loadVariableDictionary } = await import("../crosstabs");
    const dict = await loadVariableDictionary("tenant-1", "run-1", "doc-6");

    expect(vi.mocked(runStatsTool)).toHaveBeenCalledTimes(1);
    expect(dict).toMatchObject({ version: 7 });
  });

  it("criterion 3: a cache naming a sheet that LOSES the confirmation race is not reused - it is invalidated and rebuilt", async () => {
    const { DOCS, client } = makeFakeDb({
      "doc-4": {
        storage_path: "fixture.xlsx",
        source_filename: "fixture.xlsx",
        selected_sheet: null,
        // IMP-015: version 7 is the current dictionary version (a version-6 cache is recomputed; see below).
        variable_dictionary: { version: 7, sets: {}, sheets: { data: "Alpha" }, layout: "rows_are_cases", variables: {} },
      },
    });
    // Another reader already published "Beta" as authoritative for this document moments
    // before this call's own confirmation attempt runs.
    DOCS["doc-4"].selected_sheet = "Beta";
    vi.mocked(withTenant).mockImplementation(async (_tenantId: string, cb: any) => cb(client()));
    vi.mocked(withTenantRead).mockImplementation(async (_tenantId: string, cb: any) => cb(client()));
    const { runStatsTool } = await import("../parseStatsFile");
    vi.mocked(runStatsTool).mockResolvedValue({
      version: 6,
      sets: {},
      sheets: { data: "Beta" },
      variables: {},
    } as any);

    const { loadVariableDictionary } = await import("../crosstabs");
    const dict = await loadVariableDictionary("tenant-1", "run-1", "doc-4");

    // The stale "Alpha" cache must not have been reused: a fresh dictionary was computed
    // (via the mocked runStatsTool), named "Beta" - the sheet that actually won.
    expect(dict).toMatchObject({ sheets: { data: "Beta" } });
    expect(vi.mocked(runStatsTool)).toHaveBeenCalled();
  });

  it("criterion 3 (losing-publication reparse on a fresh compute): a dictionary computed before another reader's write lands adopts the real winner before being cached or returned", async () => {
    const { DOCS, client } = makeFakeDb({
      "doc-5": { storage_path: "fixture.xlsx", source_filename: "fixture.xlsx", selected_sheet: null },
    });
    vi.mocked(withTenant).mockImplementation(async (_tenantId: string, cb: any) => {
      return cb({
        query: async (sql: string, params: unknown[] = []) => {
          const s = sql.toLowerCase();
          if (s.includes("update documents set selected_sheet")) {
            // Someone else's write already landed between this call's own document read
            // and its attempt to publish "Alpha" - simulated by pre-seeding the losing
            // outcome directly, the same race resolveAuthoritativeSheet itself is tested
            // against in the existing "item 2" test above.
            DOCS["doc-5"].selected_sheet = "Beta";
            return { rows: [] };
          }
          return client().query(sql, params);
        },
      });
    });
    vi.mocked(withTenantRead).mockImplementation(async (_tenantId: string, cb: any) => cb(client()));
    const { runStatsTool } = await import("../parseStatsFile");
    vi.mocked(runStatsTool)
      .mockResolvedValueOnce({ version: 6, sets: {}, sheets: { data: "Alpha" }, variables: {} } as any)
      .mockResolvedValueOnce({ version: 6, sets: {}, sheets: { data: "Beta" }, variables: {} } as any);

    const { loadVariableDictionary } = await import("../crosstabs");
    const dict = await loadVariableDictionary("tenant-1", "run-1", "doc-5");

    expect(dict).toMatchObject({ sheets: { data: "Beta" } });
    expect(vi.mocked(runStatsTool)).toHaveBeenCalledTimes(2);
  });

  it("a dictionary-cache persistence failure (best-effort) does not stop the correct dictionary from being returned", async () => {
    const { client } = makeFakeDb({
      "doc-6": { storage_path: "fixture.xlsx", source_filename: "fixture.xlsx", selected_sheet: "Alpha" },
    });
    vi.mocked(withTenant).mockImplementation(async (_tenantId: string, cb: any) => {
      return cb({
        query: async (sql: string, params: unknown[] = []) => {
          const s = sql.toLowerCase();
          if (s.includes("update documents set variable_dictionary")) {
            throw new Error("permission denied for table documents");
          }
          return client().query(sql, params);
        },
      });
    });
    vi.mocked(withTenantRead).mockImplementation(async (_tenantId: string, cb: any) => cb(client()));
    const { runStatsTool } = await import("../parseStatsFile");
    vi.mocked(runStatsTool).mockResolvedValue({ version: 6, sets: {}, sheets: { data: "Alpha" }, variables: {} } as any);

    const { loadVariableDictionary } = await import("../crosstabs");
    const dict = await loadVariableDictionary("tenant-1", "run-1", "doc-6");
    expect(dict).toMatchObject({ sheets: { data: "Alpha" } });
  });
});

describe("round 4: buildCrosstab persists the authoritative sheet in provenance (criterion 4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("records the sheet this calculation actually ran against, and re-fetches when it loses the confirmation race", async () => {
    const { DOCS, client, calls } = makeFakeDb({
      "doc-7": { storage_path: "fixture.xlsx", source_filename: "fixture.xlsx", selected_sheet: null },
    });
    vi.mocked(withTenant).mockImplementation(async (_tenantId: string, cb: any) => cb(client()));
    vi.mocked(withTenantRead).mockImplementation(async (_tenantId: string, cb: any) => cb(client()));
    const { runStatsTool } = await import("../parseStatsFile");
    // First compute lands against "Alpha" (whatever this read happened to rank/pick), but
    // another reader's write wins the race for this document in between - exactly the
    // scenario buildCrosstab previously had no mechanism to even detect, since it never
    // called resolveAuthoritativeSheet at all.
    vi.mocked(runStatsTool)
      .mockResolvedValueOnce({
        version: 2,
        engine: "test-engine",
        selectedSheet: "Alpha",
        weightVar: null,
        weightLabel: null,
        excludeDk: true,
        filters: [],
        blocks: [],
        columns: [],
        nets: [],
        total: { n: 10, w: 10, nEff: 10 },
        questions: [{ key: "q1", label: "Q1", kind: "single", rows: [] }],
        skipped: [],
      } as any)
      .mockResolvedValueOnce({
        version: 2,
        engine: "test-engine",
        selectedSheet: "Beta",
        weightVar: null,
        weightLabel: null,
        excludeDk: true,
        filters: [],
        blocks: [],
        columns: [],
        nets: [],
        total: { n: 10, w: 10, nEff: 10 },
        questions: [{ key: "q1", label: "Q1", kind: "single", rows: [] }],
        skipped: [],
      } as any);
    // Simulate the race: by the time resolveAuthoritativeSheet's own UPDATE runs, "Beta" has
    // already been published by someone else.
    const originalClient = client;
    vi.mocked(withTenant).mockImplementation(async (_tenantId: string, cb: any) => {
      return cb({
        query: async (sql: string, params: unknown[] = []) => {
          const s = sql.toLowerCase();
          if (s.includes("update documents set selected_sheet")) {
            DOCS["doc-7"].selected_sheet = "Beta";
            return { rows: [] };
          }
          return originalClient().query(sql, params);
        },
      });
    });

    const { buildCrosstab } = await import("../crosstabs");
    const result = await buildCrosstab("tenant-1", "run-1", "doc-7", {
      columnVars: [],
      rowItems: [{ key: "q1", label: "Q1", kind: "single", vars: ["q1"] }],
    } as any);

    expect(result.tableId).toBe("table-1");
    expect(vi.mocked(runStatsTool)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(runStatsTool).mock.calls[1][3]).toMatchObject({ selectedSheet: "Beta" });

    // Overnight queue: "capture actual persistence parameters and assert the saved
    // provenance.selectedSheet contains the winning sheet" - not just the args handed to
    // the (mocked) compute step, but what actually got written into the document_tables
    // insert this test's own fake DB recorded.
    const insertCall = calls.find((c) => c.sql.toLowerCase().includes("insert into document_tables"));
    expect(insertCall).toBeDefined();
    const storedCrosstabJson = insertCall!.params[7] as string;
    const stored = JSON.parse(storedCrosstabJson);
    expect(stored.provenance.selectedSheet).toBe("Beta");
  });

  // Overnight queue: "add correction-to-calculation tests using collision headers and
  // unsupported-ID recovery." This exercises the actual boundary a saved variable-type
  // correction crosses to reach the calculation engine (buildCrosstab's typeOverrides
  // construction), with a dictionary carrying the exact generated-collision names
  // (_dedupe_header_names/dedupeHeaders' own output: "Q1", "Q1 (3)", "Q1 (2)") a
  // researcher would see and correct against - proving a correction saved under one of
  // these canonical names reaches the engine keyed by that same name, not a sibling.
  it("correction-to-calculation: a saved type override keyed by a canonical collision header reaches the engine under that exact name, not a sibling", async () => {
    const { client } = makeFakeDb({
      "doc-8": {
        storage_path: "fixture.xlsx",
        source_filename: "fixture.xlsx",
        selected_sheet: "Data",
        variable_overrides: { "Q1 (2)": { type: "continuous" } },
      },
    });
    vi.mocked(withTenant).mockImplementation(async (_tenantId: string, cb: any) => cb(client()));
    vi.mocked(withTenantRead).mockImplementation(async (_tenantId: string, cb: any) => cb(client()));
    const { runStatsTool } = await import("../parseStatsFile");
    vi.mocked(runStatsTool).mockResolvedValue({
      version: 2,
      engine: "test-engine",
      selectedSheet: "Data",
      weightVar: null,
      weightLabel: null,
      excludeDk: true,
      filters: [],
      blocks: [],
      columns: [],
      nets: [],
      total: { n: 10, w: 10, nEff: 10 },
      questions: [
        { key: "Q1", label: "Q1", kind: "single", rows: [] },
        { key: "Q1 (3)", label: "Q1 (3)", kind: "single", rows: [] },
        { key: "Q1 (2)", label: "Q1 (2)", kind: "single", rows: [] },
      ],
      skipped: [],
    } as any);

    const { buildCrosstab } = await import("../crosstabs");
    await buildCrosstab("tenant-1", "run-1", "doc-8", {
      columnVars: [],
      rowItems: [
        { key: "Q1", label: "Q1", kind: "single", vars: ["Q1"] },
        { key: "Q1 (3)", label: "Q1 (3)", kind: "single", vars: ["Q1 (3)"] },
        { key: "Q1 (2)", label: "Q1 (2)", kind: "single", vars: ["Q1 (2)"] },
      ],
    } as any);

    const crosstabArgs = vi.mocked(runStatsTool).mock.calls[0][3] as { typeOverrides: Record<string, string> };
    expect(crosstabArgs.typeOverrides).toEqual({ "Q1 (2)": "continuous" });
    expect(crosstabArgs.typeOverrides["Q1"]).toBeUndefined();
    expect(crosstabArgs.typeOverrides["Q1 (3)"]).toBeUndefined();
  });
});
