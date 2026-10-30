import { PYTHON } from "./helpers/pythonEngine";
// IMP-004, owner decision 2026-10-17: a numbered rating scale of 10 points or more (0 to 10, 1 to
// 10) gets a mean by default, even when its value labels are bare numbers. Before this rule the
// engine showed a mean only for scales with worded labels ("Agree", "Satisfied", ...) or an
// ordinal measurement level, so the golden fixture's Recommend (0 to 10, labels "0".."10") had no
// mean at all. Run against the ACTUAL Python engine (api/parse-stats-file.py crosstab()); nothing
// is mocked. Hand-computed references:
//   answers 0,5,7,8,9,10,10,3 -> mean 52 / 8 = 6.5
//   the same with two "Don't know" (99) answers -> still 6.5 (don't know is not a point)
// Controls that must stay without a mean: a 9-point numbered scale, a numbered list of named
// categories, and a 0 to 10 question the file declares nominal.
// Unlabelled codes (Grant, 2026-10-22: a spreadsheet's 0 to 10 ratings got no mean): the codes are
// read as the numbered list when there are no value labels, so answers 0..10 plus 10 and 8 have the
// mean 73 / 13; an unlabelled column with fewer than 10 distinct codes (1..9, or a 0 to 10 scale on
// which only 7 values were given) gets none.
// Skipped, with the reason printed, when python3 with pandas/openpyxl/pyreadstat is unavailable.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const ENGINE = path.join(process.cwd(), "api", "parse-stats-file.py");
const probe = spawnSync(PYTHON, ["-c", "import pandas, openpyxl, pyreadstat"], { encoding: "utf8" });
const PYTHON_OK = probe.status === 0;
const SKIP_REASON = `python3 with pandas/openpyxl/pyreadstat unavailable: engine checks NOT RUN (${(probe.stderr || String(probe.error ?? "")).trim().split("\n").pop()})`;

const DRIVER = String.raw`
import importlib.util, io, json, os, sys, tempfile
import pandas as pd, pyreadstat
from openpyxl import Workbook
spec = importlib.util.spec_from_file_location("engine", sys.argv[1]); eng = importlib.util.module_from_spec(spec); spec.loader.exec_module(eng)
ANSWERS = [0, 5, 7, 8, 9, 10, 10, 3]
def book(values, labels):
    wb = Workbook(); ws = wb.active; ws.title = "Data"
    ws.append(["id", "q"])
    for i, v in enumerate(values): ws.append([i + 1, v])
    if labels is not None:
        lab = wb.create_sheet("Labels"); lab.append(["variable", "value", "value label"])
        for code, text in labels: lab.append(["q", code, text])
    b = io.BytesIO(); wb.save(b); return b.getvalue()
def sav(values, labels, measure):
    d = tempfile.mkdtemp(); p = os.path.join(d, "f.sav")
    pyreadstat.write_sav(pd.DataFrame({"id": [float(i + 1) for i in range(len(values))], "q": [float(v) for v in values]}), p,
                         variable_value_labels={"q": {float(k): t for k, t in labels}}, variable_measure={"q": measure})
    return open(p, "rb").read()
def run(b, name, overrides=None):
    q = eng.crosstab(b, name, {"selectedSheet": "Data", "columnVars": [], "typeOverrides": overrides or {}, "rowItems": [{"key": "q", "label": "q", "vars": ["q"]}]})["questions"][0]
    avg = [r for r in q.get("rows", []) if r.get("isMean")]
    return {"kind": q.get("kind"), "mean": (q.get("desc") or {}).get("mean"), "average": avg[0]["total"]["pct"] if avg else None}
bare = [(k, str(k)) for k in range(11)]
anchored = [(0, "0 - Not at all likely")] + [(k, str(k)) for k in range(1, 10)] + [(10, "10 = Extremely likely")]
cases = {
  "bare_0_10": run(book(ANSWERS, bare), "f.xlsx"),
  "bare_1_10": run(book([1, 5, 7, 8, 9, 10, 10, 3], [(k, str(k)) for k in range(1, 11)]), "f.xlsx"),
  "anchored_0_10": run(book(ANSWERS, anchored), "f.xlsx"),
  "with_dont_know": run(book(ANSWERS + [99, 99], bare + [(99, "Don't know")]), "f.xlsx"),
  "unlabelled_continuous": run(book(ANSWERS, None), "f.xlsx", {"q": "continuous"}),
  "bare_1_9": run(book([1, 5, 7, 8, 9, 9, 2, 3], [(k, str(k)) for k in range(1, 10)]), "f.xlsx"),
  "numbered_names": run(book([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], [(k, f"{k}. Region {chr(64 + k)}") for k in range(1, 13)]), "f.xlsx"),
  "declared_nominal": run(sav(ANSWERS, bare, "nominal"), "f.sav"),
  "declared_scale_sav": run(sav(ANSWERS, bare, "scale"), "f.sav"),
  "unlabelled_0_10": run(book(list(range(11)) + [10, 8], None), "f.xlsx"),
  "unlabelled_few_codes": run(book(ANSWERS, None), "f.xlsx"),
  "unlabelled_1_9": run(book(list(range(1, 10)) + [9], None), "f.xlsx"),
}
print(json.dumps(cases))
`;

type Case = { kind: string; mean: number | null; average: number | null };

describe.skipIf(!PYTHON_OK)("numbered rating scales of 10+ points get a mean (IMP-004)", () => {
  if (!PYTHON_OK) console.warn(SKIP_REASON);
  const script = path.join(mkdtempSync(path.join(tmpdir(), "numbered-scale-")), "driver.py");
  writeFileSync(script, DRIVER);
  const r = spawnSync(PYTHON, ["-I", script, ENGINE], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const cases: Record<string, Case> = r.status === 0 ? JSON.parse(r.stdout) : {};
  it("driver ran", () => expect(r.status, r.stderr).toBe(0));

  it("a 0 to 10 scale with bare numeric labels has the hand-computed mean", () => {
    expect(cases.bare_0_10.mean).toBeCloseTo(6.5, 6);
  });
  it("a 1 to 10 scale (exactly 10 points) has a mean", () => {
    expect(cases.bare_1_10.mean).toBeCloseTo(53 / 8, 6);
  });
  it("anchor wording on the two end points still counts as a numbered scale", () => {
    expect(cases.anchored_0_10.mean).toBeCloseTo(6.5, 6);
  });
  it("don't know is excluded from the points and from the mean", () => {
    expect(cases.with_dont_know.mean).toBeCloseTo(6.5, 6);
  });
  it("the labelled scale's mean equals the same answers read as a continuous number", () => {
    // Unlabelled codes with few distinct values stay categories (unchanged; the researcher can
    // declare them continuous). Both routes must give one number for the same answers.
    expect(cases.unlabelled_continuous.average).toBeCloseTo(6.5, 6);
    expect(cases.unlabelled_continuous.average).toBeCloseTo(cases.bare_0_10.mean as number, 6);
  });
  it("an SPSS file whose measure is the default 'scale' follows the same rule", () => {
    expect(cases.declared_scale_sav.mean).toBeCloseTo(6.5, 6);
  });
  it("controls: a 9-point numbered scale, numbered named categories and a declared nominal question get no mean", () => {
    expect(cases.bare_1_9.mean).toBeNull();
    expect(cases.numbered_names.mean).toBeNull();
    expect(cases.declared_nominal.mean).toBeNull();
  });
  it("an unlabelled column of whole-number codes with 10 or more values is read as a numbered scale", () => {
    expect(cases.unlabelled_0_10.mean).toBeCloseTo(73 / 13, 2); // the engine reports the mean to 3 decimals
    expect(cases.unlabelled_few_codes.mean).toBeNull();
    expect(cases.unlabelled_1_9.mean).toBeNull();
  });
});
