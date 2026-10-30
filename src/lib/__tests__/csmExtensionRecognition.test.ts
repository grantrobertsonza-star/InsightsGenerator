// R6 CSM extension: the existing tracker recogniser on the expanded CSM Relationship workbooks (both sectors), built
// from each workbook's own embedded Codebook and Labels sheets (read with openpyxl). The extension's fields are never
// a company role: overall satisfaction is company_csat5 (not journey_csat5 or benchmark_csat5), the company question
// is company (not benchmark_provider), and the benchmark's channel list is not taken as a brand list. Before the
// exclusion the expanded workbook had three satisfaction candidates and a channel "brand list", so the Company tiles
// showed no satisfaction and no split by company. The combined pack's channel blocks (ch01_ to ch04_) repeat the task
// reason list in every block, which was read as a brand list ("Payment or transfer" ... named in each block's reason
// wording); a channel block is never a brand list.
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
  it("a Channel file or the noncustomer supplement gives no company CSM role (their agent and alternative ratings are not the company's)", () => {
    for (const file of ["csm/banking/Banking_CSM_Channel_Wave_1.xlsx", "csm/mobile/Mobile_CSM_Channel_Wave_1.xlsx", "csm/banking/Banking_CSM_Noncustomer_Wave_1.xlsx"]) {
      const rec = recogniseTracker(roleVariables(path.join(process.cwd(), "fixtures", "packs-2026-10-30", file)));
      expect(rec.csm, file).toMatchObject({ overallSatisfaction: null, recommend0to10: null, likelyToStay: null, likelyToSwitch: null, company: null });
      expect(rec.csm.drivers, file).toEqual([]);
      expect(rec.type, file).not.toBe("csm");
    }
  });
  for (const [sector, prefix, file] of [
    ["banking", "Banking", "csm/banking/Banking_CSM_Relationship_Wave_1.xlsx"],
    ["mobile", "Mobile", "csm/mobile/Mobile_CSM_Relationship_Wave_1.xlsx"],
    ["banking combined", "Banking", "csm-combined/banking/data/Banking_CSM_Combined_Wave_1.xlsx"],
    ["mobile combined", "Mobile", "csm-combined/mobile/data/Mobile_CSM_Combined_Wave_1.xlsx"],
  ] as const) {
    it(`${sector}: company roles from the company questions only`, () => {
      void prefix;
      const rec = recogniseTracker(roleVariables(path.join(process.cwd(), "fixtures", "packs-2026-10-30", file)));
      expect(rec.frame).toBeNull();
      expect(rec.type).toBe("csm");
      expect(rec.csm).toMatchObject({ overallSatisfaction: "company_csat5", recommend0to10: "recommend_0to10", likelyToStay: "continue5", likelyToSwitch: "switch_0to10", company: "company" });
      expect(rec.csm.drivers).toEqual(["company_driver_d01", "company_driver_d02", "company_driver_d03", "company_driver_d04", "company_driver_d05", "company_driver_d06"]);
      expect(rec.questions.filter((q) => q.id.startsWith("csm:"))).toEqual([]);
    });
  }
});
