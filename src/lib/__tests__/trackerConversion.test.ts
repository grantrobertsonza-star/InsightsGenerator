// The brand dashboard's Conversion view (page 01), pure parts of src/lib/trackerConversion.ts:
//   - conversionSteps: consecutive mapped stages in funnel order; a stage with no question is bridged by a step that
//     says so; a stage claimed by two questions breaks the chain ("Mapping needed"); usage to frequent usage;
//   - conversionCellOf: the conditional figure from weighted counts by raw code among those at S; a labelled don't
//     know at T outside the base with its kind (the database test covers it through the engine too); the engine's
//     minimum base at its boundary; nobody at S; the non-nested count; a T whose selected answer cannot be told;
//   - rankConversion and conversionHeadline: ranking by the unrounded figure, ties in the brand list's order, brands
//     without a figure never ranked and counted in the sentence; ordinals; no client brand.
import { describe, expect, it, vi } from "vitest";

vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));
vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
import { conversionCellOf, conversionHeadline, conversionSteps, rankConversion, type ConversionCell, type StageAnswer } from "../trackerConversion";
import type { CrosstabResult } from "../parseStatsFile";
import type { FunnelStage, RoleVariable } from "../trackerRoles";

const set = (...s: FunnelStage[]) => new Set<FunnelStage>(s);

describe("conversionSteps", () => {
  it("every funnel stage mapped: three adjacent steps; usage without frequent usage is skipped with the reason", () => {
    const { steps, skipped } = conversionSteps(set("awareness", "consideration", "shortlist", "first_choice", "usage"), set());
    expect(steps.map((s) => [s.label, s.bridged])).toEqual([
      ["Awareness to Consideration", []],
      ["Consideration to Shortlist", []],
      ["Shortlist to First choice", []],
    ]);
    expect(skipped).toEqual([{ from: "usage", to: "frequent_usage", status: "not_measured", reason: "Usage to Frequent usage: no frequent usage question was found in this file." }]);
  });
  it("no consideration question: bridged Awareness to Shortlist, labelled, and both adjacent pairs said", () => {
    const { steps, skipped } = conversionSteps(set("awareness", "shortlist", "first_choice", "usage", "frequent_usage"), set());
    expect(steps.map((s) => s.label)).toEqual(["Awareness to Shortlist (no consideration question)", "Shortlist to First choice", "Usage to Frequent usage"]);
    expect(skipped.map((s) => s.reason)).toEqual([
      "Awareness to Consideration: no consideration question was found in this file.",
      "Consideration to Shortlist: no consideration question was found in this file.",
    ]);
  });
  it("two missing stages are bridged together and named; nothing mapped after a stage gives no bridge", () => {
    expect(conversionSteps(set("awareness", "first_choice"), set()).steps.map((s) => [s.label, s.bridged])).toEqual([["Awareness to First choice (no consideration or shortlist question)", ["consideration", "shortlist"]]]);
    expect(conversionSteps(set("awareness"), set()).steps).toEqual([]);
  });
  it("a stage claimed by two questions breaks the chain: mapping needed, never bridged over", () => {
    const { steps, skipped } = conversionSteps(set("awareness", "shortlist", "first_choice"), set("consideration"));
    expect(steps.map((s) => s.label)).toEqual(["Shortlist to First choice"]);
    expect(skipped.slice(0, 2)).toEqual([
      { from: "awareness", to: "consideration", status: "mapping_needed", reason: "Awareness to Consideration: two questions could be consideration. Choose one under Customise." },
      { from: "consideration", to: "shortlist", status: "mapping_needed", reason: "Consideration to Shortlist: two questions could be consideration. Choose one under Customise." },
    ]);
  });
  it("a first stage with no question: the step from it is skipped, the later steps shown", () => {
    const { steps, skipped } = conversionSteps(set("consideration", "shortlist"), set());
    expect(steps.map((s) => s.label)).toEqual(["Consideration to Shortlist"]);
    expect(skipped.map((s) => [s.from, s.to, s.status])).toEqual([
      ["awareness", "consideration", "not_measured"],
      ["shortlist", "first_choice", "not_measured"],
    ]);
  });
});

// A Cross tab result with one-column single-choice questions: per code [weighted count, n]; `cases` is total.n.
function table(questions: Record<string, Record<string, [number, number]>>, cases: number): CrosstabResult {
  return {
    version: 2,
    weightVar: "w",
    weightLabel: "w",
    blocks: [],
    columns: [],
    total: { n: cases, w: cases, nEff: cases },
    questions: Object.entries(questions).map(([key, answers]) => {
      const n = Object.values(answers).reduce((t, [, k]) => t + k, 0);
      const w = Object.values(answers).reduce((t, [x]) => t + x, 0);
      return {
        key,
        label: key,
        kind: "single" as const,
        rows: [
          { label: "Base", isBase: true, count: [n], pct: [null], total: { count: n } },
          ...Object.entries(answers).map(([code, [weighted, k]]) => ({ label: code, rawCode: code, count: [weighted], pct: [(100 * weighted) / w], total: { count: weighted, countExact: weighted, pct: (100 * weighted) / w, pctExact: (100 * weighted) / w, nCell: k } })),
        ],
      };
    }),
  } as unknown as CrosstabResult;
}
const YES_NO = { "0": "Not selected", "1": "Selected" };
const vars = new Map<string, RoleVariable>([
  ["aware_b1", { name: "aware_b1", label: "Aware", numeric: true, valueLabels: YES_NO }],
  ["consider_b1", { name: "consider_b1", label: "Consider", numeric: true, valueLabels: { ...YES_NO, "9": "Don't know" } }],
  ["odd_b1", { name: "odd_b1", label: "Odd", numeric: true, valueLabels: { "1": "Maybe", "2": "Perhaps" } }],
]);
const at = (variable: string | null, n: number | null, code: string | null = "1"): StageAnswer => ({ variable, code, n });

describe("conversionCellOf", () => {
  it("weighted converted / weighted known answers among those at S; a labelled don't know and a blank outside the base, counted", () => {
    // 100 at awareness: 40 considering (weight 50), 45 not (weight 40), 10 don't know, 5 blank.
    const s = table({ consider_b1: { "0": [40, 45], "1": [50, 40], "9": [9, 10] } }, 100);
    const t = table({ aware_b1: { "1": [50, 40] } }, 40);
    const c = conversionCellOf("1", at("aware_b1", 100), at("consider_b1", 40), s, t, vars, 10);
    expect(c.conversion).toBeCloseTo((100 * 50) / 90, 12);
    expect([c.base, c.converted, c.atFrom, c.noAnswerAtTo, c.nonNested, c.suppressed]).toEqual([85, 40, 100, 5, 0, false]);
    expect(c.unknownAtTo).toEqual([{ code: "9", label: "Don't know", kind: "non_answer", n: 10 }]);
    // Not the ratio of shares: 40 of 100 respondents at T among all, against 50/90 here.
    expect([c.weightedConverted, c.weightedBase]).toEqual([50, 90]);
  });
  it("non-nested: those at T minus those at T who are also at S", () => {
    const s = table({ consider_b1: { "0": [60, 60], "1": [40, 40] } }, 100);
    const t = table({ aware_b1: { "0": [12, 12], "1": [40, 40] } }, 55);
    expect(conversionCellOf("1", at("aware_b1", 100), at("consider_b1", 55), s, t, vars, 10).nonNested).toBe(15);
  });
  it("the engine's minimum base: 9 is suppressed with the base shown, 10 is shown", () => {
    const nine = conversionCellOf("1", at("aware_b1", 9), at("consider_b1", 4), table({ consider_b1: { "0": [5, 5], "1": [4, 4] } }, 9), table({ aware_b1: { "1": [4, 4] } }, 4), vars, 10);
    expect([nine.conversion, nine.suppressed, nine.base, nine.weightedBase]).toEqual([null, true, 9, null]);
    expect(nine.reason).toBe("Suppressed for a small base: 9 respondents, under the minimum of 10.");
    const ten = conversionCellOf("1", at("aware_b1", 10), at("consider_b1", 4), table({ consider_b1: { "0": [6, 6], "1": [4, 4] } }, 10), table({ aware_b1: { "1": [4, 4] } }, 4), vars, 10);
    expect([ten.conversion, ten.suppressed, ten.base]).toEqual([40, false, 10]);
  });
  it("nobody at S: base 0 with the reason, never 0%; nobody at T: non-nested 0", () => {
    const c = conversionCellOf("1", at("aware_b1", 0), at("consider_b1", 0), null, null, vars, 10);
    expect([c.conversion, c.base, c.nonNested]).toEqual([null, 0, 0]);
    expect(c.reason).toBe("Nobody is at the earlier stage for this brand.");
  });
  it("everyone at S answers T unknown: no base, no figure", () => {
    const c = conversionCellOf("1", at("aware_b1", 12), at("consider_b1", 0), table({ consider_b1: { "9": [12, 12] } }, 12), null, vars, 10);
    expect([c.conversion, c.base]).toEqual([null, 0]);
    expect(c.reason).toMatch(/known answer/);
  });
  it("a later stage whose selected answer cannot be told, or a brand not asked: n/a with the reason", () => {
    const odd = conversionCellOf("1", at("aware_b1", 50), { variable: "odd_b1", code: null, n: null, reason: "Which answer means selected could not be told" }, table({ odd_b1: { "1": [20, 20], "2": [30, 30] } }, 50), null, vars, 10);
    expect([odd.conversion, odd.base]).toEqual([null, null]);
    expect(odd.reason).toMatch(/selected could not be told/);
    const notAsked = conversionCellOf("1", at("aware_b1", 50), { variable: null, code: null, n: null, reason: "Not asked about this brand." }, null, null, vars, 10);
    expect(notAsked.reason).toBe("Not asked about this brand. (the later stage)");
  });
});

const cell = (code: string, conversion: number | null, suppressed = false, base = 50): ConversionCell => ({
  code, fromVariable: "a", toVariable: "b", conversion, base, weightedBase: null, weightedConverted: null, atFrom: base, converted: null, unknownAtTo: [], noAnswerAtTo: 0, nonNested: 0, suppressed,
});

describe("rankConversion and conversionHeadline", () => {
  const step = { from: "awareness" as const, to: "consideration" as const };
  it("ranks by the unrounded figure, ties in the brand list's order; brands without a figure are never ranked", () => {
    const r = rankConversion([cell("1", 40.04), cell("2", 67.2), cell("3", null, true, 8), cell("4", 40.04), cell("5", null), cell("6", 40.05)]);
    expect(r.ranked.map((x) => [x.code, x.rank])).toEqual([["2", 1], ["6", 2], ["1", 3], ["4", 4]]);
    expect([r.suppressed, r.notAvailable]).toEqual([["3"], ["5"]]);
  });
  it("the headline: plain, the rank among brands with a figure, how many were left out and why", () => {
    const cells = [cell("1", 40.04), cell("2", 67.2), cell("3", null, true, 8), cell("4", 40.04), cell("5", null)];
    expect(conversionHeadline(step, cells, { code: "2", label: "Toyota" })).toBe("Toyota converts 67% of aware respondents to consideration, 1st of 3 brands; 2 brands not ranked (1 small base, 1 not available).");
    expect(conversionHeadline(step, cells, { code: "4", label: "Kia" })).toBe("Kia converts 40% of aware respondents to consideration, 3rd of 3 brands; 2 brands not ranked (1 small base, 1 not available).");
    expect(conversionHeadline(step, cells, { code: "3", label: "Ford" })).toBe("Ford: no figure, base too small (n=8). 2 brands not ranked (1 small base, 1 not available).");
    expect(conversionHeadline(step, cells.slice(0, 2), { code: "1", label: "Ford" })).toBe("Ford converts 40% of aware respondents to consideration, 2nd of 2 brands.");
    expect(conversionHeadline({ from: "shortlist", to: "first_choice" }, [cell("1", 33)], { code: "1", label: "BMW" })).toBe("BMW converts 33% of shortlisting respondents to first choice, 1st of 1 brand.");
    expect(conversionHeadline(step, cells, null)).toBe("Choose your brand to see its headline. 2 brands not ranked (1 small base, 1 not available).");
  });
  it("ordinals: 11th, 12th, 13th, 21st, 22nd, 23rd", () => {
    const many = Array.from({ length: 23 }, (_, i) => cell(String(i + 1), 100 - i));
    const place = (code: string) => conversionHeadline(step, many, { code, label: "X" }).match(/, (\d+\w+) of 23/)![1];
    expect(["11", "12", "13", "21", "22", "23", "1", "2", "3"].map(place)).toEqual(["11th", "12th", "13th", "21st", "22nd", "23rd", "1st", "2nd", "3rd"]);
  });
});
