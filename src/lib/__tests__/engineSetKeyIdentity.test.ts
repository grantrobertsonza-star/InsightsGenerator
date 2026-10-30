import { PYTHON } from "./helpers/pythonEngine";
// Question-set identity through the ACTUAL Python engine (api/parse-stats-file.py), found from a
// duplicate React key ("EN9") in Brand Health (Grant, 2026-10-20). Columns sharing one name stem can
// form two sets: the yes/no columns a multiple-response set, the rest a battery or grid. Both took
// the stem as their key, so "set:EN9" named two sets; the engine used the first and a screen's map
// the last. Now every set key in a dictionary is unique: the multiple-response set keeps the stem
// (what the engine already computed with), and the battery or grid that would clash is keyed
// "<stem> (battery)" or "<stem> (grid)". A stem with no clash keeps its key unchanged.
// Skipped, with the reason printed, without python3 + pandas/openpyxl.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const ENGINE = path.join(process.cwd(), "api", "parse-stats-file.py");
const probe = spawnSync(PYTHON, ["-c", "import pandas, openpyxl"], { encoding: "utf8" });
const PYTHON_OK = probe.status === 0;

const DRIVER = String.raw`
import importlib.util, io, json, sys
from openpyxl import Workbook
spec = importlib.util.spec_from_file_location("engine", sys.argv[1]); eng = importlib.util.module_from_spec(spec); spec.loader.exec_module(eng)
def book(sheets):
    wb = Workbook(); wb.remove(wb.active)
    for title, rows in sheets:
        ws = wb.create_sheet(title)
        for r in rows: ws.append(r)
    b = io.BytesIO(); wb.save(b); return b.getvalue()
head = ["id", "EN9_1", "EN9_2", "EN9_3", "EN9_4", "EN9_5", "EN9_6", "Q2_1", "Q2_2"]
rows = [[i, i % 2, (i + 1) % 2, i % 2, 1 + i % 5, 1 + (i + 2) % 5, 1 + (i + 3) % 5, i % 2, (i + 1) % 2] for i in range(1, 41)]
codebook = [["Variable", "Variable label"],
            ["EN9_1", "Channels used - Bank app"], ["EN9_2", "Channels used - USSD"], ["EN9_3", "Channels used - Agent"],
            ["EN9_4", "Trust rating for providers Bank"], ["EN9_5", "Trust rating for providers Post office"], ["EN9_6", "Trust rating for providers Retailer"],
            ["Q2_1", "Owns a phone - Smart"], ["Q2_2", "Owns a phone - Feature"]]
d = eng.dictionary(book([("Data", [head] + rows), ("Codebook", codebook)]), "f.xlsx", {})
print(json.dumps({"sets": [{"key": s["key"], "kind": s["kind"], "vars": s["vars"]} for s in d["sets"]],
                  "inSet": {v["name"]: v.get("inSet") for v in d["variables"]}}))
`;

function run() {
  const dir = mkdtempSync(path.join(tmpdir(), "engine-setkey-"));
  const file = path.join(dir, "driver.py");
  writeFileSync(file, DRIVER);
  const r = spawnSync(PYTHON, ["-I", file, ENGINE], { encoding: "utf8", timeout: 120_000 });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout.trim().split("\n").pop()!) as { sets: { key: string; kind: string; vars: string[] }[]; inSet: Record<string, string | null> };
}

describe.skipIf(!PYTHON_OK)("engine: question-set keys are unique", () => {
  it("keeps the stem for the multiple-response set and keys the clashing battery apart; every member points at its own set", () => {
    const out = run();
    const keys = out.sets.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    const multi = out.sets.find((s) => s.vars.includes("EN9_1"))!;
    const other = out.sets.find((s) => s.vars.includes("EN9_4"))!;
    expect(multi).toMatchObject({ key: "EN9", kind: "multi", vars: ["EN9_1", "EN9_2", "EN9_3"] });
    expect(other.key).toBe(`EN9 (${other.kind})`);
    expect(other.vars).toEqual(["EN9_4", "EN9_5", "EN9_6"]);
    expect(out.inSet.EN9_1).toBe("EN9");
    expect(out.inSet.EN9_5).toBe(other.key);
  });

  it("leaves a stem with no clash under its own key", () => {
    expect(run().sets.find((s) => s.vars.includes("Q2_1"))?.key).toBe("Q2");
  });
});
