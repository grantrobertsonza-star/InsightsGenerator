// Decision 9, second part (Grant, 29 October 2026): the researcher's header row for a CSV, TSV or Excel data file,
// saved in the document's data setup (DataSetup.headerRowsSkipped). These cover the field's rule at the places it is
// decided: normalisation (null stays null; an invalid value is never read as 0), the save action's refusal of an
// invalid request before anything is written, the structure rule (a header change asks for acceptance again, as a
// layout change does), the engine's bound, and the plain-table format rule the Import screen and the readers share.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ withTenant: vi.fn(), withTenantRead: vi.fn() }));
vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../documentTables", () => ({ extractAndStoreDocumentTables: vi.fn() }));

import { withTenant } from "../db";
import { saveDataSetupAction } from "../dataSetupActions";
import { rebaseSetupEdit, setupReadChanged, setupStructureChanged } from "../dataSetupRebase";
import {
  DEFAULT_DATA_SETUP,
  HEADER_ROWS_SKIPPED_MAX,
  isPlainTableFileName,
  normaliseDataSetup,
  parseHeaderRowsSkipped,
  type DataSetup,
} from "../dataSetupShared";

const base: DataSetup = { ...DEFAULT_DATA_SETUP };
const accepted: DataSetup = { ...base, accepted: true };

describe("the header row choice in the data setup", () => {
  it("absent or null is detected automatically (null), never 0; every document saved before the field existed reads so", () => {
    expect(DEFAULT_DATA_SETUP.headerRowsSkipped).toBeNull();
    expect(normaliseDataSetup({ layout: "rows_are_cases", accepted: true }).headerRowsSkipped).toBeNull();
    expect(normaliseDataSetup({ headerRowsSkipped: null }).headerRowsSkipped).toBeNull();
    expect(normaliseDataSetup(null).headerRowsSkipped).toBeNull();
  });
  it("a whole number from 0 to the bound is kept, 0 included", () => {
    expect(normaliseDataSetup({ headerRowsSkipped: 0 }).headerRowsSkipped).toBe(0);
    expect(normaliseDataSetup({ headerRowsSkipped: 3 }).headerRowsSkipped).toBe(3);
    expect(normaliseDataSetup({ headerRowsSkipped: HEADER_ROWS_SKIPPED_MAX }).headerRowsSkipped).toBe(HEADER_ROWS_SKIPPED_MAX);
  });
  it("an invalid value is refused by the parser and never becomes 0", () => {
    for (const bad of [-1, HEADER_ROWS_SKIPPED_MAX + 1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "2", "", true, false, {}, [3]]) {
      expect(parseHeaderRowsSkipped(bad).ok, String(bad)).toBe(false);
      expect(normaliseDataSetup({ headerRowsSkipped: bad }).headerRowsSkipped, String(bad)).toBeNull();
    }
    expect(parseHeaderRowsSkipped(undefined)).toEqual({ ok: true, value: null });
  });
  it("the bound is the engine's: rows 1 to 15 (api/parse-stats-file.py _HEADER_ROWS_SKIPPED_MAX)", () => {
    const engine = readFileSync(join(__dirname, "..", "..", "..", "api", "parse-stats-file.py"), "utf8");
    expect(engine).toMatch(/^_HEADER_ROWS_SKIPPED_MAX = _TITLE_ROWS_MAX$/m);
    expect(engine.match(/^_TITLE_ROWS_MAX = (\d+)$/m)?.[1]).toBe(String(HEADER_ROWS_SKIPPED_MAX));
  });
  it("only CSV, TSV, text and Excel files have a header row (the engine's TABLE_EXTS)", () => {
    expect(["a.csv", "a.TSV", "a.txt", "a.xlsx", "a.xls"].every(isPlainTableFileName)).toBe(true);
    expect(["a.sav", "a.dta", "a.sas7bdat", "a.xpt", "a.parquet", "a.pdf"].some(isPlainTableFileName)).toBe(false);
  });
});

describe("a header row change is a structure change, as a layout change is", () => {
  it("changing it, setting it or clearing it changes the structure and how the file is read", () => {
    for (const [from, to] of [[null, 3], [3, null], [2, 3], [0, null]] as const) {
      const a = { ...accepted, headerRowsSkipped: from };
      const b = { ...accepted, headerRowsSkipped: to };
      expect(setupStructureChanged(a, b)).toBe(true);
      expect(setupReadChanged(a, b)).toBe(true);
    }
  });
  it("a wave label or a survey design is not a structure change and does not read the file again", () => {
    const withHeader = { ...accepted, headerRowsSkipped: 2 };
    expect(setupStructureChanged(withHeader, { ...withHeader, wave: "Wave 1" })).toBe(false);
    expect(setupReadChanged(withHeader, { ...withHeader, design: { mode: "none", psu: null, strata: null } })).toBe(false);
  });
  it("a layout change is still a structure change and a read change (unchanged)", () => {
    expect(setupStructureChanged(accepted, { ...accepted, layout: "columns_are_cases" })).toBe(true);
    expect(setupReadChanged(accepted, { ...accepted, layout: "columns_are_cases" })).toBe(true);
    expect(setupReadChanged(accepted, { ...accepted, unit: "businesses" })).toBe(false);
  });
  it("a header change that met a concurrent acceptance is re-applied and asks for acceptance again", () => {
    const r = rebaseSetupEdit(base, { ...base, headerRowsSkipped: 3 }, accepted);
    expect(r).toEqual({ ...accepted, headerRowsSkipped: 3, accepted: false });
  });
  it("a header change that met another header change stays a conflict", () => {
    expect(rebaseSetupEdit(base, { ...base, headerRowsSkipped: 3 }, { ...accepted, headerRowsSkipped: 1 })).toBeNull();
  });
});

describe("saveDataSetupAction refuses an invalid header row before anything is written", () => {
  beforeEach(() => vi.clearAllMocks());

  it("an invalid value is refused with the reason, and the database is not touched", async () => {
    for (const bad of [-1, 15, 2.5, "3"]) {
      const r = await saveDataSetupAction("run-1", "doc-1", { ...base, headerRowsSkipped: bad } as unknown as DataSetup);
      expect(r).toEqual({ ok: false, error: expect.stringMatching(/header row must be a row from 1 to 15/) });
    }
    expect(withTenant).not.toHaveBeenCalled();
  });

  it("a header row on a file that has none (SPSS) is refused on the write, and nothing is written", async () => {
    const writes: string[] = [];
    vi.mocked(withTenant).mockImplementation(async (_tenantId, cb) =>
      cb({
        query: async (sql: string) => {
          const s = sql.toLowerCase();
          if (s.startsWith("select source_filename")) return { rows: [{ source_filename: "wave1.sav" }], rowCount: 1 };
          writes.push(sql);
          return { rows: [], rowCount: 1 };
        },
      } as never),
    );
    const r = await saveDataSetupAction("run-1", "doc-1", { ...base, headerRowsSkipped: 2 });
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/Only CSV, TSV, text and Excel files have a header row/) });
    expect(writes).toEqual([]);
  });
});
