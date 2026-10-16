import { PYTHON } from "./helpers/pythonEngine";
// Identity of codes and identifiers through the ACTUAL Python engine (api/parse-stats-file.py),
// found by the supplemental-fixture probes (2026-10-16):
//   (a) columns-as-cases: an identifier written as text ("001") was coerced to the number 1 when
//       the file was read, because a file column there is one CASE mixing every variable's
//       values. It must stay "001", typed as text, exactly as the same data laid out
//       rows-as-cases is; numeric variables stay numeric, text answers stay text; CSV and Excel.
//   (b) rawCode: one answer code had two text forms, "1" with no value labels and "1.0" with a
//       Labels or Codebook sheet (label keys are floats), which splits any by-code alignment
//       (wave tracking keys bars by rawCode). Now one form for both; text codes ("A01") and
//       non-integer codes (1.5) keep their own text; a declared unused code keeps its 0 row.
//   (c) columns-as-cases exactness: whole numbers beyond the signed 64-bit range wrapped NEGATIVE
//       when the flipped variable was cast to int64; they now keep their exact value (numeric
//       when it fits exactly, else text), the same as a rows-as-cases read. An identifier's
//       surrounding spaces were trimmed after the flip, merging " 001 " into "001"; kept now.
// Not covered, and unchanged: pandas reads a NUMERIC-LOOKING text cell ("01") in a non-identifier
// column as a number in either layout; only identifier-like columns are read as text.
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
  const dir = mkdtempSync(path.join(tmpdir(), "engine-identity-"));
  const file = path.join(dir, "driver.py");
  writeFileSync(file, source);
  const r = spawnSync(PYTHON, ["-I", file, ENGINE, dir], { encoding: "utf8", timeout: 120_000 });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout.trim().split("\n").pop()!);
}

const PRELUDE = String.raw`
import importlib.util, io, json, sys, os
from openpyxl import Workbook
spec = importlib.util.spec_from_file_location("engine", sys.argv[1]); eng = importlib.util.module_from_spec(spec); spec.loader.exec_module(eng)
tmp = sys.argv[2]
def book(sheets):
    wb = Workbook(); wb.remove(wb.active)
    for title, rows in sheets:
        ws = wb.create_sheet(title)
        for r in rows: ws.append(r)
    b = io.BytesIO(); wb.save(b); return b.getvalue()
def codes(b, name, var, layout, sheet="Data", overrides=None):
    x = eng.crosstab(b, name, {"layout": layout, "selectedSheet": sheet, "columnVars": [], "typeOverrides": overrides or {},
                               "rowItems": [{"key": var, "label": var, "vars": [var]}]})
    q = x["questions"][0]
    return [[r["rawCode"], r["total"]["count"]] for r in q["rows"] if not r.get("isBase")]
def kinds(d):
    return sorted((v["name"], v["numeric"], v["text"], v["nValid"]) for v in d["variables"])
`;

describe.skipIf(!PYTHON_OK)("engine: identifiers keep their text in a columns-as-cases file", () => {
  it("Excel and CSV: '001' stays '001' (text), numbers stay numeric, text answers stay text, same as rows-as-cases", () => {
    const out = runDriver(
      PRELUDE +
        String.raw`
ids = ["001", "002", "003", "004"]
score = [1, 2, 3, 4]
gender = ["Male", "Female", "Female", "Male"]
long = book([("Data", [["respondent_id", "score", "gender"]] + [[ids[i], score[i], gender[i]] for i in range(4)])])
wide_rows = [["variable"] + ids, ["score"] + score, ["respondent_id"] + ids, ["gender"] + gender]
wide = book([("Data", wide_rows)])
csv_path = os.path.join(tmp, "wide.csv")
with open(csv_path, "w") as fh:
    for r in wide_rows: fh.write(",".join(str(v) for v in r) + "\n")
wide_csv = open(csv_path, "rb").read()
out = {}
for key, b, name, layout in (("long", long, "f.xlsx", "rows_are_cases"), ("wide", wide, "f.xlsx", "columns_are_cases"), ("wide_csv", wide_csv, "wide.csv", "columns_are_cases")):
    d = eng.dictionary(b, name, {"layout": layout, "selectedSheet": "Data"})
    out[key] = {"kinds": kinds(d), "ids": codes(b, name, "respondent_id", layout), "mean": None}
    x = eng.crosstab(b, name, {"layout": layout, "selectedSheet": "Data", "columnVars": [], "typeOverrides": {"score": "continuous"},
                               "rowItems": [{"key": "score", "label": "score", "vars": ["score"]}]})
    out[key]["mean"] = x["questions"][0]["rows"][-1]["total"]["pct"]
print(json.dumps(out))
`,
    ) as Record<string, { kinds: unknown[]; ids: [string, number][]; mean: number }>;
    expect(out.wide.ids).toEqual([["001", 1], ["002", 1], ["003", 1], ["004", 1]]);
    expect(out.wide_csv.ids).toEqual(out.wide.ids);
    expect(out.wide.kinds).toEqual(out.long.kinds);
    expect(out.wide_csv.kinds).toEqual(out.long.kinds);
    // respondent_id is text, score numeric, gender text; 4 cases each
    expect(out.long.kinds).toEqual([
      ["gender", false, true, 4],
      ["respondent_id", false, true, 4],
      ["score", true, false, 4],
    ]);
    expect(out.wide.mean).toBe(2.5);
    expect(out.wide_csv.mean).toBe(2.5);
  });
});

describe.skipIf(!PYTHON_OK)("engine: one text form per answer code (rawCode)", () => {
  it("labelled and unlabelled numeric codes give the same rawCode; text and non-integer codes keep their own; a declared unused code keeps its 0 row", () => {
    const out = runDriver(
      PRELUDE +
        String.raw`
data = [["id", "effort", "plain", "textcode", "half"]] + [["%04d" % i, v, v, t, h] for i, (v, t, h) in enumerate(
    [(1, "A01", 1.5), (2, "A02", 2.5), (2, "A01", 1.5), (4, "A02", 2.5), (5, "A01", 1.5)])]
labels = [["variable", "value", "label"]] + [["effort", k, l] for k, l in ((1, "Very easy"), (2, "Easy"), (3, "Neutral"), (4, "Difficult"), (5, "Very difficult"))]
codebook = [["Variable", "Variable label", "Value labels", "Multiple response set"],
            ["effort", "Effort", "1=Very easy; 2=Easy; 3=Neutral; 4=Difficult; 5=Very difficult", None]]
out = {}
for key, sheets in (("labels", [("Data", data), ("Labels", labels)]), ("codebook", [("Data", data), ("Codebook", codebook)])):
    b = book(sheets)
    out[key] = {"effort": codes(b, "f.xlsx", "effort", "rows_are_cases"), "plain": codes(b, "f.xlsx", "plain", "rows_are_cases"),
                "textcode": codes(b, "f.xlsx", "textcode", "rows_are_cases"), "half": codes(b, "f.xlsx", "half", "rows_are_cases")}
print(json.dumps(out))
`,
    ) as Record<string, Record<string, [string, number][]>>;
    for (const key of ["labels", "codebook"]) {
      const o = out[key];
      // Labelled: every declared code, the unobserved 3 as a 0 row, codes written as integers.
      expect(o.effort, key).toEqual([["1", 1], ["2", 2], ["3", 0], ["4", 1], ["5", 1]]);
      // The same codes without labels: same text form, so the two align by rawCode.
      expect(o.plain.map(([c]) => c), key).toEqual(["1", "2", "4", "5"]);
      expect(new Set(o.plain.map(([c]) => c)).size).toBe(4);
      for (const [c] of o.plain) expect(o.effort.map(([e]) => e)).toContain(c);
      // Text codes keep their own text; non-integer numeric codes keep their decimals.
      expect(o.textcode.map(([c]) => c), key).toEqual(["A01", "A02"]);
      expect(o.half.map(([c]) => c), key).toEqual(["1.5", "2.5"]);
    }
  });
});

describe.skipIf(!PYTHON_OK)("engine: whole numbers and identifiers stay exact after a columns-as-cases flip", () => {
  it("values beyond the signed 64-bit range never turn negative; both layouts give the same codes and type", () => {
    const out = runDriver(
      PRELUDE +
        String.raw`
NL = chr(10)
cases = {
    "full": ["9223372036854775808", "9223372036854775809", "9223372036854775808", "9223372036854775809"],
    "gap": ["9223372036854775808", "9223372036854775809", "", "9223372036854775809"],
    "mixed_sign": ["-5", "9223372036854775809", "7", "9223372036854775809"],
    "edge": ["9223372036854775807", "-9223372036854775808", "9223372036854775807", "1"],
}
out = {}
for key, vals in cases.items():
    rows = "account,score" + NL + NL.join(f"{a},{s}" for a, s in zip(vals, [1, 2, 3, 4]))
    wide = "variable,R1,R2,R3,R4" + NL + "account," + ",".join(vals) + NL + "score,1,2,3,4"
    for layout, text in (("rows_are_cases", rows), ("columns_are_cases", wide)):
        b = text.encode()
        d = eng.dictionary(b, "f.csv", {"layout": layout})
        v = [v for v in d["variables"] if v["name"] == "account"][0]
        out[f"{key}/{layout}"] = {"codes": codes(b, "f.csv", "account", layout), "numeric": v["numeric"], "version": d["version"]}
print(json.dumps(out))
`,
    ) as Record<string, { codes: [string, number][]; numeric: boolean; version: number }>;
    const byCase = (k: string) => out[`${k}/columns_are_cases`];
    expect(byCase("full").codes).toEqual([["9223372036854775808", 2], ["9223372036854775809", 2]]);
    expect(byCase("gap").codes).toEqual([["9223372036854775808", 1], ["9223372036854775809", 2]]);
    expect(byCase("mixed_sign").codes).toEqual([["-5", 1], ["7", 1], ["9223372036854775809", 2]]);
    // The int64 boundaries themselves are exact and stay numeric.
    expect(byCase("edge").codes).toEqual([["-9223372036854775808", 1], ["1", 1], ["9223372036854775807", 2]]);
    expect(byCase("edge").numeric).toBe(true);
    for (const k of ["full", "gap", "mixed_sign", "edge"]) {
      const flipped = byCase(k);
      const rows = out[`${k}/rows_are_cases`];
      expect(flipped.version).toBe(10);
      for (const [c] of flipped.codes) expect(c.startsWith("-") && k !== "mixed_sign" && k !== "edge", `${k}: ${c}`).toBe(false);
      // Same values and type as the rows-as-cases read. (A blank cell is a separate, unchanged
      // rows-as-cases difference: there it is listed as an empty code, here as missing.)
      expect(flipped.numeric, k).toBe(rows.numeric);
      expect(flipped.codes.filter(([c]) => c !== ""), k).toEqual(rows.codes.filter(([c]) => c !== ""));
    }
  });

  it("an identifier's surrounding spaces are kept, so ' 001 ' and '001' stay two identifiers, as in rows-as-cases", () => {
    const out = runDriver(
      PRELUDE +
        String.raw`
NL = chr(10)
ids = [" 001 ", "001", "002", "003 "]
rows_csv = ("respondent_id,score" + NL + NL.join(f"{i},{s}" for i, s in zip(ids, [1, 2, 3, 4]))).encode()
wide_csv = ("variable,R1,R2,R3,R4" + NL + "respondent_id," + ",".join(ids) + NL + "score,1,2,3,4").encode()
wide_xlsx = book([("Data", [["variable", "R1", "R2", "R3", "R4"], ["respondent_id"] + ids, ["score", 1, 2, 3, 4]])])
print(json.dumps({
    "rows_csv": codes(rows_csv, "f.csv", "respondent_id", "rows_are_cases"),
    "wide_csv": codes(wide_csv, "f.csv", "respondent_id", "columns_are_cases"),
    "wide_xlsx": codes(wide_xlsx, "f.xlsx", "respondent_id", "columns_are_cases"),
}))
`,
    ) as Record<string, [string, number][]>;
    const want = [[" 001 ", 1], ["001", 1], ["002", 1], ["003 ", 1]];
    expect([...out.wide_csv].sort()).toEqual([...want].sort());
    expect([...out.wide_xlsx].sort()).toEqual([...want].sort());
    expect([...out.rows_csv].sort()).toEqual([...want].sort());
  });
});

describe.skipIf(!PYTHON_OK)("engine: native missing declarations", () => {
  it("SAV declarations survive single/range/control reads without changing masked bases or means; malformed input refuses and retry recovers", () => {
    const out = runDriver(PRELUDE + String.raw`
import pandas as pd, pyreadstat
out = {}
for name, missing, values in [('single', [-99.], [1.,2.,3.,4.,5.,-99.,None]), ('range', [{'lo':-99.,'hi':-98.}], [1.,2.,3.,4.,5.,-99.,-98.,None]), ('ordinary', None, [1.,2.,3.,4.,5.,-99.,None])]:
    p = os.path.join(tmp, name+'.sav')
    kwargs = {'missing_ranges':{'q':missing}} if missing else {}
    pyreadstat.write_sav(pd.DataFrame({'q':values}),p,variable_measure={'q':'ordinal'},variable_value_labels={'q':{1.:'Very dissatisfied',2.:'Dissatisfied',3.:'Neutral',4.:'Satisfied',5.:'Very satisfied',-99.:'Not applicable'}},**kwargs)
    b = open(p,'rb').read()
    d = eng.dictionary(b,name+'.sav',{})
    q = eng.crosstab(b,name+'.sav',{'rowItems':[{'key':'q','label':'q','vars':['q']}],'columnVars':[]})['questions'][0]
    out[name] = {'declared':d['audit']['dk']['declaredMissing'],'valid':d['variables'][0]['nValid'],'base':q['desc']['n'],'mean':q['desc']['mean']}
try:
    eng.dictionary(b'bad SAV bytes','bad.sav',{})
    out['refused'] = False
except Exception:
    out['refused'] = True
out['retry'] = eng.dictionary(open(os.path.join(tmp,'single.sav'),'rb').read(),'single.sav',{})['audit']['dk']['declaredMissing']
print(json.dumps(out))
`) as Record<string, unknown>;
    expect(out.single).toEqual({declared:1,valid:5,base:5,mean:3});
    expect(out.range).toEqual({declared:1,valid:5,base:5,mean:3});
    expect(out.ordinary).toEqual({declared:0,valid:6,base:5,mean:3});
    expect(out.refused).toBe(true);
    expect(out.retry).toBe(1);
  });
});

describe.skipIf(PYTHON_OK)("engine: whole numbers and identifiers stay exact after a columns-as-cases flip", () => {
  it.skip("python3 with pandas/openpyxl/pyreadstat unavailable: engine exactness check NOT RUN", () => {});
});
describe.skipIf(PYTHON_OK)("engine: identifiers keep their text in a columns-as-cases file", () => {
  it.skip("python3 with pandas/openpyxl/pyreadstat unavailable: engine identity check NOT RUN", () => {});
});
describe.skipIf(PYTHON_OK)("engine: one text form per answer code (rawCode)", () => {
  it.skip("python3 with pandas/openpyxl/pyreadstat unavailable: engine code identity check NOT RUN", () => {});
});
