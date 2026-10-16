import { PYTHON } from "./helpers/pythonEngine";
// IMP-009: columns-as-cases workbooks (variables in rows, one column per case).
// (a) The actual loadImportPreviewIdentities verifies a stored preview of such a workbook by comparing
//     it with the SAME transpose the import applied (actual transposeTable), instead of withholding
//     every valid one. Mocked boundaries: the document read (db), the stored-file parse
//     (parseTableDocument) and the saved layout setting (loadDataSetupWithStatus).
// (b) End to end through the ACTUAL Python engine: the same data laid out both ways gives identical
//     variables, case counts and category counts. Skipped, with the reason printed, without python3 +
//     pandas/openpyxl/pyreadstat.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const state = vi.hoisted(() => ({
  layout: "columns_are_cases" as string,
  setupOk: true,
  ingestion: "raw" as string | null,
  parsed: { headers: [] as string[], rows: [] as Record<string, string | number | null>[] },
}));
vi.mock("../db", () => ({
  withTenantRead: async (_t: string, cb: (c: { query: () => Promise<{ rows: unknown[] }> }) => unknown) =>
    cb({
      query: async () => ({
        rows: [{ id: "doc-1", source_filename: "wide.xlsx", storage_path: "p", selected_sheet: "Data", kind: "table", ingestion_type: state.ingestion }],
      }),
    }),
}));
vi.mock("../parseTable", () => ({ parseTableDocument: vi.fn(async () => state.parsed) }));
vi.mock("../dataSetup", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../dataSetup")>();
  return {
    ...actual,
    loadDataSetupWithStatus: vi.fn(async () =>
      state.setupOk
        ? { ok: true, setup: { ...((await import("../dataSetupShared")).DEFAULT_DATA_SETUP), layout: state.layout } }
        : { ok: false, error: "permission denied", setup: (await import("../dataSetupShared")).DEFAULT_DATA_SETUP },
    ),
  };
});

// Variables in rows, one column per case (3 cases).
const WIDE = {
  headers: ["Variable", "Case 1", "Case 2", "Case 3"],
  rows: [
    { Variable: "Gender", "Case 1": "Male", "Case 2": "Female", "Case 3": "Female" },
    { Variable: "Score", "Case 1": 4, "Case 2": 5, "Case 3": 3 },
  ],
};

async function storedFromImport(): Promise<{ headers: string[]; rows: Record<string, string | number | null>[] }> {
  const { transposeTable } = await import("../dataSetup");
  const flipped = transposeTable(WIDE.headers, WIDE.rows);
  return { headers: flipped.headers, rows: flipped.rows as Record<string, string | number | null>[] };
}

beforeEach(() => {
  state.layout = "columns_are_cases";
  state.setupOk = true;
  state.ingestion = "raw";
  state.parsed = WIDE;
});

describe("IMP-009 (a): cached-preview identity for columns-as-cases", () => {
  const check = async (stored: { headers: string[]; rows: Record<string, string | number | null>[] }) => {
    const { loadImportPreviewIdentities } = await import("../importPreviewIdentity");
    const r = await loadImportPreviewIdentities("t", "run", [
      { document_id: "doc-1", table_index: 0, headers: stored.headers, rows: stored.rows, row_count: stored.rows.length },
    ]);
    return r.get("doc-1")!;
  };

  it("a valid transposed stored table is verified", async () => {
    const stored = await storedFromImport();
    expect(stored.headers).toEqual(["Gender", "Score"]);
    expect(stored.rows).toHaveLength(3);
    expect((await check(stored)).error).toBeNull();
  });

  it("an untransposed stored table under columns-as-cases is not verified (it differs from what import stores)", async () => {
    expect((await check(WIDE)).error).toMatch(/cannot be verified/);
  });

  it("rows-as-cases is compared untransposed, as before", async () => {
    state.layout = "rows_are_cases";
    expect((await check(WIDE)).error).toBeNull();
    expect((await check(await storedFromImport())).error).toMatch(/cannot be verified/);
  });

  it("an unreadable layout setting fails closed with the reason", async () => {
    state.setupOk = false;
    expect((await check(await storedFromImport())).error).toMatch(/layout setting could not be read \(permission denied\)/);
  });
});

const ENGINE = path.join(process.cwd(), "api", "parse-stats-file.py");
const probe = spawnSync(PYTHON, ["-c", "import pandas, openpyxl, pyreadstat"], { encoding: "utf8" });
const PYTHON_OK = probe.status === 0;

describe.skipIf(!PYTHON_OK)("IMP-009 (b): the actual engine reads both orientations identically", () => {
  it("variables, case counts and category counts match", () => {
    const driver = String.raw`
import importlib.util, io, json, sys
from openpyxl import Workbook
spec = importlib.util.spec_from_file_location("engine", sys.argv[1]); eng = importlib.util.module_from_spec(spec); spec.loader.exec_module(eng)
def book(rows):
    wb = Workbook(); ws = wb.active; ws.title = "Data"
    for r in rows: ws.append(r)
    b = io.BytesIO(); wb.save(b); return b.getvalue()
cases = [("Male", 4, 1), ("Female", 5, 2), ("Female", 3, 1), ("Male", 5, 2), ("Female", 4, 1)]
long = book([["Gender", "Score", "Region"]] + [list(c) for c in cases])
wide = book([["Variable"] + ["Case %d" % (i + 1) for i in range(len(cases))]] +
            [["Gender"] + [c[0] for c in cases], ["Score"] + [c[1] for c in cases], ["Region"] + [c[2] for c in cases]])
out = {}
for name, b, layout in (("long", long, "rows_are_cases"), ("wide", wide, "columns_are_cases")):
    d = eng.dictionary(b, "f.xlsx", {"layout": layout, "selectedSheet": "Data"})
    out[name] = {
        "vars": sorted((v["name"], v["nValid"], v["nDistinct"]) for v in d["variables"]),
        "cases": d.get("nCases"),
        "gender": sorted((c["label"], c["n"]) for c in eng.categories(b, "f.xlsx", "Gender", layout=layout, selected_sheet="Data")["categories"]),
        "region": sorted((str(c["label"]), c["n"]) for c in eng.categories(b, "f.xlsx", "Region", layout=layout, selected_sheet="Data")["categories"]),
        "driverInputs": eng.driver_columns(b, "f.xlsx", {"layout":layout,"selectedSheet":"Data","outcome":"Score","predictors":["Region"]}),
    }
print(json.dumps(out))
`;
    const dir = mkdtempSync(path.join(tmpdir(), "imp009-"));
    const file = path.join(dir, "driver.py");
    writeFileSync(file, driver);
    const r = spawnSync(PYTHON, ["-I", file, ENGINE], { encoding: "utf8", timeout: 120_000 });
    if (r.status !== 0) throw new Error(r.stderr);
    const out = JSON.parse(r.stdout.trim().split("\n").pop()!);
    expect(out.wide).toEqual(out.long);
    expect(out.long.cases).toBe(5);
    expect(out.long.gender).toEqual([["Female", 3], ["Male", 2]]);
    expect(out.long.driverInputs.y).toEqual([4,5,3,5,4]);
    expect(out.long.driverInputs.x).toEqual([[1],[2],[1],[2],[1]]);
  });
});

describe.skipIf(PYTHON_OK)("IMP-009 (b): the actual engine reads both orientations identically", () => {
  it.skip("python3 with pandas/openpyxl/pyreadstat unavailable: engine orientation check NOT RUN", () => {});
});
