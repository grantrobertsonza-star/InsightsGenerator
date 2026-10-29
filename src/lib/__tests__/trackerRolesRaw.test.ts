// D2 (Grant, 29 October 2026: "it will 90% be standard raw files"): tracker roles from raw files with no codebook,
// as the app reads them (fixtures/tracker-raw). The expected brands, questions and roles are written from the
// files' own names and labels as listed in the README there, independently of the recogniser.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { recogniseTracker, type RoleVariable } from "../trackerRoles";

const raw = (name: string): RoleVariable[] => JSON.parse(readFileSync(path.join(process.cwd(), "fixtures", "tracker-raw", `${name}.json`), "utf8"));
const stages = (r: ReturnType<typeof recogniseTracker>) => Object.fromEntries(r.measures.map((m) => [m.group, m.stage]));

describe("brands named in the variable names (brand_tracker_Oct_2025.xlsx, no labels)", () => {
  const r = recogniseTracker(raw("coffee_brand_tracker_oct2025"));
  it("14 brands, by the name part as written, in the file's order", () => {
    expect(r.type).toBe("brand");
    expect(r.frame?.brands.map((b) => b.code)).toEqual(["PlatoCoffee", "MuggBean", "McCafe", "WoolworthsCafe", "Starbucks", "WildBeanCafe", "VidaECaffe", "SeattleCoffeeCo", "EngenBrazmata", "BootleggerCoffeeCo", "DailyCoffeeCafe", "BeanTreeCafeAtSpar", "DulceCafe", "Wiesenhof"]);
    expect(r.frame?.brands.slice(0, 3).map((b) => b.label)).toEqual(["Plato Coffee", "Mugg Bean", "McCafe"]);
  });
  it("the six per-brand questions and their stages", () => {
    expect(stages(r)).toEqual({ "Aware_*": "awareness", "Consider_*": "consideration", "P3M_*": "usage", "Frequent_*": "frequent_usage", "AdRecall_*": "advertising", "WOM_*": "word_of_mouth" });
    expect(r.measures.find((m) => m.group === "Consider_*")?.byBrand.find((b) => b.code === "Starbucks")?.variable).toBe("Consider_Starbucks");
    expect(r.measures.find((m) => m.group === "Aware_*")?.shape).toBe("binary");
  });
  it("15 moments and 13 attributes, asked about some brands only, as grids", () => {
    const moments = r.grids.find((g) => g.kind === "moments")!;
    const associations = r.grids.find((g) => g.kind === "associations")!;
    expect(moments.items).toHaveLength(15);
    expect(associations.items).toHaveLength(13);
    expect(moments.items[0]).toMatchObject({ item: "Quiet Time Alone", byBrand: [{ code: "PlatoCoffee", variable: "BrandMoment_PlatoCoffee_QuietTimeAlone" }, { code: "MuggBean" }, { code: "McCafe" }] });
  });
  it("category moments, media and channels are lists of their own, never brands", () => {
    expect(r.otherLists.map((l) => l.group)).toEqual(expect.arrayContaining(["Moment_*", "Media_*", "BuyingChannel_*"]));
  });
});

describe("brands named in the variable labels (Synthetic_Brand_Tracker_03, codebook sheet in the workbook)", () => {
  const r = recogniseTracker(raw("coffee_synthetic_03_rotated"));
  it("6 brands by their name codes, labelled from the labels; 'none of these brands' set aside", () => {
    expect(r.frame?.brands).toEqual([
      { code: "b1", label: "Kora Coffee" }, { code: "b2", label: "Metro Bean" }, { code: "b3", label: "Daily Cup" },
      { code: "b4", label: "Summit Coffee" }, { code: "b5", label: "Route Roast" }, { code: "b6", label: "Neighbourhood Brew" },
    ]);
    expect(r.frame?.nonBrandCodes.map((c) => c.code)).toEqual(["none"]);
    expect(r.measures.find((m) => m.group === "awareness_*")?.outside).toEqual(["awareness_none"]);
  });
  it("eight per-brand questions with their stages; ever used is trial, not usage", () => {
    expect(stages(r)).toEqual({
      "awareness_*": "awareness", "consideration_*": "consideration", "ever_used_*": "trial", "usage_p3m_*": "usage",
      "frequent_*": "frequent_usage", "ad_recall_*": "advertising", "wom_*": "word_of_mouth", "brand_opinion_*": "rejection",
    });
  });
  it("10 moments and 8 attributes; the attribute module's design columns are not attributes", () => {
    expect(r.grids.find((g) => g.kind === "moments")?.items.map((i) => i.item)[0]).toBe("Quiet time alone");
    const attrs = r.grids.find((g) => g.kind === "associations")!.items;
    expect(attrs.map((i) => i.item)).toEqual(["Good service", "Quality ingredients", "Digital ordering", "Pleasant environment", "Ethically sourced", "Great tasting drinks", "Value for money", "Supports local"]);
    const all = [...r.measures.flatMap((m) => m.byBrand.map((b) => b.variable)), ...r.grids.flatMap((g) => g.items.flatMap((i) => i.byBrand.map((b) => b.variable)))];
    expect(all.some((v) => /attr_(selected|status|probability|ipw)/.test(v))).toBe(false);
  });
});

describe("the BMW wave as SPSS with labels only (no question numbers, types or sets)", () => {
  const r = recogniseTracker(raw("bmw_car_spss_labels_only"));
  it("the same brands, stages and grids as with the pack's codebook", () => {
    expect(r.frame?.brands.map((b) => b.label)).toEqual(["Toyota", "Volkswagen", "Ford", "Hyundai", "Kia", "Nissan", "Suzuki", "BMW", "Mercedes-Benz", "Haval"]);
    const s = stages(r);
    expect([s.unaided, s.aware, s.consider, s.shortlist, s.firstchoice, s.owner, s.bought12, s.opinion, s.wom]).toEqual(["unaided_awareness", "awareness", "consideration", "shortlist", "first_choice", "usage", "acquisition", "rejection", "word_of_mouth"]);
    expect(r.grids.find((g) => g.kind === "moments")?.items).toHaveLength(12);
    expect(r.grids.find((g) => g.kind === "associations")?.items).toHaveLength(10);
  });
  it("a question the reader split in two is one question, all ten brands (repeat_b01 to b10)", () => {
    expect(r.measures.find((m) => m.group === "repeat")?.byBrand).toHaveLength(10);
    expect(stages(r).repeat).toBe("repeat");
  });
  it("two encodings of repeat purchase are the researcher's choice (spec: never double counted)", () => {
    expect(r.questions.map((q) => q.id)).toContain("stage:repeat");
  });
});

describe("the BMW wave as a plain CSV: brands only numbered", () => {
  const r = recogniseTracker(raw("bmw_car_csv_no_labels"));
  it("no brand list is guessed (not the question names either), and the researcher is asked for the codebook", () => {
    expect(r.frame).toBeNull();
    expect(r.type).toBe("unknown");
    expect(r.questions.map((q) => q.id)).toContain("brand-names");
  });
});

describe("CSM from raw files", () => {
  it("csm_Wave1_Baseline.xlsx (0 to 10 ratings, no labels): the company rating, the likelihood to recommend, continue doing business", () => {
    const r = recogniseTracker(raw("csm_wave1_baseline"));
    expect(r.type).toBe("csm");
    expect(r.csm).toMatchObject({
      overallSatisfaction: "OverallCompanySatisfaction_0to10",
      recommend0to10: "WordOfMouth_LikelihoodToRecommend_0to10",
      likelyToStay: "BehaviouralIntention_ContinueDoingBusiness_0to10",
      likelyToSwitch: null,
      drivers: [],
    });
    // Two switching items, and several rating batteries of equal size: the researcher chooses.
    expect(r.questions.map((q) => q.id)).toEqual(["csm:switch", "csm:drivers"]);
    expect(r.questions.find((q) => q.id === "csm:drivers")?.text).toMatch(/Agent Empathy \(6\)/);
  });
  it("the banking relationship CSV without its codebook: every role, the six drivers and not the importance battery", () => {
    const r = recogniseTracker(raw("banking_csm_relationship_csv"));
    expect(r.csm).toEqual({
      overallSatisfaction: "company_csat5",
      recommend0to10: "recommend_0to10",
      likelyToStay: "continue5",
      likelyToSwitch: "switch_0to10",
      drivers: ["company_driver_d01", "company_driver_d02", "company_driver_d03", "company_driver_d04", "company_driver_d05", "company_driver_d06"],
    });
    expect(r.questions).toEqual([]);
  });
});

// The packs' own workbooks as delivered (29 October 2026): before the reader read a Labels sheet headed "value_label",
// every answer code took its variable's label, so the BMW workbook gave no brand list and the CSM workbook a list
// of "brands" all called "Services work accurately and reliably" and the wrong drivers.
describe("the packs' workbooks with their own Codebook and Labels sheets", () => {
  it("BMW wave 1: the ten brands by code, Other and None set aside, every funnel stage, 12 moments and 10 attributes", () => {
    const r = recogniseTracker(raw("bmw_car_workbook_wave1"));
    expect(r.type).toBe("brand");
    expect(r.frame?.brands.map((b) => `${b.code}:${b.label}`)).toEqual(["1:Toyota", "2:Volkswagen", "3:Ford", "4:Hyundai", "5:Kia", "6:Nissan", "7:Suzuki", "8:BMW", "9:Mercedes-Benz", "10:Haval"]);
    expect(r.frame?.nonBrandCodes.map((c) => c.code)).toEqual(["96", "98"]);
    const s = stages(r);
    expect([s.aware, s.consider, s.shortlist, s.firstchoice, s.owner, s.bought12]).toEqual(["awareness", "consideration", "shortlist", "first_choice", "usage", "acquisition"]);
    expect(r.grids.find((g) => g.kind === "moments")?.items).toHaveLength(12);
    expect(r.grids.find((g) => g.kind === "associations")?.items).toHaveLength(10);
  });
  it("banking CSM relationship: every role, the six labelled poor-to-excellent drivers (no question numbers), not the importance battery or contact counts", () => {
    const r = recogniseTracker(raw("banking_csm_relationship_workbook"));
    expect(r.type).toBe("csm");
    expect(r.frame).toBeNull();
    expect(r.csm).toEqual({
      overallSatisfaction: "company_csat5",
      recommend0to10: "recommend_0to10",
      likelyToStay: "continue5",
      likelyToSwitch: "switch_0to10",
      drivers: ["company_driver_d01", "company_driver_d02", "company_driver_d03", "company_driver_d04", "company_driver_d05", "company_driver_d06"],
    });
  });
});
