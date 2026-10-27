// V-B36-01 (Codex): with no engine named, pandas 3.1 chooses python-calamine for .xls, which
// requirements.txt does not install, so a fresh install refused valid .xls data and codebooks. The
// engine now names the reader for each workbook format (WORKBOOK_ENGINES). This test runs the actual
// engine with pandas' automatic choice made to fail the way a fresh install fails (any call that does
// not name xlrd for .xls, or openpyxl for .xlsx, raises the missing-dependency error), so it holds
// whichever pandas and readers happen to be installed here.
//   - .xls data (logical and numeric cells kept apart) and an .xls codebook read through xlrd
//   - .xlsx data reads through openpyxl
//   - an unsupported workbook extension is refused, not guessed
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as XLSX from "xlsx";
import { PYTHON } from "./helpers/pythonEngine";

const PYTHON_OK = spawnSync(PYTHON, ["-c", "import pandas, xlrd, openpyxl"], { encoding: "utf8" }).status === 0;
const ENGINE = path.resolve(__dirname, "../../../api/parse-stats-file.py");

function book(aoa: (string | number | boolean)[][], bookType: "xlsx" | "biff8"): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Sheet1");
  return XLSX.write(wb, { type: "buffer", bookType }) as Buffer;
}

function run(action: string, filename: string, bytes: Buffer, args: unknown = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "workbook-engine-"));
  const f = path.join(dir, "in.bin");
  writeFileSync(f, bytes);
  const script = String.raw`
import sys, json, importlib.util, pandas as pd
real = pd.ExcelFile
class FreshInstallExcelFile(real):
    # As a fresh install without python-calamine: only an explicitly named, installed reader works.
    def __init__(self, path, engine=None, **kw):
        ext = str(path).lower().rsplit(".", 1)[-1]
        if (ext, engine) not in (("xls", "xlrd"), ("xlsx", "openpyxl"), ("xlsm", "openpyxl")):
            raise ImportError("Missing optional dependency 'python-calamine'. Use pip or conda to install python-calamine.")
        super().__init__(path, engine=engine, **kw)
pd.ExcelFile = FreshInstallExcelFile
spec = importlib.util.spec_from_file_location("engine", sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
b = open(sys.argv[2], "rb").read()
action, name, args = sys.argv[3], sys.argv[4], json.loads(sys.argv[5])
try:
    if action == "table":
        df, _ = m._read_raw(b, name)
        out = {"columns": [str(c) for c in df.columns], "flag": [v if isinstance(v, (str, bool)) else float(v) for v in df["flag"].tolist()]}
    else:
        out = m.codebook_items(b, name, args)
    print(json.dumps({"ok": True, "result": out}, default=str))
except Exception as e:
    print(json.dumps({"ok": False, "error": str(e)}))
`;
  // Not -I: the engine's packages may come from PYTHONPATH (a reviewer's private requirements target, Codex
  // B37/38 continuation), which isolated mode ignores. The script and files are this test's own.
  const r = spawnSync(PYTHON, ["-c", script, ENGINE, f, action, filename, JSON.stringify(args)], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout.trim().split("\n").pop()!) as { ok: true; result: Record<string, unknown> } | { ok: false; error: string };
}

describe.skipIf(!PYTHON_OK)("workbook readers are named, not chosen by pandas (V-B36-01)", () => {
  const data = [["id", "flag"], [1, true], [2, 1], [3, false], [4, 0], [5, 2]];
  it("reads .xls data through xlrd, keeping logical and numeric answers apart", () => {
    const r = run("table", "data.xls", book(data, "biff8"));
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(r.result.columns).toEqual(["id", "flag"]);
    expect(r.result.flag).toEqual(["TRUE", 1, "FALSE", 0, 2]);
  });
  it("reads .xlsx data through openpyxl", () => {
    const r = run("table", "data.xlsx", book(data, "xlsx"));
    expect(r).toMatchObject({ ok: true, result: { flag: ["TRUE", 1, "FALSE", 0, 2] } });
  });
  it("reads an .xls codebook through xlrd", () => {
    const r = run("codebook", "cb.xls", book([["Variable", "Label", "Values"], ["q1", "Satisfaction", "1=Low, 2=High"], ["q2", "Region", "1=North, 2=South"]], "biff8"));
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(JSON.stringify(r.result)).toContain("Satisfaction");
  });
  it("refuses a workbook extension it has no reader for", () => {
    const r = run("codebook", "cb.ods", book(data, "xlsx"));
    expect(r.ok).toBe(false);
  });
});
