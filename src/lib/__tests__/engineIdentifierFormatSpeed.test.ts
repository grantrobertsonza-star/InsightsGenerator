import { PYTHON } from "./helpers/pythonEngine";
// Excel identifier formats through the ACTUAL Python engine (api/parse-stats-file.py), at a
// realistic size. Codex's real-data check (2026-10-19) found csm_Wave1_Baseline.xlsx (1,000 cases,
// 97 columns) failing with "The statistics worker took too long and was restarted":
// _apply_zero_padded_id_formats looked up every identifier cell with ws.cell(row, column) on a
// read-only workbook, which re-reads the sheet from the top on every call, so the cost grew with
// rows x rows. Measured on a generated 1,000 x 97 workbook with three identifier columns: 808.8 s
// before, 0.56 s after (150 rows: 19.1 s -> 0.08 s; 300 rows: 73.8 s -> 0.23 s), with identical
// output digests at every size. The fix reads the identifier columns in one pass with iter_rows.
// These checks cover the repro (size), and that the per-cell rules did not change: zero-pad
// formats are rebuilt ("0007"), unsupported formats are blanked and flagged, text and General
// cells are left alone, and a row shorter than the identifier column does not shift later rows.
// Skipped, with the reason printed, without python3 + pandas/openpyxl/pyreadstat.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const ENGINE = path.join(process.cwd(), "api", "parse-stats-file.py");
const probe = spawnSync(PYTHON, ["-c", "import pandas, openpyxl, pyreadstat"], { encoding: "utf8" });
const PYTHON_OK = probe.status === 0;

function runDriver(source: string): Record<string, unknown> {
  const dir = mkdtempSync(path.join(tmpdir(), "engine-idformat-"));
  const file = path.join(dir, "driver.py");
  writeFileSync(file, source);
  // Well inside the worker's limit; the old code needed about 800 s for the large case.
  const r = spawnSync(PYTHON, ["-I", file, ENGINE, dir], { encoding: "utf8", timeout: 120_000 });
  if (r.status !== 0) throw new Error(r.stderr || `driver exited ${r.status} (${r.signal ?? "no signal"})`);
  return JSON.parse(r.stdout.trim().split("\n").pop()!);
}

const PRELUDE = String.raw`
import importlib.util, io, json, sys, time, random
from openpyxl import Workbook
spec = importlib.util.spec_from_file_location("engine", sys.argv[1]); eng = importlib.util.module_from_spec(spec); spec.loader.exec_module(eng)
def save(wb):
    b = io.BytesIO(); wb.save(b); return b.getvalue()
def ids(b, var):
    x = eng.crosstab(b, "f.xlsx", {"layout": "rows_are_cases", "selectedSheet": "Data", "columnVars": [], "typeOverrides": {},
                                   "rowItems": [{"key": var, "label": var, "vars": [var]}]})
    return sorted(r["rawCode"] for r in x["questions"][0]["rows"] if not r.get("isBase"))
`;

describe.skipIf(!PYTHON_OK)("engine: Excel identifier formats at a realistic size", () => {
  it("a 1,000-case, 97-column workbook with formatted identifiers loads in seconds, with the same identifiers", () => {
    const out = runDriver(
      PRELUDE +
        String.raw`
rows, cols = 1000, 97
wb = Workbook(); ws = wb.active; ws.title = "Data"
ws.append(["RespID", "Panel ID", "Thousand ID"] + [f"Q{i}" for i in range(cols - 3)])
r = random.Random(7)
for i in range(rows):
    ws.append([i + 1, 1000 + i, 123456 + i] + [r.randint(1, 5) for _ in range(cols - 3)])
for row in ws.iter_rows(min_row=2, min_col=1, max_col=3):
    row[0].number_format = "0000"   # supported zero-pad
    row[2].number_format = "#,##0"  # unsupported: blanked and flagged
b = save(wb)
t = time.time()
d = eng.dictionary(b, "f.xlsx", {"layout": "rows_are_cases", "selectedSheet": "Data"})
seconds = time.time() - t
# The values themselves, through the engine's own reader (a crosstab of 1,000 distinct ids is not a table).
path = sys.argv[2] + "/f.xlsx"
open(path, "wb").write(b)
df, _ = eng._read_plain(path, ".xlsx", layout="rows_are_cases", selected_sheet="Data")
resp = list(df["RespID"])
print(json.dumps({"seconds": seconds, "nCases": d["nCases"], "nVars": len(d["variables"]),
                  "unsupported": d.get("unsupportedIdentifierColumns"),
                  "respFirst": resp[0], "respLast": resp[-1], "respCount": len(set(resp)), "panelFirst": str(df["Panel ID"].iloc[0]),
                  "thousandValid": next(v["nValid"] for v in d["variables"] if v["name"] == "Thousand ID")}))
`,
    );
    expect(out.nCases).toBe(1000);
    expect(out.nVars).toBe(97);
    // The worker allows 300 s; the old code needed about 800 s here. 30 s leaves room for a slow machine.
    expect(out.seconds).toBeLessThan(30);
    expect(out.unsupported).toEqual(["Thousand ID"]);
    expect(out.respCount).toBe(1000);
    expect(out.respFirst).toBe("0001");
    expect(out.respLast).toBe("1000");
    expect(out.panelFirst).toBe("1000"); // General format: left as read
    expect(out.thousandValid).toBe(0);
  });

  it("per-cell rules are unchanged: text and General cells kept, a short row does not shift later rows", () => {
    const out = runDriver(
      PRELUDE +
        String.raw`
wb = Workbook(); ws = wb.active; ws.title = "Data"
ws.append(["Q1", "RespID", "Note", "Panel ID"])
ws.append([1, 7, "a", 42])
ws.append([2, "X-09", "b", 43])   # text in a zero-pad identifier column: left as written
ws.append([3, 12, "c"])           # short row: no Panel ID cell at all
ws.append([4, 15, "d", 44])
for row in ws.iter_rows(min_row=2, min_col=2, max_col=2):
    row[0].number_format = "0000"
ws.cell(row=5, column=2).number_format = "General"  # a General cell is not reformatted
ws.cell(row=2, column=4).number_format = "00000"
ws.cell(row=5, column=4).number_format = "00000"
b = save(wb)
d = eng.dictionary(b, "f.xlsx", {"layout": "rows_are_cases", "selectedSheet": "Data"})
print(json.dumps({"resp": ids(b, "RespID"), "panel": ids(b, "Panel ID"), "unsupported": d.get("unsupportedIdentifierColumns")}))
`,
    );
    expect(out.resp).toEqual(["0007", "0012", "15", "X-09"]);
    // Rows 1 and 4 are padded; row 2's plain value stays as written; row 3 has no cell (missing).
    expect(out.panel).toEqual(["00042", "00044", "43"]);
    expect(out.unsupported ?? []).toEqual([]);
  });
});
