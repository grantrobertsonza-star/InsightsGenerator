import { PYTHON } from "./helpers/pythonEngine";
// IMP-015 against the ACTUAL Python engine (api/parse-stats-file.py, dictionary() and
// categories()), run through python3 with workbooks built in memory. Nothing is mocked.
// Acceptance (release baseline): two sheets define q / code 1 as "Yes" and "No" -> the conflict
// must not silently reverse meaning; it is shown wherever the category appears, counts are
// unchanged, and label-sheet names matching no data column are diagnosed.
// Skipped, with the reason printed, when python3 with pandas/openpyxl/pyreadstat is unavailable.
import { describe, expect, it } from "vitest";
import { CURRENT_DICTIONARY_VERSION } from "../dictionaryVersion";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const ENGINE = path.join(process.cwd(), "api", "parse-stats-file.py");
const probe = spawnSync(PYTHON, ["-c", "import pandas, openpyxl, pyreadstat"], { encoding: "utf8" });
const PYTHON_OK = probe.status === 0;
const SKIP_REASON = `python3 with pandas/openpyxl/pyreadstat unavailable: engine checks NOT RUN (${(probe.stderr || String(probe.error ?? "")).trim().split("\n").pop()})`;

const DRIVER = String.raw`
import importlib.util, io, json, sys
from openpyxl import Workbook
spec = importlib.util.spec_from_file_location("engine", sys.argv[1]); eng = importlib.util.module_from_spec(spec); spec.loader.exec_module(eng)
def book(sheets):
    wb = Workbook(); wb.remove(wb.active)
    for name, rows in sheets:
        ws = wb.create_sheet(name)
        for r in rows: ws.append(r)
    b = io.BytesIO(); wb.save(b); return b.getvalue()
DATA = ["Data", [["id", "q", "r"], ["001", 1, 1], ["002", 1, 2], ["003", 1, 1], ["004", 2, 2]]]
LAB = lambda name, rows: [name, [["variable", "value", "value label"]] + rows]
CASES = {
  "conflict": book([DATA, LAB("Labels A", [["q", 1, "Yes"], ["q", 2, "No"]]), LAB("Labels B", [["q", 1, "No"], ["q", 2, "Yes"]])]),
  "control": book([DATA, LAB("Labels A", [["q", 1, "Yes"], ["q", 2, "No"]])]),
  "agree": book([DATA, LAB("Labels A", [["q", 1, "Yes"], ["q", 2, "No"]]), LAB("Labels B", [["q", 1, "Yes"], ["q", 2, "No"]])]),
  "partial": book([DATA, LAB("Labels A", [["q", 1, "Yes"], ["q", 2, "No"]]), LAB("Labels B", [["q", 1, "Yes"], ["q", 2, "Maybe"]])]),
  "codebook_vs_sheet": book([DATA, LAB("Labels A", [["r", 1, "Agree"], ["r", 2, "Disagree"]]),
                             ["Codebook", [["Variable", "Variable label", "Response codes"], ["r", "Do you agree?", "1=Disagree; 2=Agree"]]]]),
  "unmatched": book([DATA, LAB("Labels A", [["q", 1, "Yes"], ["q", 2, "No"], ["q_old", 1, "Yes"]])]),
}
out = {}
for name, b in CASES.items():
    d = eng.dictionary(b, "f.xlsx", {})
    out[name] = {
        "variables": {v["name"]: v.get("label") for v in d["variables"]},
        "labelConflicts": d.get("labelConflicts"),
        "unmatched": d.get("unmatchedLabelVariables"),
        "version": d.get("version"),
        "q": eng.categories(b, "f.xlsx", "q")["categories"],
        "r": eng.categories(b, "f.xlsx", "r")["categories"],
    }
print(json.dumps(out))
`;

type Case = {
  variables: Record<string, string>;
  labelConflicts: { variable: string; kind: string; value?: number; keptSheet?: string; discardedSheet?: string; resolution?: string }[] | null;
  unmatched: string[] | null;
  version: number;
  q: { label: string; n: number }[];
  r: { label: string; n: number }[];
};

function runEngine(): Record<string, Case> {
  const dir = mkdtempSync(path.join(tmpdir(), "imp015-"));
  const driver = path.join(dir, "driver.py");
  writeFileSync(driver, DRIVER);
  const r = spawnSync(PYTHON, ["-I", driver, ENGINE], { encoding: "utf8", maxBuffer: 10_000_000, timeout: 120_000 });
  if (r.status !== 0) throw new Error(`engine run failed: ${r.stderr}`);
  return JSON.parse(r.stdout.trim().split("\n").pop()!);
}

describe.skipIf(!PYTHON_OK)("IMP-015: conflicting label definitions (actual engine)", () => {
  const result = PYTHON_OK ? runEngine() : ({} as Record<string, Case>);

  it("two sheets defining code 1 as Yes and No: both shown on the code, nothing silently chosen, counts unchanged", () => {
    const c = result.conflict;
    expect(c.q).toEqual([
      { label: '1 [conflicting labels: "Yes" / "No"]', n: 3 },
      { label: '2 [conflicting labels: "No" / "Yes"]', n: 1 },
    ]);
    expect(c.q.map((x) => x.label).some((l) => l === "Yes" || l === "No")).toBe(false);
    const code1 = c.labelConflicts!.find((x) => x.kind === "value_label" && x.value === 1)!;
    expect(code1).toMatchObject({ variable: "q", keptSheet: "Labels B", discardedSheet: "Labels A", resolution: "shown_as_conflict" });
    const code2 = c.labelConflicts!.find((x) => x.kind === "value_label" && x.value === 2)!;
    expect(code2).toMatchObject({ keptSheet: "Labels B", discardedSheet: "Labels A" });
    expect(c.version).toBe(CURRENT_DICTIONARY_VERSION); // The current dictionary release.
  });

  it("control: one label sheet keeps its labels, no conflict, and the question is not titled with an answer label", () => {
    const c = result.control;
    expect(c.q).toEqual([{ label: "Yes", n: 3 }, { label: "No", n: 1 }]);
    expect(c.labelConflicts).toBeNull();
    expect(c.variables.q).toBe("q");
  });

  it("two sheets that agree are not a conflict", () => {
    expect(result.agree.labelConflicts).toBeNull();
    expect(result.agree.q.map((x) => x.label)).toEqual(["Yes", "No"]);
  });

  it("only the codes that disagree are marked; agreeing codes keep their labels", () => {
    expect(result.partial.q).toEqual([
      { label: "Yes", n: 3 },
      { label: '2 [conflicting labels: "No" / "Maybe"]', n: 1 },
    ]);
  });

  it("a codebook that reverses a label sheet is shown as a conflict too", () => {
    const labels = result.codebook_vs_sheet.r.map((x) => x.label).sort();
    expect(labels).toEqual(['1 [conflicting labels: "Agree" / "Disagree"]', '2 [conflicting labels: "Disagree" / "Agree"]'].sort());
    expect(result.codebook_vs_sheet.variables.r).toBe("Do you agree?");
  });

  it("label-sheet names that match no data column are diagnosed", () => {
    expect(result.unmatched.unmatched).toEqual(["q_old"]);
    expect(result.unmatched.q.map((x) => x.label)).toEqual(["Yes", "No"]);
  });
});

describe.skipIf(PYTHON_OK)("IMP-015: conflicting label definitions (actual engine)", () => {
  it.skip(SKIP_REASON, () => {});
});
