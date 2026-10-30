import { PYTHON } from "./helpers/pythonEngine";
// D2b: each group's NPS against the rest of its banner variable, through the ACTUAL engine (crosstab), checked against
// an independent reference recorded in fixtures/reference/nps_groups_reference.json: statsmodels' weighted regression of
// d on a group indicator with a cluster-robust variance (scripts/reference/nps_group_reference.py), not the engine.
// 240 weighted cases in 12 clusters, three groups. Also: Benjamini-Hochberg across the groups, and a group with no
// complement (one column) gets no test.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const ENGINE = path.join(process.cwd(), "api", "parse-stats-file.py");
const PYTHON_OK = spawnSync(PYTHON, ["-c", "import pandas, numpy"], { encoding: "utf8" }).status === 0;
const REF = JSON.parse(readFileSync(path.join(process.cwd(), "fixtures/reference/nps_groups_reference.json"), "utf8")) as Record<"clustered" | "unclustered", Record<string, { difference: number; se: number }>>;

const DRIVER = String.raw`
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("engine", sys.argv[1]); eng = importlib.util.module_from_spec(spec); spec.loader.exec_module(eng)
data = open(sys.argv[2], "rb").read()
out = {}
for name, design in (("clustered", {"psu": "psu"}), ("unclustered", None)):
    args = {"columnVars": ["group"], "rowItems": [{"key": "nps", "label": "nps", "vars": ["nps"]}], "weightVar": "w", "correction": "none"}
    if design: args["design"] = design
    r = eng.crosstab(data, "nps_groups.csv", args)
    out[name] = {"columns": [c["name"] for c in r["columns"]], "tests": r["questions"][0].get("npsGroupTests")}
r = eng.crosstab(data, "nps_groups.csv", {"columnVars": [], "rowItems": [{"key": "nps", "label": "nps", "vars": ["nps"]}], "weightVar": "w", "correction": "none"})
out["oneColumn"] = r["questions"][0].get("npsGroupTests")
print(json.dumps(out))
`;
const run = PYTHON_OK ? spawnSync(PYTHON, ["-I", "-c", DRIVER, ENGINE, path.join(process.cwd(), "fixtures/reference/nps_groups.csv")], { encoding: "utf8", maxBuffer: 1 << 24 }) : null;
type Test = { difference: number; se: number; p: number | null; pAdjusted?: number };
const R = run && run.status === 0 ? JSON.parse(run.stdout) : {};

describe.skipIf(!PYTHON_OK)("NPS group against the rest (D2b, actual engine against an independent reference)", () => {
  it("the driver ran", () => expect(run?.status, run?.stderr).toBe(0));
  for (const kind of ["clustered", "unclustered"] as const) {
    it(`${kind}: each group's difference and standard error equal the reference`, () => {
      const { columns, tests } = R[kind] as { columns: string[]; tests: { method: string; columns: Test[] } };
      expect(tests.method).toBe(kind === "clustered" ? "design" : "with_replacement");
      columns.forEach((g, i) => {
        expect(tests.columns[i].difference, g).toBeCloseTo(REF[kind][g].difference, 3);
        expect(tests.columns[i].se, g).toBeCloseTo(REF[kind][g].se, 3);
      });
    });
  }
  it("Benjamini-Hochberg across the three groups: adjusted p = min over ranks of p x 3 / rank, never below p", () => {
    const ps = (R.clustered.tests.columns as Test[]).map((t) => t.p as number);
    const order = [...ps.keys()].sort((a, b) => ps[a] - ps[b]);
    const adj: number[] = [];
    let running = 1;
    for (let rank = 2; rank >= 0; rank--) {
      running = Math.min(running, (ps[order[rank]] * 3) / (rank + 1));
      adj[order[rank]] = running;
    }
    (R.clustered.tests.columns as Test[]).forEach((t, i) => expect(t.pAdjusted).toBeCloseTo(adj[i], 12));
  });
  it("a table with one column (no group variable) has no group test", () => expect(R.oneColumn ?? null).toBeNull());
});
