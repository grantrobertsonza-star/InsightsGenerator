import { PYTHON } from "./helpers/pythonEngine";
// Codex IR-09 (independent review, 2026-10-20), through the ACTUAL Python engine
// (api/parse-stats-file.py): when the Excel number-format inspection of an .xlsx file could not be
// opened, _apply_zero_padded_id_formats returned "no unsupported columns" and the bare digits
// pandas reads stood as identifiers, so 0007 and a literal 7 became the same respondent while the
// read reported success. The read now fails with the reason, and a retry recovers the exact values.
// Only the inspection open is made to fail: the driver wraps openpyxl.load_workbook and raises when
// it is called from _apply_zero_padded_id_formats, so pandas' own workbook read still works and no
// test hook exists in the engine. Skipped, with the reason printed, without python3 + pandas/openpyxl.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const ENGINE = path.join(process.cwd(), "api", "parse-stats-file.py");
const probe = spawnSync(PYTHON, ["-c", "import pandas, openpyxl, pyreadstat"], { encoding: "utf8" });
const PYTHON_OK = probe.status === 0;

function runDriver(source: string): Record<string, unknown> {
  const dir = mkdtempSync(path.join(tmpdir(), "engine-inspect-"));
  const file = path.join(dir, "driver.py");
  writeFileSync(file, source);
  const r = spawnSync(PYTHON, ["-I", file, ENGINE, dir], { encoding: "utf8", timeout: 120_000 });
  if (r.status !== 0) throw new Error(r.stderr || `driver exited ${r.status} (${r.signal ?? "no signal"})`);
  return JSON.parse(r.stdout.trim().split("\n").pop()!);
}

const PRELUDE = String.raw`
import importlib.util, inspect, io, json, sys
import openpyxl
from openpyxl import Workbook
spec = importlib.util.spec_from_file_location("engine", sys.argv[1]); eng = importlib.util.module_from_spec(spec); spec.loader.exec_module(eng)
real_load = openpyxl.load_workbook
FAULT = {"on": False, "hits": 0}
def faulty_load(*a, **k):
    if FAULT["on"] and any(f.function == "_apply_zero_padded_id_formats" for f in inspect.stack()):
        FAULT["hits"] += 1
        raise OSError("simulated: format inspection could not open the workbook")
    return real_load(*a, **k)
openpyxl.load_workbook = faulty_load
def save(wb):
    b = io.BytesIO(); wb.save(b); return b.getvalue()
def ids(b, var):
    x = eng.crosstab(b, "f.xlsx", {"layout": "rows_are_cases", "selectedSheet": "Data", "columnVars": [], "typeOverrides": {},
                                   "rowItems": [{"key": var, "label": var, "vars": [var]}]})
    return sorted(r["rawCode"] for r in x["questions"][0]["rows"] if not r.get("isBase"))
def attempt(fn):
    try:
        return {"ok": True, "value": fn()}
    except ValueError as e:
        return {"ok": False, "error": str(e)}
def colliding_workbook(short_row=False):
    wb = Workbook(); ws = wb.active; ws.title = "Data"
    ws.append(["Note", "RespID", "Q1"])
    for v in (7, 8, 9):
        ws.append(["", v, 1])
    ws.append(["", "7", 2])  # a literal text identifier that collides with 0007 once unpadded
    if short_row:
        ws.append(["only a note"])  # shorter than the identifier column
    for r in range(2, 5):
        ws.cell(row=r, column=2).number_format = "0000"
    return save(wb)
`;

describe.skipIf(!PYTHON_OK)("engine: a failed Excel format inspection fails the read instead of merging identifiers", () => {
  it("fails the dictionary and crosstab reads with the reason, then recovers the exact padded values on retry", () => {
    const out = runDriver(
      PRELUDE +
        String.raw`
b = colliding_workbook()
FAULT["on"] = True
dict_fault = attempt(lambda: eng.dictionary(b, "f.xlsx", {"layout": "rows_are_cases", "selectedSheet": "Data"}))
ids_fault = attempt(lambda: ids(b, "RespID"))
hits = FAULT["hits"]
FAULT["on"] = False
ids_retry = attempt(lambda: ids(b, "RespID"))
dict_retry = attempt(lambda: eng.dictionary(b, "f.xlsx", {"layout": "rows_are_cases", "selectedSheet": "Data"}))
print(json.dumps({"dictFault": dict_fault, "idsFault": ids_fault, "hits": hits, "idsRetry": ids_retry,
                  "dictRetryOk": dict_retry["ok"], "retryUnsupported": dict_retry["value"].get("unsupportedIdentifierColumns") if dict_retry["ok"] else "read failed"}))
`,
    );
    const dictFault = out.dictFault as { ok: boolean; error?: string };
    const idsFault = out.idsFault as { ok: boolean; error?: string };
    // The repro: no successful read, so no collided identifiers reach a table.
    expect(dictFault.ok).toBe(false);
    expect(dictFault.error).toMatch(/Could not check the Excel number formats of the identifier column\(s\) RespID/);
    expect(idsFault.ok).toBe(false);
    expect(out.hits).toBeGreaterThanOrEqual(2);
    // Recovery: the failure was not cached, so the retry reads the formats and keeps the four distinct identifiers.
    expect(out.idsRetry).toEqual({ ok: true, value: ["0007", "0008", "0009", "7"] });
    expect(out.dictRetryOk).toBe(true);
    // The engine omits the key when no column is unsupported.
    expect(out.retryUnsupported ?? []).toEqual([]);
  });

  it("boundary: a short row does not change the outcome either way, and an unformatted sheet is unaffected", () => {
    const out = runDriver(
      PRELUDE +
        String.raw`
b = colliding_workbook(short_row=True)
FAULT["on"] = True
short_fault = attempt(lambda: ids(b, "RespID"))
FAULT["on"] = False
short_ok = attempt(lambda: ids(b, "RespID"))
# No id-like column: the inspection is never attempted, so even with the fault on the read succeeds unchanged.
wb = Workbook(); ws = wb.active; ws.title = "Data"
ws.append(["Region", "Q1"]); ws.append(["North", 1]); ws.append(["South", 2])
plain = save(wb)
FAULT["on"] = True
plain_read = attempt(lambda: eng.dictionary(plain, "f.xlsx", {"layout": "rows_are_cases", "selectedSheet": "Data"})["nCases"])
print(json.dumps({"shortFault": short_fault, "shortOk": short_ok, "plain": plain_read}))
`,
    );
    expect((out.shortFault as { ok: boolean }).ok).toBe(false);
    expect(out.shortOk).toEqual({ ok: true, value: ["0007", "0008", "0009", "7"] });
    expect(out.plain).toEqual({ ok: true, value: 2 });
  });
});
