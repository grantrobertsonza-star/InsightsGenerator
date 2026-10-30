// Brand Health brand source (Grant, 29 October 2026): the mapping's normalisation (a mapping saved before brand
// sets existed reads unchanged; both a variable and a set, or a wrong type, is refused, never replaced by an empty
// mapping), the brand set's brands (member variable as identity, brand label from the member label; a set that is
// missing, not multiple-response, too small or with indistinguishable labels refused), which sections carry the
// overlap note, and the overlap caveat's wording in a finding's notes and in exports.
import { describe, expect, it } from "vitest";
import { brandGroupsOverlapNote, brandSetMembers, normaliseBrandHealthMapping, sectionSplitsByBrandGroups } from "../brandHealthMetrics";
import { exportCaveatLabels } from "../caveatLabels";
import { provenanceNotes } from "../findingBasis";
import type { BrandHealthDashboard } from "../brandHealthActions";
import type { VariableInfo, VariableSet } from "../parseStatsFile";

const v = (name: string, label: string, isFlag = true): VariableInfo => ({
  name,
  label,
  numeric: true,
  nValid: 10,
  pctValid: 100,
  nDistinct: 2,
  labelled: true,
  weightLike: false,
  isFlag,
});
const set = (key: string, vars: string[], kind?: VariableSet["kind"]): VariableSet => ({ key, label: `${key}_b`, vars, nValid: 10, pctValid: 100, ...(kind ? { kind } : {}) });

const OWNER = ["Toyota", "Mercedes-Benz", "BMW"].map((b, i) => v(`owner_b0${i + 1}`, `owner_b0${i + 1}. Current household ownership ${b}`));
const DICT = { variables: OWNER, sets: [set("owner", OWNER.map((x) => x.name), "multi")] };

describe("normaliseBrandHealthMapping", () => {
  const legacy = {
    brandVar: "main_brand",
    ourBrand: "BMW",
    funnel: { awareness: { setKey: "aware" } },
    attributes: [{ variable: "q5", metric: "top2" }],
    loyaltyVar: "nps",
    moments: [],
    positioning: { xVar: null, yVar: null },
  };

  it("reads a mapping saved before brand sets with brandSet null and everything else unchanged", () => {
    expect(normaliseBrandHealthMapping(legacy)).toEqual({ ok: true, mapping: { ...legacy, brandSet: null } });
  });

  it("keeps a brand set and its member as our brand", () => {
    const m = { ...legacy, brandVar: null, brandSet: "owner", ourBrand: "owner_b03" };
    expect(normaliseBrandHealthMapping(m)).toEqual({ ok: true, mapping: m });
  });

  it("refuses both a brand variable and a brand set, and fields of the wrong type", () => {
    const both = normaliseBrandHealthMapping({ ...legacy, brandSet: "owner" });
    expect(both).toEqual({ ok: false, error: "The saved Brand Health mapping could not be read: it names both a brand variable and a brand set; exactly one may be named." });
    expect(normaliseBrandHealthMapping({ ...legacy, brandSet: 7 }).ok).toBe(false);
    expect(normaliseBrandHealthMapping({ ...legacy, brandVar: "" }).ok).toBe(false);
    expect(normaliseBrandHealthMapping({ ...legacy, attributes: [{ variable: "q5", setKey: "x" }] }).ok).toBe(false);
    expect(normaliseBrandHealthMapping({ ...legacy, attributes: [{ variable: "q5", metric: "median" }] }).ok).toBe(false);
    expect(normaliseBrandHealthMapping({ ...legacy, funnel: { loyalty: { variable: "x" } } }).ok).toBe(false);
    expect(normaliseBrandHealthMapping(null).ok).toBe(false);
    expect(normaliseBrandHealthMapping([legacy]).ok).toBe(false);
  });
});

describe("brandSetMembers", () => {
  it("lists each member as a brand, identified by its variable, labelled without the shared words", () => {
    expect(brandSetMembers(DICT, "owner")).toMatchObject({
      ok: true,
      members: [
        { variable: "owner_b01", brand: "Toyota" },
        { variable: "owner_b02", brand: "Mercedes-Benz" },
        { variable: "owner_b03", brand: "BMW" },
      ],
    });
  });

  it("removes shared trailing words too, and keeps a bare name when a member has no label", () => {
    const grid = ["Toyota", "BMW"].map((b, i) => v(`attr_b0${i + 1}`, `${b} associated with Reliable`));
    expect(brandSetMembers({ variables: grid, sets: [set("attr", grid.map((x) => x.name), "multi")] }, "attr")).toMatchObject({
      ok: true,
      members: [{ brand: "Toyota" }, { brand: "BMW" }],
    });
    const bare = ["x1", "x2"].map((n) => v(n, ""));
    expect(brandSetMembers({ variables: bare, sets: [set("x", ["x1", "x2"], "multi")] }, "x")).toMatchObject({ ok: true, members: [{ brand: "x1" }, { brand: "x2" }] });
  });

  it("refuses a set that is missing, not multiple-response, too small, or whose brands cannot be told apart", () => {
    expect(brandSetMembers(DICT, "owner_x")).toEqual({ ok: false, error: 'The brand set "owner_x" was not found in this file.' });
    const battery = { variables: OWNER, sets: [set("owner", OWNER.map((x) => x.name), "battery")] };
    expect(brandSetMembers(battery, "owner")).toEqual({ ok: false, error: '"owner_b" is not a multiple-response set (one yes/no column per brand), so it cannot be the brand source.' });
    // A dictionary without set kinds: accepted only when every member is a yes/no flag.
    expect(brandSetMembers({ variables: OWNER, sets: [set("owner", OWNER.map((x) => x.name))] }, "owner").ok).toBe(true);
    const scales = OWNER.map((x) => ({ ...x, isFlag: false }));
    expect(brandSetMembers({ variables: scales, sets: [set("owner", scales.map((x) => x.name))] }, "owner").ok).toBe(false);
    expect(brandSetMembers({ variables: OWNER, sets: [set("owner", ["owner_b01"], "multi")] }, "owner").ok).toBe(false);
    const twins = [v("t1", "Own Toyota"), v("t2", "Own toyota")];
    const dup = brandSetMembers({ variables: twins, sets: [set("t", ["t1", "t2"], "multi")] }, "t");
    expect(dup.ok).toBe(false);
    expect(!dup.ok && dup.error).toContain("have the same brand label");
  });
});

describe("overlap note, sections and caveat", () => {
  const score = (brandSplit: "brand_groups" | "brand_columns") => ({ variable: "x", label: "X", metric: "mean" as const, byBrand: [], categoryAvg: null, brandSplit });
  const dashboard = {
    funnel: [{ ...score("brand_columns"), stage: "awareness" }],
    attributes: [score("brand_columns"), score("brand_groups")],
    moments: [],
    loyalty: { variable: "nps", label: "NPS", byBrand: [] },
    positioning: { xVariable: "a", xLabel: "A", yVariable: "b", yLabel: "B", points: [], brandSplit: "brand_columns" },
  } as unknown as BrandHealthDashboard;

  it("marks only the sections whose figures split respondents by brand groups", () => {
    expect(sectionSplitsByBrandGroups(dashboard, "funnel")).toBe(false);
    expect(sectionSplitsByBrandGroups(dashboard, "attributes")).toBe(true);
    expect(sectionSplitsByBrandGroups(dashboard, "moments")).toBe(false);
    expect(sectionSplitsByBrandGroups(dashboard, "loyalty")).toBe(true);
    expect(sectionSplitsByBrandGroups(dashboard, "positioning")).toBe(false);
  });

  it("states the overlap in words, in a finding's notes and in exports", () => {
    expect(brandGroupsOverlapNote("owner_b")).toBe(
      "Brands come from a multiple-response question (owner_b): a respondent in more than one brand's group is counted in each, so groups overlap and do not sum to the total.",
    );
    const notes = provenanceNotes({ origin: "generated", pattern_type: "level", stated_stats: { caveats: ["descriptive_reading", "brand_groups_overlap"] } });
    expect(notes).toContain(
      "Brand groups come from a multiple-response question: a respondent in more than one brand's group is counted in each, so the groups overlap and do not sum to the total.",
    );
    expect(notes.some((n) => n.startsWith("Additional caveat recorded"))).toBe(false);
    expect(exportCaveatLabels(["brand_groups_overlap"])).toEqual(["Brand groups overlap (a respondent can be in more than one)"]);
  });
});
