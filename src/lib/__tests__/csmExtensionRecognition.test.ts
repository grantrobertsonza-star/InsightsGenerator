// R6 CSM extension: the existing tracker recogniser on the expanded CSM Relationship workbooks (both sectors), built
// from each workbook's own embedded Codebook and Labels sheets (read with openpyxl). The extension's fields are never
// a company role: overall satisfaction is company_csat5 (not journey_csat5 or benchmark_csat5), the company question
// is company (not benchmark_provider), and the benchmark's channel list is not taken as a brand list. Before the
// exclusion the expanded workbook had three satisfaction candidates and a channel "brand list", so the Company tiles
// showed no satisfaction and no split by company.
import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { recogniseTracker, type RoleVariable } from "../trackerRoles";
import { PYTHON } from "./helpers/pythonEngine";

const PYTHON_OK = spawnSync(PYTHON, ["-c", "import openpyxl"], { encoding: "utf8" }).status === 0;
const READ = `import json,sys,openpyxl
wb=openpyxl.load_workbook(sys.argv[1],read_only=True,data_only=True)
cb=[dict(zip(r[0],x)) for r in [list(wb['Codebook'].iter_rows(values_only=True))] for x in r[1:]]
lab={}
for v,_,code,l in list(wb['Labels'].iter_rows(values_only=True))[1:]:
  lab.setdefault(v,{})[str(code)]=l
print(json.dumps({'codebook':cb,'labels':lab}))`;
const TYPE: Record<string, RoleVariable["questionType"]> = { categorical: "categorical", "multiple response": "multiple_response", scale: "scale", continuous: "continuous", text: "text" };

function roleVariables(file: string): RoleVariable[] {
  const { codebook, labels } = JSON.parse(execFileSync(PYTHON, ["-I", "-c", READ, file], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 })) as { codebook: Record<string, string | null>[]; labels: Record<string, Record<string, string>> };
  return codebook.map((c) => ({
    name: c.variable as string,
    label: c.label as string,
    ...(labels[c.variable as string] ? { valueLabels: labels[c.variable as string] } : {}),
    questionId: c.question,
    questionType: TYPE[c.question_type as string] ?? null,
    group: c.mr_set || null,
    numeric: c.data_type === "numeric",
    weightLike: c.variable === "weight",
    text: c.data_type === "text",
  }));
}

describe.skipIf(!PYTHON_OK)("the existing CSM recogniser on the expanded Relationship workbooks", () => {
  for (const [sector, prefix] of [["banking", "Banking"], ["mobile", "Mobile"]] as const) {
    it(`${sector}: company roles from the company questions only`, () => {
      const rec = recogniseTracker(roleVariables(path.join(process.cwd(), "fixtures", "packs-2026-10-30", "csm", sector, `${prefix}_CSM_Relationship_Wave_1.xlsx`)));
      expect(rec.frame).toBeNull();
      expect(rec.type).toBe("csm");
      expect(rec.csm).toMatchObject({ overallSatisfaction: "company_csat5", recommend0to10: "recommend_0to10", likelyToStay: "continue5", likelyToSwitch: "switch_0to10", company: "company" });
      expect(rec.csm.drivers).toEqual(["company_driver_d01", "company_driver_d02", "company_driver_d03", "company_driver_d04", "company_driver_d05", "company_driver_d06"]);
      expect(rec.questions.filter((q) => q.id.startsWith("csm:"))).toEqual([]);
    });
  }
});
