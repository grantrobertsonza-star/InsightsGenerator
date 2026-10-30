// r6brandext: the extension's figure rules, pure (brandExtension.ts brandRatingFrom, episodeFigures;
// brandExtensionRoles.ts resolveOther; brandExtensionConfirmations.ts checks). Every expected value is worked out by
// hand in the comments from the guide's definitions; the engine paths are covered by the .db tests.
import { describe, expect, it, vi } from "vitest";

// The loaders' modules are imported for their pure functions only; nothing here reads storage or the database.
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));
vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));

import { brandRatingFrom, episodeFigures, type EpisodeCell } from "../brandExtension";
import { normaliseBrandName, resolveOther, type BrandExtensionRecognition, type EpisodeQuestions, type RatingFamily } from "../brandExtensionRoles";
import { appliedChange, confirmationProblem, parseStoredConfirmations } from "../brandExtensionConfirmations";
import type { CrosstabResult } from "../parseStatsFile";

const FAMILY: RatingFamily = {
  key: "needsfit_b01,needsfit_b02",
  wording: "meets my personal needs for personal banking.",
  byBrand: [{ code: "1", variable: "needsfit_b01" }],
  scale: [
    { code: "1", label: "Strongly disagree" },
    { code: "2", label: "Disagree" },
    { code: "3", label: "Neither agree nor disagree" },
    { code: "4", label: "Agree" },
    { code: "5", label: "Strongly agree" },
  ],
  cannotJudge: [{ code: "9", label: "Do not know enough to judge" }],
  otherCodes: [],
};

/** A computed single-column table of one variable: weighted and unweighted counts by code, and its valid base. */
function table(variable: string, counts: Record<string, [number, number]>, nEff?: number): CrosstabResult {
  const n = Object.values(counts).reduce((a, [c]) => a + c, 0);
  const w = Object.values(counts).reduce((a, [, x]) => a + x, 0);
  const base = { n, w, nEff: nEff ?? n };
  return {
    questions: [
      {
        key: variable,
        rows: [
          { label: "Base", isBase: true, count: [n], pct: [null], total: { count: n, pct: null, base } },
          ...Object.entries(counts).map(([code, [c, x]]) => ({ label: code, rawCode: code, count: [x], pct: [null], total: { count: x, countExact: x, nCell: c, pct: w ? (x / w) * 100 : null, pctExact: w ? (x / w) * 100 : null, base } })),
        ],
      },
    ],
  } as unknown as CrosstabResult;
}
const brand = { code: "1", label: "Capitec" };

describe("one brand's rating (E1 to E3): valid 1 to 5, cannot judge on the aware base, missing apart", () => {
  // Aware: 10 respondents, weights 1 each except two of weight 2 (weighted aware 12).
  // Answers among the aware: 1 (w1), 5 (w2), 5 (w1), 4 (w1), 3 (w1), 9 (w2), 9 (w1), 2 (w1); two aware with no answer (w1, w1).
  const aware = { n: 10, weighted: 12 };
  const awareT = table("needsfit_b01", { "1": [1, 1], "2": [1, 1], "3": [1, 1], "4": [1, 1], "5": [2, 3], "9": [2, 3] });
  const validT = table("needsfit_b01", { "1": [1, 1], "2": [1, 1], "3": [1, 1], "4": [1, 1], "5": [2, 3] }, 5.4);
  const r = brandRatingFrom(FAMILY, brand, "needsfit_b01", aware, awareT, validT, 9, true);

  it("endpoints 1 and 5 are on the scale; top-two-box = weighted 4 or 5 / weighted 1 to 5 = (1 + 3) / 7 x 100", () => {
    expect(r.valid).toEqual({ n: 6, weighted: 7, effective: 5.4 });
    expect(r.topTwo).toBeCloseTo((4 / 7) * 100, 12);
    expect(r.distribution.map((d) => d.share)).toEqual([1, 1, 1, 1, 3].map((x) => (x / 7) * 100));
    expect(r.mean).toBeCloseTo((1 + 2 + 3 + 4 + 5 * 3) / 7, 12);
  });
  it("code 9 is cannot judge on the asked aware base (3 / 12), not the valid base, and never in the distribution", () => {
    expect(r.cannotJudge).toEqual({ n: 2, weighted: 3, share: 25 });
    expect(r.distribution.some((d) => d.code === "9")).toBe(false);
  });
  it("aware respondents with no answer are missing (10 - 8 = 2, weighted 12 - 10 = 2), never valid; answers from the not aware are a route break (9 - 8 = 1)", () => {
    expect(r.missing).toEqual({ n: 2, weighted: 2 });
    expect(r.answeredNotAware).toBe(1);
  });
  it("under 30 valid ratings: no interval, descriptive only", () => {
    expect(r.topTwoInterval).toBeNull();
    expect(r.smallBase).toBe("very_small");
  });
  it("weight rescaling: every weight times 3.7 leaves every percentage and the mean unchanged", () => {
    const k = 3.7;
    const scaled = (t: Record<string, [number, number]>) => Object.fromEntries(Object.entries(t).map(([c, [n, w]]) => [c, [n, w * k] as [number, number]]));
    const r2 = brandRatingFrom(FAMILY, brand, "needsfit_b01", { n: 10, weighted: 12 * k }, table("needsfit_b01", scaled({ "1": [1, 1], "2": [1, 1], "3": [1, 1], "4": [1, 1], "5": [2, 3], "9": [2, 3] })), validT, 9, true);
    expect(r2.topTwo).toBeCloseTo(r.topTwo!, 10);
    expect(r2.mean).toBeCloseTo(r.mean!, 10);
    expect(r2.cannotJudge.share).toBeCloseTo(r.cannotJudge.share!, 10);
    r2.distribution.forEach((d, i) => expect(d.share).toBeCloseTo(r.distribution[i].share!, 10));
  });
  it("a measured rating with no valid base (everyone aware said 9) is Not available, never 0%", () => {
    const all9 = brandRatingFrom(FAMILY, brand, "needsfit_b01", { n: 3, weighted: 3 }, table("needsfit_b01", { "9": [3, 3] }), table("needsfit_b01", {}), 3, false);
    expect(all9.topTwo).toBeNull();
    expect(all9.mean).toBeNull();
    expect(all9.distribution.every((d) => d.share === null)).toBe(true);
    expect(all9.cannotJudge.share).toBe(100);
    expect(all9.reason).toMatch(/not available/);
  });
  it("nobody aware: no base and the reason; an unknown aware base is said, never zero", () => {
    expect(brandRatingFrom(FAMILY, brand, "needsfit_b01", { n: 0, weighted: 0 }, null, null, 0, false).reason).toMatch(/No respondent is aware/);
    expect(brandRatingFrom(FAMILY, brand, "needsfit_b01", { n: null, weighted: null }, null, null, null, false).reason).toMatch(/could not be told/);
  });
  it("an answer code that is neither the scale nor cannot judge is listed apart, never valid", () => {
    const odd = brandRatingFrom(FAMILY, brand, "needsfit_b01", { n: 3, weighted: 3 }, table("needsfit_b01", { "4": [1, 1], "5": [1, 1], "7": [1, 1] }), null, 3, false);
    expect(odd.otherCodes).toEqual([{ code: "7", n: 1, weighted: 1 }]);
    expect(odd.valid.n).toBe(2);
    expect(odd.topTwo).toBe(100);
  });
});

const Q: EpisodeQuestions = {
  key: "choice_actual,choice_ideal",
  event: "most recent personal bank account opening in the past 12 months",
  actual: { variable: "choice_actual", label: "Brand actually chosen" },
  ideal: { variable: "choice_ideal", label: "Brand ideally preferred" },
  actualOther: "choice_actual_other",
  idealOther: "choice_ideal_other",
  eligibility: { variable: "choice_episode_eligible", eligibleCode: "1" },
  gap: { variable: "choice_gap", sameCode: "0", differentCode: "1" },
  codes: { other: "96", noIdeal: "98", cannotRecallActual: "99", cannotRecallIdeal: "99" },
  brandCodes: [
    { brand: "1", code: "1" },
    { brand: "2", code: "2" },
    { brand: "8", code: "8" },
  ],
};
const BRANDS = [
  { code: "1", label: "Capitec" },
  { code: "2", label: "Standard Bank" },
  { code: "8", label: "FNB" },
];
const cell = (idealCode: string, idealName: string | null, actualCode: string, actualName: string | null, n = 1, weighted = n): EpisodeCell => ({ idealCode, idealName, actualCode, actualName, n, weighted });

describe("ideal versus actual for the same episode: every case of the guide's acceptance list", () => {
  // One respondent per case (weight 1), plus the no-episode and missing counts.
  const cells: EpisodeCell[] = [
    cell("1", null, "1", null), // same tracked brand: pair, gap 0
    cell("1", null, "2", null), // different tracked brands: pair, gap 1
    cell("98", null, "2", null), // no particular ideal: status
    cell("99", null, "1", null), // cannot recall the ideal: status
    cell("2", null, "99", null), // cannot recall the actual: status
    cell("96", "Synthetic other brand A", "96", "  synthetic OTHER   brand a "), // matching named Other: pair, gap 0
    cell("96", "Synthetic other brand A", "96", "Synthetic other brand C"), // different named Other: pair, gap 1
    cell("96", null, "1", null), // an Other with no name: unresolved
    cell("96", "FNB", "8", null), // a tracked brand typed as Other: gap 1 unless an alias is confirmed
  ];
  const extra = { notEligible: { n: 5, weighted: 5 }, eligible: { n: 10, weighted: 10 }, missingActual: { n: 1, weighted: 1 }, missingIdeal: { n: 0, weighted: 0 } };
  const f = episodeFigures(Q, BRANDS, cells, [], extra);

  it("statuses apart: no episode 5, no particular ideal 1, cannot recall 2, unresolved Other 1, asked with no answer 1", () => {
    expect(Object.fromEntries(f.statuses.map((s) => [s.key, s.n]))).toEqual({ no_episode: 5, no_particular_ideal: 1, cannot_recall: 2, unresolved_other: 1, missing_answer: 1 });
  });
  it("the paired base holds the five known pairs; gap 3 of 5 (60%): two named Others match only by name", () => {
    expect(f.paired).toEqual({ n: 5, weighted: 5 });
    expect(f.gap).toEqual({ n: 3, weighted: 3, rate: 60 });
  });
  it("ideal and actual shares on the identical paired base; named Others kept by name inside one Other row", () => {
    const by = Object.fromEntries(f.shares.map((s) => [s.key, [s.ideal.share, s.actual.share]]));
    // Ideal: Capitec 2, Standard Bank 0, FNB 0, Others 3 (A, A, fnb). Actual: Capitec 1, Standard Bank 1, FNB 1, Others 2 (a, C).
    expect(by).toEqual({ "brand:1": [40, 20], "brand:2": [0, 20], "brand:8": [0, 20], other: [60, 40] });
    const other = f.shares.find((s) => s.key === "other")!;
    expect(other.members!.map((m) => m.name)).toEqual(["fnb", "synthetic other brand a", "synthetic other brand c"]);
    expect(other.netGap).toBeCloseTo(20, 12);
  });
  it("fulfilment among Capitec's ideal preferrers with a known actual: 1 of 2 (50%), the other went to Standard Bank", () => {
    const c = f.fulfilment.find((x) => x.code === "1")!;
    expect(c.preferrers).toEqual({ n: 2, weighted: 2 });
    expect(c.rate).toBe(50);
    expect(c.destinations.map((d) => [d.label, d.share])).toEqual([["Capitec", 50], ["Standard Bank", 50]]);
    expect(f.fulfilment.find((x) => x.code === "2")!.rate).toBeNull();
  });
  it("a confirmed alias (fnb is FNB) resolves the typed name to the tracked brand: that pair matches, gap 2 of 5", () => {
    const g = episodeFigures(Q, BRANDS, cells, [{ name: "fnb", brandCode: "8", otherName: null, by: "g", at: "2026-10-30" }], extra);
    expect(g.gap.n).toBe(2);
    expect(g.shares.find((s) => s.key === "brand:8")!.ideal.share).toBe(20);
    expect(g.fulfilment.find((x) => x.code === "8")!.rate).toBe(100);
  });
  it("no pairs at all: shares, gap and fulfilment Not available (null), never 0%", () => {
    const none = episodeFigures(Q, BRANDS, [cell("98", null, "1", null)], [], extra);
    expect(none.paired.n).toBe(0);
    expect(none.gap.rate).toBeNull();
    expect(none.shares.every((s) => s.ideal.share === null && s.actual.share === null)).toBe(true);
  });
  it("weighted: shares are weighted counts over the weighted paired base", () => {
    const w = episodeFigures(Q, BRANDS, [cell("1", null, "1", null, 1, 2.5), cell("1", null, "2", null, 1, 0.5)], [], extra);
    expect(w.gap.rate).toBeCloseTo((0.5 / 3) * 100, 12);
    expect(w.fulfilment.find((x) => x.code === "1")!.rate).toBeCloseTo((2.5 / 3) * 100, 12);
  });
});

describe("Other names", () => {
  it("trimmed, case-folded, whitespace collapsed; a blank name is unresolved; an alias to another Other name joins them", () => {
    expect(normaliseBrandName("  Synthetic   OTHER brand A ")).toBe("synthetic other brand a");
    expect(resolveOther("   ", [])).toEqual({ kind: "unresolved" });
    expect(resolveOther(null, [])).toEqual({ kind: "unresolved" });
    expect(resolveOther("Brand X", [{ name: "brand x", brandCode: null, otherName: "Brand Ex", by: null, at: "" }])).toEqual({ kind: "other", name: "brand ex" });
    expect(resolveOther("Capitec", [])).toEqual({ kind: "other", name: "capitec" });
  });
});

describe("confirmations: only what is in review, only this file's brands, provenance kept, a bad record refused", () => {
  const rec = {
    ratings: {
      needs_fit: { status: "needs_review", candidates: [{ key: "a,b", description: "A", variables: ["a"] }], reason: "two", values: { "a,b": FAMILY } },
      differentiation: { status: "found", value: FAMILY, evidence: [] },
      price_justification: { status: "not_measured", reason: "x", missing: "y" },
    },
    episode: { status: "not_measured", reason: "x", missing: "y" },
    reasons: { status: "not_measured", reason: "x", missing: "y" },
    claimed: [],
  } as unknown as BrandExtensionRecognition;
  it("a candidate or not measured for a construct in review; nothing for one found without doubt; a key not offered is refused", () => {
    expect(confirmationProblem(rec, ["1"], { kind: "construct", construct: "needs_fit", choice: "a,b" })).toBeNull();
    expect(confirmationProblem(rec, ["1"], { kind: "construct", construct: "needs_fit", choice: "not_measured" })).toBeNull();
    expect(confirmationProblem(rec, ["1"], { kind: "construct", construct: "needs_fit", choice: "z" })).toMatch(/not one of this file's/);
    expect(confirmationProblem(rec, ["1"], { kind: "construct", construct: "differentiation", choice: "not_measured" })).toMatch(/Only a construct marked Needs review/);
  });
  it("aliases: to one of this file's brands or one other Other name, never both, never itself", () => {
    expect(confirmationProblem(rec, ["1", "8"], { kind: "alias", name: "FNB ", brandCode: "8", otherName: null })).toBeNull();
    expect(confirmationProblem(rec, ["1"], { kind: "alias", name: "FNB", brandCode: "8", otherName: null })).toMatch(/not in this file's brand list/);
    expect(confirmationProblem(rec, ["1"], { kind: "alias", name: "x", brandCode: "1", otherName: "y" })).toMatch(/one tracked brand or to one other/);
    expect(confirmationProblem(rec, ["1"], { kind: "alias", name: "Brand X", brandCode: null, otherName: " brand  x" })).toMatch(/different Other name/);
    expect(confirmationProblem(rec, ["1"], { kind: "alias", name: "  ", brandCode: "1", otherName: null })).toMatch(/name is needed/);
  });
  it("applying a change keeps every other entry and records who, when and which file", () => {
    const stored = { constructs: { reasons: { choice: "not_measured", by: "a", at: "t0", documentId: "d0" } }, aliases: [{ name: "x", brandCode: "1", otherName: null, by: "a", at: "t0", documentId: "d0" }] };
    const next = appliedChange(stored, { kind: "construct", construct: "needs_fit", choice: "a,b" }, rec, "grant", "t1", "d1");
    expect(next.constructs.reasons).toEqual(stored.constructs.reasons);
    expect(next.constructs.needs_fit).toEqual({ choice: "a,b", by: "grant", at: "t1", documentId: "d1", evidence: "A" });
    const aliased = appliedChange(next, { kind: "alias", name: "  FNB", brandCode: "8", otherName: null }, rec, "grant", "t2", "d1");
    expect(aliased.aliases).toEqual([stored.aliases[0], { name: "fnb", brandCode: "8", otherName: null, by: "grant", at: "t2", documentId: "d1" }]);
    expect(appliedChange(aliased, { kind: "remove_alias", name: "fnb" }, rec, "grant", "t3", "d1").aliases).toEqual([stored.aliases[0]]);
  });
  it("a stored record that is not valid is an error, never read as no confirmations", () => {
    expect(parseStoredConfirmations(null)).toEqual({ constructs: {}, aliases: [] });
    expect(() => parseStoredConfirmations([])).toThrow(/not valid/);
    expect(() => parseStoredConfirmations({ constructs: { bogus: { choice: "x", at: "t" } } })).toThrow(/not valid/);
    expect(() => parseStoredConfirmations({ aliases: [{ name: "x" }] })).toThrow(/not valid/);
  });
});
