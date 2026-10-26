import { PYTHON } from "./helpers/pythonEngine";
// The mean row a plain-English mean request builds (crosstabAsk.ts meanGroupFor), run through the
// ACTUAL Python engine (api/parse-stats-file.py crosstab()); nothing is mocked. Independent,
// hand-computed references:
//   codes 1,2,2,3,4,5,5 plus two "Don't know" (9) and one blank, labels "1".."5" (a 5-point
//     numbered list is not an ordered scale under the engine's rule, so its row is qualified):
//     unweighted mean 22 / 7 = 3.142857 (don't know and the blank are not points)
//     weights 1,2,1,1,2,1,2 (don't know weighted 3 and 1, the blank 5):
//     weighted mean (1+4+2+3+8+5+10) / 10 = 33 / 10 = 3.3
//   weights doubled: still 3.3 (a weighted mean does not depend on the weights' scale)
//   worded codes North=1 .. West=4, answers 1,1,2,4,1,1,2,4,1,1: mean 18 / 10 = 1.8, and the row
//     label carries the qualification (not an ordered scale)
//   satisfaction worded Very dissatisfied=1 .. Very satisfied=5 (the golden fixture's wording),
//     same answers as the numbered case: 22 / 7, no qualification (an ordered scale)
//   a .sav declaring the numbered scale nominal: qualified, figure unchanged
//   the same region mean built without qualifyCodes (a Builder group): its label as before
// Also checks the row sits above the answers with the distribution kept, and that
// tabulatedAsAverage agrees with the engine's own branch at 25 and 26 distinct values.
// Skipped, with the reason printed, when python3 with pandas/openpyxl/pyreadstat is unavailable.
import { describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
// Only the pure mapping is used; its module's data and model clients are not reached.
vi.mock("../anthropic", () => ({ anthropic: {}, CLAUDE_MODEL: "unused" }));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn() }));
vi.mock("../crosstabs", () => ({ loadCategories: vi.fn(), loadVariableDictionary: vi.fn() }));
vi.mock("../variableOverrides", () => ({ loadVariableOverrides: vi.fn() }));
import { meanGroupFor, tabulatedAsAverage, UNORDERED_MEAN_NOTE } from "../crosstabAsk";

const ENGINE = path.join(process.cwd(), "api", "parse-stats-file.py");
const probe = spawnSync(PYTHON, ["-c", "import pandas, openpyxl, pyreadstat"], { encoding: "utf8" });
const PYTHON_OK = probe.status === 0;
const SKIP_REASON = `python3 with pandas/openpyxl/pyreadstat unavailable: engine checks NOT RUN (${(probe.stderr || String(probe.error ?? "")).trim().split("\n").pop()})`;

const DRIVER = String.raw`
import importlib.util, io, json, os, sys, tempfile
import pandas as pd, pyreadstat
from openpyxl import Workbook
spec = importlib.util.spec_from_file_location("engine", sys.argv[1]); eng = importlib.util.module_from_spec(spec); spec.loader.exec_module(eng)
groups = json.loads(sys.argv[2])
SAT = [1, 2, 2, 3, 4, 5, 5, 9, 9, None]
W   = [1, 2, 1, 1, 2, 1, 2, 3, 1, 5]
REGION = [1, 1, 2, 4, 1, 1, 2, 4, 1, 1]
def book(weights):
    wb = Workbook(); ws = wb.active; ws.title = "Data"
    ws.append(["id", "sat", "region", "w", "satw"])
    for i in range(len(SAT)): ws.append([i + 1, SAT[i], REGION[i], weights[i], SAT[i]])
    lab = wb.create_sheet("Labels"); lab.append(["variable", "value", "value label"])
    for k in range(1, 6): lab.append(["sat", k, str(k)])
    lab.append(["sat", 9, "Don't know"])
    for k, t in enumerate(["Very dissatisfied", "Dissatisfied", "Neutral", "Satisfied", "Very satisfied"], 1): lab.append(["satw", k, t])
    lab.append(["satw", 9, "Don't know"])
    for k, t in enumerate(["North", "South", "East", "West"], 1): lab.append(["region", k, t])
    b = io.BytesIO(); wb.save(b); return b.getvalue()
def many(n):
    wb = Workbook(); ws = wb.active; ws.title = "Data"; ws.append(["id", "x"])
    for i in range(n): ws.append([i + 1, i + 1])
    b = io.BytesIO(); wb.save(b); return b.getvalue()
def sav_nominal():
    d = tempfile.mkdtemp(); p = os.path.join(d, "f.sav")
    vals = [float(x) if x is not None else float("nan") for x in SAT]
    pyreadstat.write_sav(pd.DataFrame({"id": [float(i + 1) for i in range(len(SAT))], "sat": vals}), p,
                         variable_value_labels={"sat": {**{float(k): str(k) for k in range(1, 6)}, 9.0: "Don't know"}}, variable_measure={"sat": "nominal"})
    return open(p, "rb").read()
def q(b, items, weight=None, name="f.xlsx"):
    opts = {"selectedSheet": "Data", "columnVars": [], "typeOverrides": {}, "rowItems": items}
    if weight: opts["weightVar"] = weight
    out = eng.crosstab(b, name, opts)
    return [{"kind": x.get("kind"), "rows": [{"label": r.get("label"), "isMean": bool(r.get("isMean")), "flag": bool(r.get("codesMayBeUnordered")), "value": (r.get("total") or {}).get("pct")} for r in x.get("rows", [])]} for x in out["questions"]]
sat_item = {"key": "sat", "label": "Overall satisfaction", "vars": ["sat"], "groups": [groups["sat"]]}
region_item = {"key": "region", "label": "Region", "vars": ["region"], "groups": [groups["region"]]}
satw_item = {"key": "satw", "label": "Satisfaction in words", "vars": ["satw"], "groups": [groups["satw"]]}
plain = dict(groups["region"]); plain.pop("qualifyCodes")
builder_item = {"key": "region", "label": "Region", "vars": ["region"], "groups": [plain]}
print(json.dumps({
  "unweighted": q(book(W), [sat_item, region_item, satw_item]),
  "builder": q(book(W), [builder_item]),
  "nominal": q(sav_nominal(), [sat_item], None, "f.sav"),
  "weighted": q(book(W), [sat_item], "w"),
  "doubled": q(book([2 * x for x in W]), [sat_item], "w"),
  "many25": q(many(25), [{"key": "x", "label": "x", "vars": ["x"]}])[0]["kind"],
  "many26": q(many(26), [{"key": "x", "label": "x", "vars": ["x"]}])[0]["kind"],
}))
`;

type Row = { label: string; isMean: boolean; flag: boolean; value: number | null };
type Q = { kind: string; rows: Row[] };

describe.skipIf(!PYTHON_OK)("a requested mean row through the engine", () => {
  if (!PYTHON_OK) console.warn(SKIP_REASON);
  const groups = { sat: meanGroupFor("Overall satisfaction"), region: meanGroupFor("Region"), satw: meanGroupFor("Satisfaction in words") };
  const script = path.join(mkdtempSync(path.join(tmpdir(), "ask-mean-")), "driver.py");
  writeFileSync(script, DRIVER);
  const r = spawnSync(PYTHON, ["-I", script, ENGINE, JSON.stringify(groups)], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const out: { unweighted: Q[]; weighted: Q[]; doubled: Q[]; builder: Q[]; nominal: Q[]; many25: string; many26: string } = r.status === 0 ? JSON.parse(r.stdout) : ({} as never);
  const meanOf = (q: Q) => q.rows.filter((x) => x.isMean);
  it("driver ran", () => expect(r.status, r.stderr).toBe(0));

  it("unweighted: the hand-computed mean, don't know and blanks left out", () => {
    const [m] = meanOf(out.unweighted[0]);
    expect(m.label).toBe(`Mean score: Overall satisfaction (${UNORDERED_MEAN_NOTE})`);
    expect(m.value).toBeCloseTo(22 / 7, 2);
  });
  it("the mean row is above the answers and the distribution is kept", () => {
    const labels = out.unweighted[0].rows.map((x) => x.label);
    const first = labels.findIndex((l) => l === "1");
    expect(labels.indexOf(`Mean score: Overall satisfaction (${UNORDERED_MEAN_NOTE})`)).toBe(first - 1);
    expect(labels).toEqual(expect.arrayContaining(["1", "2", "3", "4", "5"]));
  });
  it("weighted: the hand-computed weighted mean, unchanged when the weights are doubled", () => {
    expect(meanOf(out.weighted[0])[0].value).toBeCloseTo(3.3, 2);
    expect(meanOf(out.doubled[0])[0].value).toBeCloseTo(3.3, 2);
  });
  it("worded codes: the mean of the codes, with the qualification in the row label", () => {
    const [m] = meanOf(out.unweighted[1]);
    expect(m.label).toBe(`Mean score: Region (${UNORDERED_MEAN_NOTE})`);
    expect(m.flag).toBe(true);
    expect(m.value).toBeCloseTo(18 / 10, 2);
    expect(out.unweighted[1].rows.map((x) => x.label)).toEqual(expect.arrayContaining(["North", "South", "West"]));
  });
  it("a worded satisfaction scale is an ordered scale: same mean, no qualification", () => {
    const [m] = meanOf(out.unweighted[2]);
    expect(m.label).toBe("Mean score: Satisfaction in words");
    expect(m.value).toBeCloseTo(22 / 7, 2);
  });
  it("a file that declares the scale nominal: qualified, figure unchanged", () => {
    const [m] = meanOf(out.nominal[0]);
    expect(m.label).toBe(`Mean score: Overall satisfaction (${UNORDERED_MEAN_NOTE})`);
    expect(m.value).toBeCloseTo(22 / 7, 2);
  });
  it("a mean group without qualifyCodes keeps its label as before", () => {
    const [m] = meanOf(out.builder[0]);
    expect(m.label).toBe("Mean score: Region");
    expect(m.value).toBeCloseTo(1.8, 2);
  });
  it("tabulatedAsAverage agrees with the engine at 25 and 26 distinct values", () => {
    expect(out.many25).toBe("single");
    expect(tabulatedAsAverage({ numeric: true, labelled: false, nDistinct: 25 }, undefined)).toBe(false);
    expect(out.many26).toBe("numeric");
    expect(tabulatedAsAverage({ numeric: true, labelled: false, nDistinct: 26 }, undefined)).toBe(true);
  });
});
