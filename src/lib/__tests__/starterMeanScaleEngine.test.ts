import { PYTHON } from "./helpers/pythonEngine";
// StarterTabs on a 0 to 10 rating (Grant, 2026-10-22: the starter set gave only counts for 10
// point scales). planStarterTables adds a mean row above the answers of a 10 or 11 point scale; here
// the planned row items go through the ACTUAL Python engine (api/parse-stats-file.py crosstab()),
// nothing mocked. Hand-computed reference, an unlabelled 0 to 10 column in a spreadsheet:
//   answers 0,1,2,3,4,5,6,7,8,9,10,10,8 and one blank: sum 73 over 13 answers, mean 5.615385
//   (the blank is not a point). A numbered list of 10 or more points is an ordered scale under the
//   engine's rule, so the mean row is not qualified. A 5 point column (1..5) in the same file gets no
//   mean row from the starter set, and the distribution is kept on the scale.
// Skipped, with the reason printed, when python3 with pandas/openpyxl is unavailable.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { planStarterTables } from "../starterTables";
import type { VariableInfo } from "../parseStatsFile";

const ENGINE = path.join(process.cwd(), "api", "parse-stats-file.py");
const probe = spawnSync(PYTHON, ["-c", "import pandas, openpyxl"], { encoding: "utf8" });
const PYTHON_OK = probe.status === 0;
const SKIP_REASON = `python3 with pandas/openpyxl unavailable: engine checks NOT RUN (${(probe.stderr || String(probe.error ?? "")).trim().split("\n").pop()})`;

const RATING = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 8, null];
const FIVE = [1, 2, 3, 4, 5, 1, 2, 3, 4, 5, 1, 2, 3, 4];
const SEGMENT = ["A", "B", "A", "B", "A", "B", "A", "B", "A", "B", "A", "B", "A", "B"];

const DRIVER = String.raw`
import importlib.util, io, json, sys
from openpyxl import Workbook
spec = importlib.util.spec_from_file_location("engine", sys.argv[1]); eng = importlib.util.module_from_spec(spec); spec.loader.exec_module(eng)
data = json.loads(sys.argv[2]); items = json.loads(sys.argv[3])
wb = Workbook(); ws = wb.active; ws.title = "Data"; ws.append(["id", "Segment", "Rating_0to10", "Five"])
for i in range(len(data["rating"])): ws.append([i + 1, data["segment"][i], data["rating"][i], data["five"][i]])
b = io.BytesIO(); wb.save(b)
out = eng.crosstab(b.getvalue(), "f.xlsx", {"selectedSheet": "Data", "columnVars": ["Segment"], "typeOverrides": {}, "rowItems": items})
print(json.dumps([{"kind": q.get("kind"), "rows": [{"label": r.get("label"), "isMean": bool(r.get("isMean")), "flag": bool(r.get("codesMayBeUnordered")), "value": (r.get("total") or {}).get("pct")} for r in q.get("rows", [])]} for q in out["questions"]]))
`;

describe.skipIf(!PYTHON_OK)("StarterTabs: a 0 to 10 scale gets its mean above the answers (actual engine)", () => {
  if (!PYTHON_OK) console.warn(SKIP_REASON);
  const v = (name: string, extra: Partial<VariableInfo>): VariableInfo => ({ name, label: name, numeric: true, nValid: 14, pctValid: 100, nDistinct: 2, labelled: false, weightLike: false, ...extra });
  const plan = planStarterTables({
    nCases: 14,
    variables: [
      v("Segment", { numeric: false, text: true, nDistinct: 2 }),
      v("Rating_0to10", { nDistinct: 11, nValid: 13, pctValid: 92.9 }),
      v("Five", { nDistinct: 5 }),
    ],
  });
  const script = path.join(mkdtempSync(path.join(tmpdir(), "starter-mean-")), "driver.py");
  writeFileSync(script, DRIVER);
  const r = spawnSync(PYTHON, ["-I", script, ENGINE, JSON.stringify({ rating: RATING, five: FIVE, segment: SEGMENT }), JSON.stringify(plan.items)], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const out: { kind: string; rows: { label: string; isMean: boolean; flag: boolean; value: number | null }[] }[] = r.status === 0 ? JSON.parse(r.stdout) : [];

  it("plans Segment as the banner, a mean row on the 0 to 10 scale only", () => {
    expect(plan.banners.map((b) => b.name)).toEqual(["Segment"]);
    expect(plan.items.map((i) => [i.key, (i.groups ?? []).map((g) => g.kind)])).toEqual([["Rating_0to10", ["mean"]], ["Five", []]]);
    expect(plan.meanScales).toBe(1);
  });
  it("driver ran", () => expect(r.status, r.stderr).toBe(0));
  it("the hand-computed mean, unqualified, above the answers with the distribution kept", () => {
    const rows = out[0].rows;
    const mean = rows.filter((x) => x.isMean);
    expect(mean).toHaveLength(1);
    expect(mean[0].label).toBe("Mean score: Rating_0to10");
    expect(mean[0].flag).toBe(false);
    expect(mean[0].value).toBeCloseTo(73 / 13, 2);
    // The answers follow the mean, all eleven kept (labelled "0.0" .. "10.0": a blank makes the
    // column float, an existing labelling of unlabelled codes, unchanged here).
    const labels = rows.map((x) => x.label);
    const meanAt = labels.indexOf("Mean score: Rating_0to10");
    const answers = rows.filter((x) => !x.isMean && !/^Base/.test(x.label)).map((x) => Number(x.label));
    expect(answers).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(meanAt).toBe(labels.findIndex((l) => !/^Base/.test(l)));
  });
  it("the 5 point column keeps its answers and gets no mean row", () => {
    expect(out[1].rows.some((x) => x.isMean)).toBe(false);
  });
});
