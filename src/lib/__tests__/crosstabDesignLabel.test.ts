// A cross-tab finding names the test and the design treatment the engine applied, not the one requested
// (batch 30; found while preparing the calibration round). The engine fills notes.designUsed both when a
// design was applied and when one was requested but every case lacked design data; in the second case it
// falls back to plain Kish standard errors and the normal reference, and says so in notes.designApplied.
// crosstabFindings used designUsed, so those findings said "t-test with design degrees of freedom" and
// carried survey_design_modelled. The actual engine (api/parse-stats-file.py crosstab) produces each
// result; crosstabFindings is the real function. Skipped without python3 + pandas.
import { describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { PYTHON } from "./helpers/pythonEngine";
import type { CrosstabResult } from "../parseStatsFile";

// crosstabs.ts is imported for crosstabFindings alone, which reads no database or storage.
vi.mock("../db", () => ({ withTenant: vi.fn(), withTenantRead: vi.fn() }));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: { storage: { from: vi.fn() } } }));
const { crosstabFindings } = await import("../crosstabs");

const PYTHON_OK = spawnSync(PYTHON, ["-c", "import pandas"], { encoding: "utf8" }).status === 0;

/** The engine's crosstab of y by grp on 400 cases with a clear gap, with design columns psu/str either
 * filled (each case its own PSU, two strata) or entirely empty. */
function engineResult(designColumns: "filled" | "empty"): CrosstabResult {
  const script = String.raw`
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("psf", sys.argv[1]); psf = importlib.util.module_from_spec(spec); spec.loader.exec_module(psf)
rows = ["grp,y,psu,str"]
for i in range(400):
    g = "A" if i % 2 == 0 else "B"
    y = 1 if (g == "A" and i % 10 < 7) or (g == "B" and i % 10 < 3) else 2
    rows.append(f"{g},{y},{i if sys.argv[2] == 'filled' else ''},{i % 2 if sys.argv[2] == 'filled' else ''}")
r = psf.crosstab(("\n".join(rows) + "\n").encode(), "d.csv", {"columnVars": ["grp"], "rowItems": [{"key": "y", "label": "Y", "vars": ["y"]}], "weightVar": None, "design": {"psu": "psu", "strata": "str"}, "correction": "none"})
print(json.dumps(r))
`;
  const out = spawnSync(PYTHON, ["-I", "-c", script, path.resolve("api/parse-stats-file.py"), designColumns], { encoding: "utf8", maxBuffer: 50_000_000 });
  if (out.status !== 0) throw new Error(out.stderr);
  return JSON.parse(out.stdout) as CrosstabResult;
}

describe.skipIf(!PYTHON_OK)("cross-tab findings name the design treatment applied", () => {
  it("a design requested but not applicable (no case has design data): z-test, design not modelled", () => {
    const result = engineResult("empty");
    expect(result.notes?.designUsed).toBeTruthy();
    expect(result.notes?.designApplied).toBe(false);
    const findings = crosstabFindings(result);
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(f.text).toContain("z-test");
      expect(f.text).not.toContain("design degrees of freedom");
      expect(f.stats.caveats).toContain("survey_design_not_modelled");
      expect(f.stats.caveats).not.toContain("survey_design_modelled");
    }
  });

  it("a design applied: t-test with design degrees of freedom, design modelled", () => {
    const result = engineResult("filled");
    expect(result.notes?.designApplied).toBe(true);
    const findings = crosstabFindings(result);
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(f.text).toContain("t-test with design degrees of freedom");
      expect(f.stats.caveats).toContain("survey_design_modelled");
    }
  });
});
