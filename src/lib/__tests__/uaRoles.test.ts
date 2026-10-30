import { beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { PYTHON } from "./helpers/pythonEngine";
import { recogniseTracker } from "../trackerRoles";
import { recogniseUa } from "../uaRoles";
import { planUaMetrics } from "../uaMetrics";
import type { UaField } from "../uaTypes";

export function actualUaFields(): UaField[] {
  const code = `import importlib.util,json\nfrom pathlib import Path\ns=importlib.util.spec_from_file_location('e','api/parse-stats-file.py');e=importlib.util.module_from_spec(s);s.loader.exec_module(e)\np=Path('fixtures/ua-soft-drinks/UA_Soft_Drinks_Master_Codebook.xlsx')\nprint(json.dumps(e.codebook_items(p.read_bytes(),p.name)['items']))`;
  const out = spawnSync(PYTHON, ["-c", code], { encoding: "utf8", maxBuffer: 12 * 1024 * 1024, timeout: 180_000, windowsHide: true });
  if (out.status !== 0) throw new Error(out.stderr || out.error?.message || "Codebook read failed");
  const items = JSON.parse(out.stdout) as { variable: string; label: string; questionId: string; options: UaField["options"]; researchMeta: UaField["meta"] }[];
  return items.map(i => ({ variable: i.variable, label: i.label, questionId: i.questionId, options: i.options, meta: i.researchMeta }));
}
let fields: UaField[];
beforeAll(() => { fields = actualUaFields(); }, 200_000);
describe("U&A semantic recognition and routed metric planning", () => {
  it("reads all 600 columns and actual printed question IDs from the real relational codebook", () => {
    expect(fields).toHaveLength(600);
    expect(fields.find(f => f.variable === "q05_ever_use")?.questionId).toBe("Q17");
    expect(fields.find(f => f.variable === "q05_ever_use")?.meta.stateVariable).toBe("q05_ever_use_state");
  });
  it("recognises without a questionnaire upload and retains reasons; renamed variable prefixes do not decide roles", () => {
    const rec = recogniseUa(fields); expect(rec.recognised).toBe(true); expect(rec.reasons.length).toBeGreaterThan(10);
    const renamed = fields.map(f => ({ ...f, variable: `physical_${fields.indexOf(f)}`, meta: { ...f.meta, stateVariable: f.meta.stateVariable ? `physical_${fields.findIndex(s => s.variable === f.meta.stateVariable)}` : null } }));
    expect(recogniseUa(renamed).recognised).toBe(true);
  });
  it("does not recognise a BMW brand tracker or company CSM as U&A", () => {
    for (const name of ["bmw_car", "banking_csm_relationship"]) {
      const raw = JSON.parse(readFileSync(path.join("fixtures/tracker-roles", name + ".json"), "utf8"));
      const variables = Array.isArray(raw) ? raw : raw.variables;
      expect(recogniseUa(variables.map((v: { name: string; label: string }) => ({ variable: v.name, label: v.label, questionId: null, options: [], meta: {} }))).recognised).toBe(false);
    }
  });
  it("retains recognition with questionnaire metadata present and does not invent a CSM dashboard", () => {
    const enriched = fields.map(f => ({ ...f, meta: { ...f.meta, questionnaireAvailable: "true" } }));
    expect(recogniseUa(enriched).roles).toEqual(recogniseUa(fields).roles);
    const tracker = recogniseTracker(fields.map(f => ({ name: f.variable, label: f.label, numeric: !/verbatim|spontaneous association/i.test(f.label), text: /verbatim|spontaneous association/i.test(f.label), weightLike: /weight/i.test(f.meta.fieldRole ?? ""), questionId: f.questionId, questionType: f.options.length === 2 ? "multiple_response" : null, group: f.questionId, valueLabels: Object.fromEntries(f.options.map(o => [o.code, o.label])) })));
    expect(tracker.type).not.toBe("csm"); expect(tracker.type).not.toBe("brand_and_csm");
    mkdirSync("work/ua", { recursive: true }); writeFileSync("work/ua/tracker-overlap.json", JSON.stringify({ type: tracker.type, measures: tracker.measures.map(m => ({ label: m.label, stage: m.stage })), csm: tracker.csm }, null, 2));
  });
  it("asks about ambiguous core roles rather than picking the first variable", () => {
    const duplicate = { ...fields.find(f => f.variable === "q05_ever_use")!, variable: "another_export" };
    const rec = recogniseUa([...fields, duplicate]); expect(rec.recognised).toBe(false);
    expect(rec.questions.find(q => q.role === "everConsumption")?.candidates).toHaveLength(2);
  });
  it("writes a reproducible plan and reports unresolved routes rather than using an all-case base", () => {
    const rec = recogniseUa(fields); const plan = planUaMetrics(rec);
    mkdirSync("work/ua", { recursive: true }); writeFileSync("work/ua/metric-plan.json", JSON.stringify({ rec, ...plan }, null, 2));
    expect(plan.metrics.length).toBeGreaterThan(100);
    expect(plan.metrics.find(m => m.label === "Mean spend per answering P3M buyer")?.answered).toBeTruthy();
    expect(plan.metrics.find(m => /good value association/.test(m.label))?.assigned).toBeTruthy();
  });
});
