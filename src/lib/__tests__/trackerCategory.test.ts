// The brand dashboard's Category overview page (Grant's design, page 08, 29 October 2026), pure parts:
//   - findDecisionStyle and findAcquisitionChannel (trackerRoles.ts): by their own wording and answer lists, never by a
//     variable name alone; two candidates are ambiguous; a buying channel list is never the brand list;
//   - repertoireParts: the stage questions' listed brands (Other outside), or why a stage cannot be shown;
//   - repertoireFromResult: the mean number of brands per respondent as the sum of the brands' shares, only when every
//     respondent answered every brand; otherwise n/a with the reason, never 0;
//   - distributionFromResult: every listed answer by raw code, one nobody gave 0 of the known base.
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));
vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
import { findAcquisitionChannel, findDecisionStyle, recogniseTracker, type PerBrandMeasure, type RoleVariable } from "../trackerRoles";
import { resolveDashboard } from "../trackerDashboard";
import { distributionFromResult, repertoireFromResult, repertoireParts } from "../trackerCategory";
import type { CrosstabResult } from "../parseStatsFile";

const fixture = (dir: string, name: string): RoleVariable[] => JSON.parse(readFileSync(path.join(process.cwd(), "fixtures", dir, `${name}.json`), "utf8"));
const v = (name: string, label: string, valueLabels?: Record<string, string>): RoleVariable => ({ name, label, numeric: true, ...(valueLabels ? { valueLabels } : {}) });
const STYLES = { "1": "Preferred brand first", "2": "Brief comparison", "3": "Extensive comparison" };
const CHANNELS = { "1": "Dealer", "2": "Online", "3": "Private seller", "7": "Other" };

describe("findDecisionStyle and findAcquisitionChannel", () => {
  it("brand packs (codebook, SPSS labels only): decision_style, and acquisition_channel or start_channel", () => {
    for (const [dir, name, channel] of [["tracker-roles", "bmw_car", "acquisition_channel"], ["tracker-raw", "bmw_car_spss_labels_only", "acquisition_channel"], ["tracker-roles", "telecoms_brand", "start_channel"]]) {
      const r = recogniseTracker(fixture(dir, name));
      expect(r.decisionStyle, name).toMatchObject({ status: "found", variable: "decision_style" });
      expect(r.acquisitionChannel, name).toMatchObject({ status: "found", variable: channel });
    }
  });
  it("wording decides: a channel question about something else, or a decision rated on a scale's yes/no, is not taken", () => {
    expect(findAcquisitionChannel([v("c1", "Channel used most for service", CHANNELS)])).toMatchObject({ status: "not_found" });
    expect(findAcquisitionChannel([v("c2", "Where did you buy your current vehicle?", CHANNELS)])).toMatchObject({ status: "found", variable: "c2" });
    expect(findDecisionStyle([v("d1", "Made the decision alone", { "0": "No", "1": "Yes" })])).toMatchObject({ status: "not_found" });
    expect(findDecisionStyle([v("d2", "How do you usually choose a bank?", STYLES)])).toMatchObject({ status: "found", variable: "d2" });
  });
  it("two candidates: ambiguous; a variable named decision_style without its own wording: not read", () => {
    expect(findDecisionStyle([v("d1", "Decision style", STYLES), v("d2", "Decision-making process", STYLES)])).toMatchObject({ status: "ambiguous", candidates: ["d1", "d2"] });
    expect(findDecisionStyle([v("decision_style", "decision_style", STYLES)])).toMatchObject({ status: "not_found" });
    expect(findAcquisitionChannel([v("acquisition_channel", "acquisition_channel", CHANNELS)])).toMatchObject({ status: "not_found" });
  });
});

describe("repertoireParts", () => {
  const vars = fixture("tracker-roles", "bmw_car");
  const rec = recogniseTracker(vars);
  const names = new Set(vars.map((x) => x.name));
  it("BMW pack: awareness, consideration and acquisition, each the ten listed brands (owner_other and the None flags outside)", () => {
    const parts = repertoireParts(rec, resolveDashboard(rec, names, "weight", {}));
    expect(parts.map((p) => [p.stage, "variables" in p ? p.variables.length : p.status])).toEqual([
      ["awareness", 10],
      ["consideration", 10],
      ["acquisition", 10],
    ]);
    const acq = parts[2];
    expect("variables" in acq && acq.variables.some((x) => /other|none/.test(x))).toBe(false);
  });
  it("a stage set to no question: not measured; claimed twice: mapping needed; no brand list: not measured", () => {
    const d = resolveDashboard(rec, names, "weight", {});
    const consider = d.stages.find((s) => s.stage === "consideration")!.group;
    const shortlist = d.stages.find((s) => s.stage === "shortlist")!.group;
    expect(repertoireParts(rec, resolveDashboard(rec, names, "weight", { stages: { [consider]: null } }))[1]).toMatchObject({ status: "not_measured" });
    expect(repertoireParts(rec, resolveDashboard(rec, names, "weight", { stages: { [shortlist]: "consideration" } }))[1]).toMatchObject({ status: "mapping_needed" });
    expect(repertoireParts(rec, { ...d, brands: [] })[0]).toMatchObject({ status: "not_measured", reason: expect.stringMatching(/brand list/) });
  });
});

// A Cross tab result over `n` respondents with yes/no or single-choice questions: per code share, and a base.
function table(n: number, questions: Record<string, { base: number; answers: Record<string, number | null> }>): CrosstabResult {
  return {
    total: { n, w: n, nEff: n },
    columns: [],
    questions: Object.entries(questions).map(([key, q]) => ({
      key,
      rows: [
        { label: "Base", isBase: true, count: [q.base], pct: [null], total: { count: q.base } },
        ...Object.entries(q.answers).map(([code, share]) => ({ label: `a${code}`, rawCode: code, count: [0], nCell: [1], pct: [share], pctExact: [share], total: { count: 1, countExact: 1, pct: share, pctExact: share, nCell: 1 } })),
      ],
    })),
  } as unknown as CrosstabResult;
}
const yn = { "0": "Not selected", "1": "Selected" };
const measure = { group: "aware", label: "Prompted recognition", byBrand: [], outside: [], shape: "binary", stage: "awareness", stageReason: null } as PerBrandMeasure;

describe("repertoireFromResult: the mean number of brands per respondent", () => {
  const roleVars = new Map(["a1", "a2", "a3"].map((x) => [x, v(x, x, yn)]));
  it("the sum of the brands' shares over 100 when every respondent answered every brand", () => {
    const r = repertoireFromResult(table(100, { a1: { base: 100, answers: { "0": 10, "1": 90 } }, a2: { base: 100, answers: { "0": 40, "1": 60 } }, a3: { base: 100, answers: { "0": 100 } } }), "awareness", measure, ["a1", "a2", "a3"], roleVars);
    expect(r).toMatchObject({ status: "ok", brands: 3, base: 100 });
    expect(r.status === "ok" && r.mean).toBeCloseTo(1.5, 12);
  });
  it("a brand with fewer answers than respondents, or a share that cannot be read: n/a with the reason, never a partial sum", () => {
    const partial = repertoireFromResult(table(100, { a1: { base: 100, answers: { "1": 100 } }, a2: { base: 99, answers: { "1": 100 } } }), "awareness", measure, ["a1", "a2"], roleVars);
    expect(partial).toMatchObject({ mean: null, reason: expect.stringMatching(/a2 has 99 of 100/) });
    const odd = new Map(roleVars);
    odd.set("a2", v("a2", "a2", { "0": "No", "1": "Maybe" }));
    expect(repertoireFromResult(table(100, { a1: { base: 100, answers: { "1": 100 } }, a2: { base: 100, answers: { "1": 100 } } }), "awareness", measure, ["a1", "a2"], odd)).toMatchObject({ mean: null, reason: expect.stringMatching(/^a2: Which answer means selected/) });
    expect(repertoireFromResult(null, "awareness", measure, ["a1"], roleVars)).toMatchObject({ mean: null, reason: "No figures were calculated." });
  });
});

describe("distributionFromResult", () => {
  const found = { status: "found" as const, variable: "ch", label: "Most recent acquisition channel" };
  it("every listed answer by raw code with the list's label; one nobody gave is 0 of the known base", () => {
    const d = distributionFromResult(table(10, { ch: { base: 8, answers: { "1": 50, "7": 50 } } }), found, v("ch", "Most recent acquisition channel", CHANNELS));
    expect(d.status === "ok" && d.answers.map((a) => [a.code, a.label, a.share])).toEqual([
      ["1", "Dealer", 50],
      ["2", "Online", 0],
      ["3", "Private seller", 0],
      ["7", "Other", 50],
    ]);
    expect(d).toMatchObject({ base: 8 });
  });
  it("not found: not measured; ambiguous: mapping needed; no valid answers: no answers with the reason", () => {
    expect(distributionFromResult(null, { status: "not_found", reason: "none" }, undefined)).toEqual({ status: "not_measured", reason: "none" });
    expect(distributionFromResult(null, { status: "ambiguous", candidates: ["a", "b"], reason: "two" }, undefined)).toEqual({ status: "mapping_needed", reason: "two" });
    expect(distributionFromResult(table(10, { ch: { base: 0, answers: {} } }), found, undefined)).toMatchObject({ answers: [], reason: "No valid answers." });
  });
});
