// D2 (Grant, 29 October 2026): a dashboard is this wave's suggestion with the programme's saved choices on top
// (trackerDashboard.ts). Inputs: the BMW pack's roles (fixtures/tracker-roles/bmw_car.json, D1) and the CSM
// relationship pack's. Expected behaviour written from Grant's decisions: settings per programme carried by
// identity, weighted by default when the file has a weight, main brand asked once and pre-filled.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { choiceProblems, normaliseChoices, prefilledFocalBrand, resolveDashboard } from "../trackerDashboard";
import { FUNNEL_STAGES, recogniseTracker, type RoleVariable } from "../trackerRoles";

const pack = (name: string): RoleVariable[] => JSON.parse(readFileSync(path.join(process.cwd(), "fixtures", "tracker-roles", `${name}.json`), "utf8"));
const bmw = pack("bmw_car");
const rec = recogniseTracker(bmw);
const names = new Set(bmw.map((v) => v.name));

describe("weighting (Grant: weight by default)", () => {
  it("weighted when the file has a weight and nothing was chosen", () => {
    const d = resolveDashboard(rec, names, "weight", {});
    expect([d.weighted, d.weightVar, d.weightSource]).toEqual([true, "weight", "default"]);
  });
  it("unweighted when the researcher chose so, and that stays a choice", () => {
    const d = resolveDashboard(rec, names, "weight", { weighted: false });
    expect([d.weighted, d.weightSource]).toEqual([false, "chosen"]);
  });
  it("a file with no weight is unweighted; a saved 'weighted' choice says it cannot apply, and is refused as a new choice", () => {
    expect(resolveDashboard(rec, names, null, {}).weighted).toBe(false);
    const d = resolveDashboard(rec, names, null, { weighted: true });
    expect(d.weighted).toBe(false);
    expect(d.needsChoice.map((n) => n.id)).toContain("weight");
    expect(choiceProblems({ weighted: true }, rec, names, null)).toEqual(["This file has no weight, so it cannot be weighted."]);
  });
});

describe("main brand: asked once, pre-filled", () => {
  it("pre-filled from the programme or project name, never saved as a choice", () => {
    const pre = prefilledFocalBrand(rec.frame!.brands, ["BMW car tracker", null]);
    expect(pre).toEqual({ code: "8", label: "BMW" });
    const d = resolveDashboard(rec, names, "weight", {}, pre);
    expect(d.focalBrand).toEqual({ code: "8", label: "BMW", source: "prefilled" });
    expect(d.needsChoice.map((n) => n.id)).toContain("focal-brand");
  });
  it("a name is matched as whole words, and the longest name wins (Kiambu is not Kia; Mercedes-Benz over a shorter match)", () => {
    expect(prefilledFocalBrand(rec.frame!.brands, ["Kiambu survey"])).toBeNull();
    expect(prefilledFocalBrand([{ code: "1", label: "FNB" }, { code: "2", label: "FNB Connect" }], ["FNB Connect tracker"])).toEqual({ code: "2", label: "FNB Connect" });
    expect(prefilledFocalBrand(rec.frame!.brands, ["Mercedes-Benz 2026"])?.code).toBe("9");
    expect(prefilledFocalBrand(rec.frame!.brands, [])).toBeNull();
  });
  it("once chosen, the choice is used and the question is closed", () => {
    const d = resolveDashboard(rec, names, "weight", { focalBrandCode: "8" }, { code: "1", label: "Toyota" });
    expect(d.focalBrand).toEqual({ code: "8", label: "BMW", source: "chosen" });
    expect(d.needsChoice.map((n) => n.id)).not.toContain("focal-brand");
  });
});

describe("carrying choices to another wave by identity", () => {
  it("a stage chosen for a question this wave has is applied; the others stay suggested", () => {
    const d = resolveDashboard(rec, names, "weight", { stages: { shortlist: "consideration", consider: null } });
    const stage = (g: string) => d.stages.find((s) => s.group === g)!;
    expect(stage("shortlist")).toMatchObject({ stage: "consideration", source: "chosen" });
    expect(stage("consider")).toMatchObject({ stage: null, source: "chosen" });
    expect(stage("aware")).toMatchObject({ stage: "awareness", source: "suggested" });
  });
  it("a choice about something this wave lacks is listed as needing a choice and kept, never dropped", () => {
    const wave2 = bmw.filter((v) => !v.name.startsWith("consider_") && v.name !== "recommend_0to10");
    const rec2 = recogniseTracker(wave2);
    const names2 = new Set(wave2.map((v) => v.name));
    const stored = { stages: { consider: "consideration" as const }, csm: { recommend0to10: "recommend_0to10" }, focalBrandCode: "8" };
    const d = resolveDashboard(rec2, names2, "weight", stored);
    expect(d.needsChoice.map((n) => n.id)).toEqual(expect.arrayContaining(["stage:consider", "csm:recommend0to10"]));
    expect(d.csm.recommend0to10).toEqual({ variable: null, source: "chosen" });
    expect(d.focalBrand?.code).toBe("8");
    // Resaving from this wave keeps the unchanged choices; a new choice of a missing variable is refused.
    expect(choiceProblems(stored, rec2, names2, "weight", stored)).toEqual([]);
    expect(choiceProblems({ ...stored, csm: { likelyToStay: "nope" } }, rec2, names2, "weight", stored)).toEqual(["nope is not a variable in this file."]);
  });
  it("a brand code missing from this wave's list makes the main brand a question again", () => {
    const d = resolveDashboard(rec, names, "weight", { focalBrandCode: "42" });
    expect(d.focalBrand).toBeNull();
    expect(d.needsChoice.find((n) => n.id === "focal-brand")?.text).toMatch(/code 42/);
  });
  it("answers chosen as not brands replace the suggested set, by code", () => {
    const d = resolveDashboard(rec, names, "weight", { nonBrandCodes: ["96", "98"] });
    expect(d.nonBrandCodes.map((c) => [c.code, c.source])).toEqual([["96", "chosen"], ["98", "chosen"]]);
    expect(d.brands).toHaveLength(10);
    expect(d.needsChoice.map((n) => n.id)).not.toContain("non-brand-codes");
  });
});

describe("CSM roles", () => {
  const csm = pack("banking_csm_relationship");
  const crec = recogniseTracker(csm);
  const cnames = new Set(csm.map((v) => v.name));
  it("suggested roles stand until chosen; a chosen driver set replaces them", () => {
    const d = resolveDashboard(crec, cnames, null, { csm: { drivers: ["company_driver_d01", "company_driver_d02"] } });
    expect(d.csm.overallSatisfaction).toEqual({ variable: "company_csat5", source: "suggested" });
    expect(d.csm.drivers).toEqual({ variables: ["company_driver_d01", "company_driver_d02"], source: "chosen" });
  });
});

describe("what is saved", () => {
  it("only known keys of the right types are kept", () => {
    expect(normaliseChoices({ focalBrandCode: 8, nonBrandCodes: ["96", 98], weighted: "yes", hidden: ["funnel"], stages: { a: "awareness", b: 3 }, extra: 1 })).toEqual({ nonBrandCodes: ["96"], hidden: ["funnel"], stages: { a: "awareness" } });
    expect(normaliseChoices(null)).toEqual({});
    expect(normaliseChoices([])).toEqual({});
  });
  it("new choices are checked against this wave", () => {
    expect(choiceProblems({ focalBrandCode: "8", stages: { consider: "awareness" } }, rec, names, "weight")).toEqual([]);
    expect(choiceProblems({ focalBrandCode: "96" }, rec, names, "weight")).toEqual(["Brand code 96 is not in this file's brand list."]);
    expect(choiceProblems({ stages: { consider: "loyalty" as never } }, rec, names, "weight")).toEqual(['"loyalty" is not a funnel stage.']);
    expect(choiceProblems({ stages: { nope: "awareness" } }, rec, names, "weight")).toEqual(["Question nope is not a per-brand question in this file."]);
  });
});

// ---- Codex review of D2a (29 October 2026) ----

describe("D2A-F02: every stage the recogniser gives can be saved", () => {
  it("each stage in the one list is accepted for a per-brand question; an unknown one is refused", () => {
    for (const stage of FUNNEL_STAGES) expect(choiceProblems({ stages: { consider: stage } }, rec, names, "weight")).toEqual([]);
    expect(choiceProblems({ stages: { consider: "loyalty" as never } }, rec, names, "weight")).toEqual(['"loyalty" is not a funnel stage.']);
  });
  it("trial and frequent use, chosen for a question, are applied when the dashboard is worked out again", () => {
    const d = resolveDashboard(rec, names, "weight", normaliseChoices(JSON.parse(JSON.stringify({ stages: { consider: "trial", shortlist: "frequent_usage" } }))));
    expect(d.stages.find((s) => s.group === "consider")).toMatchObject({ stage: "trial", source: "chosen" });
    expect(d.stages.find((s) => s.group === "shortlist")).toMatchObject({ stage: "frequent_usage", source: "chosen" });
  });
});

describe("D2A-F03: an unchanged weighting choice does not block saving from a wave without a weight", () => {
  it("kept unchanged: other edits save; the wave's results are unweighted and say so", () => {
    expect(choiceProblems({ weighted: true, focalBrandCode: "8" }, rec, names, null, { weighted: true })).toEqual([]);
    const d = resolveDashboard(rec, names, null, { weighted: true, focalBrandCode: "8" });
    expect([d.weighted, d.weightSource]).toEqual([false, "chosen"]);
    expect(d.needsChoice.map((n) => n.id)).toContain("weight");
  });
  it("a new weighting choice on a wave without a weight is still refused", () => {
    expect(choiceProblems({ weighted: true }, rec, names, null, {})).toEqual(["This file has no weight, so it cannot be weighted."]);
    expect(choiceProblems({ weighted: true }, rec, names, null, { weighted: false })).toEqual(["This file has no weight, so it cannot be weighted."]);
  });
  it("a later wave with a weight applies the programme's weighted choice again", () => {
    const d = resolveDashboard(rec, names, "weight", { weighted: true });
    expect([d.weighted, d.weightSource, d.needsChoice.some((n) => n.id === "weight")]).toEqual([true, "chosen", false]);
  });
});

describe("D2A-F04: choosing a CSM role answers its question", () => {
  const scale = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [String(i), String(i)]));
  const sat = { "1": "Very dissatisfied", "2": "Dissatisfied", "3": "Neutral", "4": "Satisfied", "5": "Very satisfied" };
  const vars: RoleVariable[] = [
    { name: "sat_company", label: "Overall satisfaction with the company", valueLabels: sat, numeric: true },
    { name: "sat_bank", label: "Overall satisfaction with the bank", valueLabels: sat, numeric: true },
    { name: "rec_company", label: "Recommend the company to a friend", valueLabels: scale, numeric: true },
    { name: "rec_app", label: "Recommend the app to a friend", valueLabels: scale, numeric: true },
    { name: "rec_partial", label: "Recommend the branch", valueLabels: { "0": "Not at all likely", "10": "Extremely likely" }, numeric: true },
    { name: "stay_a", label: "Likely to continue with the bank", valueLabels: sat, numeric: true },
    { name: "stay_b", label: "Likely to stay with the bank", valueLabels: sat, numeric: true },
    { name: "switch_a", label: "Likely to switch provider", valueLabels: sat, numeric: true },
    { name: "switch_b", label: "Might switch to a competitor", valueLabels: sat, numeric: true },
  ];
  const r = recogniseTracker(vars);
  const vn = new Set(vars.map((v) => v.name));
  const open = (c: Parameters<typeof resolveDashboard>[3]) => resolveDashboard(r, vn, null, c).needsChoice.map((n) => n.id);
  it("each ambiguity is asked when nothing is chosen", () => {
    expect(open({})).toEqual(expect.arrayContaining(["csm:satisfaction", "csm:recommend", "csm:stay", "csm:switch", "csm:recommend-scale:rec_partial"]));
  });
  it("an applicable choice, or an intentional none, answers each", () => {
    const ids = open({ csm: { overallSatisfaction: "sat_company", recommend0to10: "rec_company", likelyToStay: "stay_a", likelyToSwitch: null } });
    for (const id of ["csm:satisfaction", "csm:recommend", "csm:stay", "csm:switch"]) expect(ids).not.toContain(id);
  });
  it("a carried choice this file lacks keeps the question and says why", () => {
    const ids = open({ csm: { recommend0to10: "rec_gone" } });
    expect(ids).toEqual(expect.arrayContaining(["csm:recommend", "csm:recommend0to10"]));
  });
  it("a partly labelled list stays asked about unless that very variable is chosen", () => {
    expect(open({ csm: { recommend0to10: "rec_company" } })).toContain("csm:recommend-scale:rec_partial");
    expect(open({ csm: { recommend0to10: "rec_partial" } })).not.toContain("csm:recommend-scale:rec_partial");
  });
});
