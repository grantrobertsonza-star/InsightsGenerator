// Plan D1: tracker roles recognised from codebook structure, answer lists and wording, checked against the
// roles written down independently for Grant's synthetic test packs (claude/tracker-packs-role-spec-2026-10-28.md,
// section 3). Inputs: fixtures/tracker-roles (each pack's codebook and value labels; no respondent data).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { findBrandFrame, recogniseTracker, type RoleVariable } from "../trackerRoles";

const pack = (name: string): RoleVariable[] => JSON.parse(readFileSync(path.join(process.cwd(), "fixtures", "tracker-roles", `${name}.json`), "utf8"));
const stageOf = (r: ReturnType<typeof recogniseTracker>, group: string) => r.measures.find((m) => m.group === group)?.stage ?? "(not a per-brand measure)";

describe("brand tracker packs (spec section 3.1)", () => {
  for (const [name, brands, usage, acquisition] of [
    ["bmw_car", ["Toyota", "Volkswagen", "Ford", "Hyundai", "Kia", "Nissan", "Suzuki", "BMW", "Mercedes-Benz", "Haval"], "owner", "bought12"],
    ["banking_brand", ["Capitec", "Standard Bank", "Absa", "Nedbank", "African Bank", "GoTyme Bank (formerly TymeBank)", "Bank Zero", "FNB", "Discovery Bank", "Investec"], "current", "started12"],
    ["insurance_brand", ["Santam", "Hollard", "MiWay", "Budget Insurance", "Auto & General", "Dialdirect", "Discovery Insure", "OUTsurance", "Naked", "King Price"], "current", "started12"],
    // Telecoms: FNB Connect and Standard Bank Connect are brands here; "Bank branch app or channel" is a
    // buying channel, never a brand (spec section 3.1, O5).
    ["telecoms_brand", ["MTN", "Telkom Mobile", "Cell C", "FNB Connect", "Capitec Connect", "Standard Bank Connect", "Melon Mobile", "Vodacom", "Afrihost Air Mobile", "Mr Price Mobile"], "current", "started90"],
  ] as const) {
    const r = recogniseTracker(pack(name));
    it(`${name}: a brand tracker whose brand list is codes 1 to 10, with Other (96) and None (98) set aside`, () => {
      expect(r.type).toBe("brand");
      expect(r.frame?.brands).toEqual(brands.map((label, i) => ({ code: String(i + 1), label })));
      expect(r.frame?.nonBrandCodes.map((c) => c.code)).toEqual(["96", "98"]);
      expect(r.frame?.questions).toEqual(["topmind", "first_choice", "main_brand"]);
    });
    it(`${name}: funnel and behaviour stages, each with all ten brands by code`, () => {
      expect(stageOf(r, "unaided")).toBe("unaided_awareness");
      expect(stageOf(r, "aware")).toBe("awareness");
      expect(stageOf(r, "consider")).toBe("consideration");
      expect(stageOf(r, "shortlist")).toBe("shortlist");
      expect(stageOf(r, "q:F3")).toBe("first_choice");
      expect(stageOf(r, usage)).toBe("usage");
      expect(stageOf(r, acquisition)).toBe("acquisition");
      expect(stageOf(r, "q:O4")).toBe("repeat");
      expect(stageOf(r, "q:R1")).toBe("rejection");
      expect(stageOf(r, "q:W1")).toBe("word_of_mouth");
      expect(stageOf(r, "ad_unaided")).toBe("advertising");
      for (const m of r.measures) expect(m.byBrand.map((b) => b.code)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
      // First choice: the single brand-code question is not one of the per-brand variables.
      expect(r.measures.find((m) => m.group === "q:F3")?.outside).toEqual(["first_choice"]);
      // BMW is code 8 in each measure, by its label, never by position in the file.
      expect(r.measures.find((m) => m.group === "consider")?.byBrand.find((b) => b.code === "8")?.variable).toBe("consider_b08");
    });
    it(`${name}: the brand opinion scale is not mistaken for the brand list (Grant: the preview listed answers as brands)`, () => {
      expect(r.frame?.brands.some((b) => /would never|might choose/i.test(b.label))).toBe(false);
    });
    it(`${name}: 12 buying situations and 10 attributes, each a brand grid with all ten brands`, () => {
      const moments = r.grids.find((g) => g.kind === "moments")!;
      const associations = r.grids.find((g) => g.kind === "associations")!;
      expect(moments.items).toHaveLength(12);
      expect(associations.items).toHaveLength(10);
      for (const it of [...moments.items, ...associations.items]) expect(it.byBrand).toHaveLength(10);
      expect(associations.items[0].group).toBe("attr_a01");
    });
    it(`${name}: media, purchase journey and stated category moments are their own lists, never brands or attributes`, () => {
      const lists = r.otherLists.map((l) => l.group);
      for (const g of ["media", "purchase_journey", "category_situations"]) expect(lists).toContain(g);
      const brandGroups = new Set([...r.measures.map((m) => m.group), ...r.grids.flatMap((g) => g.items.map((i) => i.group))]);
      for (const g of ["media", "purchase_journey", "category_situations"]) expect(brandGroups.has(g)).toBe(false);
    });
    it(`${name}: exclusive None flags are never a brand`, () => {
      const all = r.measures.flatMap((m) => m.byBrand.map((b) => b.variable));
      expect(all.some((v) => /_none$|_none_|_dk_|_other/.test(v))).toBe(false);
    });
    it(`${name}: asks which brand is the client's, and confirms the non-brand answers, rather than guessing`, () => {
      expect(r.questions.map((q) => q.id)).toEqual(expect.arrayContaining(["focal-brand", "non-brand-codes"]));
      expect(r.questions.some((q) => q.id.startsWith("stage:") || q.id.startsWith("csm:"))).toBe(false);
    });
  }
});

describe("CSM relationship pack (spec section 3.2)", () => {
  const r = recogniseTracker(pack("banking_csm_relationship"));
  it("a CSM tracker with its target, NPS, stay, switch and the six driver ratings; no brand list", () => {
    expect(r.type).toBe("csm");
    expect(r.frame).toBeNull();
    expect(r.csm).toEqual({
      overallSatisfaction: "company_csat5",
      recommend0to10: "recommend_0to10",
      likelyToStay: "continue5",
      likelyToSwitch: "switch_0to10",
      drivers: ["company_driver_d01", "company_driver_d02", "company_driver_d03", "company_driver_d04", "company_driver_d05", "company_driver_d06"],
      company: "company",
    });
  });
  it("the importance battery (R4) is not taken as the drivers", () => {
    expect(r.csm.drivers.some((d) => d.startsWith("importance_"))).toBe(false);
  });
});

describe("what the recogniser will not guess", () => {
  const scale = { "1": "Very poor", "2": "Poor", "3": "Good", "4": "Excellent" };
  it("an answer list shared by many questions but named in no other wording is not a brand list", () => {
    const vars: RoleVariable[] = ["a", "b", "c"].map((n) => ({ name: n, label: `Rating of ${n}`, valueLabels: scale, numeric: true, questionType: "categorical" }));
    expect(findBrandFrame(vars)).toBeNull();
    expect(recogniseTracker(vars).type).toBe("unknown");
  });
  it("two candidates for overall satisfaction are asked about, not chosen", () => {
    const sat = { "1": "Very dissatisfied", "2": "Dissatisfied", "3": "Neither", "4": "Satisfied", "5": "Very satisfied" };
    const r = recogniseTracker([
      { name: "s1", label: "Overall satisfaction with the company", valueLabels: sat, numeric: true },
      { name: "s2", label: "Overall satisfaction with the bank", valueLabels: sat, numeric: true },
    ]);
    expect(r.csm.overallSatisfaction).toBeNull();
    expect(r.questions.map((q) => q.id)).toContain("csm:satisfaction");
  });
  it("a brand named inside another brand's name goes to the longer name (FNB and FNB Connect)", () => {
    const list = { "1": "FNB", "2": "FNB Connect", "3": "MTN", "96": "Other" };
    const vars: RoleVariable[] = [
      { name: "top", label: "Top of mind", valueLabels: list, numeric: true, questionType: "categorical" },
      { name: "main", label: "Main provider", valueLabels: list, numeric: true, questionType: "categorical" },
      ...["FNB", "FNB Connect", "MTN"].map((b, i) => ({ name: `aw${i + 1}`, label: `Awareness ${b}`, numeric: true, questionType: "multiple_response" as const, group: "aware", valueLabels: { "0": "No", "1": "Yes" } })),
    ];
    const r = recogniseTracker(vars);
    expect(r.measures.find((m) => m.group === "aware")?.byBrand).toEqual([{ code: "1", variable: "aw1" }, { code: "2", variable: "aw2" }, { code: "3", variable: "aw3" }]);
  });
});

// Codex D1-F01 (29 October 2026): a recommend question is "likelihood to recommend (0 to 10)" only when its
// scale is a stated 0 to 10, by the rule the Net Promoter calculation uses (isZeroToTenScale); expected roles
// written from the acceptance criteria, not from the recogniser.
describe("D1-F01: the 0 to 10 recommend scale is validated, not just its top", () => {
  const points = (from: number, to: number, extra: Record<string, string> = {}) => ({
    ...Object.fromEntries(Array.from({ length: to - from + 1 }, (_, i) => [String(from + i), String(from + i)])),
    ...extra,
  });
  const nonAnswers = { "98": "Don't know", "99": "Refused" };
  const csmWith = (recommend: Partial<RoleVariable>[]): ReturnType<typeof recogniseTracker> =>
    recogniseTracker([
      { name: "sat", label: "Overall satisfaction with the company", valueLabels: { "1": "Very dissatisfied", "2": "Dissatisfied", "3": "Neutral", "4": "Satisfied", "5": "Very satisfied" }, numeric: true },
      ...recommend.map((r, i) => ({ name: `rec${i + 1}`, label: "How likely are you to recommend the company?", numeric: true, ...r }) as RoleVariable),
    ]);
  it("genuine 0 to 10, with explicit non-answer codes, is the recommend question (positive control)", () => {
    expect(csmWith([{ valueLabels: points(0, 10, nonAnswers) }]).csm.recommend0to10).toBe("rec1");
  });
  it("a 1 to 10 list and a 6 to 10 list are not 0 to 10", () => {
    expect(csmWith([{ valueLabels: points(1, 10) }]).csm.recommend0to10).toBeNull();
    expect(csmWith([{ valueLabels: points(6, 10) }]).csm.recommend0to10).toBeNull();
  });
  it("missing zero (1 to 10 with non-answer codes) is not 0 to 10", () => {
    expect(csmWith([{ valueLabels: points(1, 10, nonAnswers) }]).csm.recommend0to10).toBeNull();
  });
  it("a list labelling only 0 and 10 is not assumed: the researcher is asked", () => {
    const r = csmWith([{ valueLabels: { "0": "Not at all likely", "10": "Extremely likely" } }]);
    expect(r.csm.recommend0to10).toBeNull();
    expect(r.questions.map((q) => q.id)).toContain("csm:recommend-scale:rec1");
  });
  it("two genuine 0 to 10 recommend questions are asked about", () => {
    const r = recogniseTracker([
      { name: "rec_company", label: "Recommend the company to a friend", valueLabels: points(0, 10), numeric: true },
      { name: "rec_app", label: "Recommend the app to a friend", valueLabels: points(0, 10), numeric: true },
    ]);
    expect(r.csm.recommend0to10).toBeNull();
    expect(r.questions.map((q) => q.id)).toContain("csm:recommend");
  });
  it("a raw file: the wording must state 0 to 10; a name ending in 10 is not a stated scale", () => {
    expect(recogniseTracker([{ name: "Recommend_0to10", label: "Recommend_0to10", numeric: true, distinct: 11 }]).csm.recommend0to10).toBe("Recommend_0to10");
    expect(recogniseTracker([{ name: "recommend10", label: "recommend10", numeric: true, distinct: 10 }]).csm.recommend0to10).toBeNull();
    expect(recogniseTracker([{ name: "Recommend_1to10", label: "Recommend_1to10", numeric: true, distinct: 10 }]).csm.recommend0to10).toBeNull();
  });
});
