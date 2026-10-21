import { describe, expect, it } from "vitest";
import {
  CORROBORATION_STATES,
  evidenceKindOf,
  findingNeedsAttention,
  inUseWith,
  insightMatches,
  NO_THEME,
  NO_THEME_KEY,
  QUALITY_STATES,
  summarizeFindings,
  summarizeInsights,
  SUPPORT_STATES,
  themeKeyOf,
  type InsightFilter,
  type OverviewFinding,
  type OverviewInsight,
} from "../evidenceOverview";

const finding = (over: Partial<OverviewFinding>): OverviewFinding => ({
  id: Math.random().toString(36).slice(2),
  origin: "generated",
  data_type: "quantitative",
  theme: "Trust",
  status: "accepted",
  pattern_type: "banner_comparison",
  stated_stats: null,
  contradicts_report: false,
  is_contradicted: false,
  quote_match: null,
  designFreshness: null,
  ...over,
});

describe("evidenceKindOf", () => {
  it("classifies by origin first, then the stored method", () => {
    expect(evidenceKindOf(finding({ origin: "stated", pattern_type: "driver" }))).toBe("report");
    expect(evidenceKindOf(finding({ origin: "coded", data_type: "qualitative", pattern_type: null }))).toBe("interviews");
    expect(evidenceKindOf(finding({ pattern_type: "model_association" }))).toBe("output");
    expect(evidenceKindOf(finding({ pattern_type: null, stated_stats: { source: "uploaded_output" } }))).toBe("output");
    expect(evidenceKindOf(finding({ pattern_type: "driver" }))).toBe("modelled");
    expect(evidenceKindOf(finding({ pattern_type: "relationship", stated_stats: { source: "scatter_tool" } }))).toBe("modelled");
    expect(evidenceKindOf(finding({ pattern_type: "level", stated_stats: { source: "nps_tool" } }))).toBe("survey");
    expect(evidenceKindOf(finding({ pattern_type: "no_difference" }))).toBe("survey");
    // A generated finding marked qualitative (not from coding) is still interview evidence.
    expect(evidenceKindOf(finding({ data_type: "qualitative", pattern_type: null }))).toBe("interviews");
  });
});

describe("summarizeFindings", () => {
  it("counts by status, source and theme, and raises only findings in use for attention", () => {
    const rows = [
      finding({ theme: "Trust" }),
      finding({ theme: "Trust", status: "pending", designFreshness: "stale" }),
      finding({ theme: "Trust", origin: "coded", data_type: "qualitative", pattern_type: null, contradicts_report: true }),
      finding({ theme: "Price", origin: "stated", status: "pending", quote_match: "none" }),
      finding({ theme: "Price", status: "rejected", is_contradicted: true, designFreshness: "unknown" }),
      finding({ theme: null, pattern_type: "driver", designFreshness: "unknown" }),
    ];
    const o = summarizeFindings(rows, [{ verdict_tier: "robust" }, { verdict_tier: "not_supported" }, { verdict_tier: null }]);
    expect(o.status).toEqual({ total: 6, accepted: 3, pending: 2, rejected: 1 });
    expect(o.byKind.map((k) => [k.kind, k.status.total])).toEqual([
      ["survey", 3],
      ["interviews", 1],
      ["report", 1],
      ["modelled", 1],
    ]);
    // Largest theme first, "No theme" last.
    expect(o.themes.map((t) => t.theme)).toEqual(["Trust", "Price", NO_THEME]);
    expect(o.themes[0].byKind).toMatchObject({ survey: 2, interviews: 1 });
    expect(o.themes[0].contradictions).toBe(1);
    expect(o.themes[0].designChanged).toBe(1);
    // The rejected Price finding is contradicted and of unknown design, but out of use.
    expect(o.themes[1].contradictions).toBe(0);
    expect(o.themes[1].designUnknown).toBe(0);
    expect(o.attention).toEqual({ pending: 2, contradictions: 1, designChanged: 1, designUnknown: 1, quoteNotFound: 1, claimsNotSupported: 1 });
    expect(o.reportClaims).toMatchObject({ robust: 1, not_supported: 1, unchecked: 1, total: 3 });
  });

  it("is empty, not zero-filled with invented rows, when there are no findings", () => {
    const o = summarizeFindings([], []);
    expect(o.status.total).toBe(0);
    expect(o.byKind).toEqual([]);
    expect(o.themes).toEqual([]);
    expect(o.reportClaims.total).toBe(0);
  });
});

const insight = (over: Partial<OverviewInsight>): OverviewInsight => ({
  id: Math.random().toString(36).slice(2),
  headline: "H",
  implication: "I",
  review_status: "accepted",
  quality_score: 15,
  quality_tier: "qualified",
  confidence_tier: "moderate",
  independent_source_count: 2,
  source_theme_count: 2,
  support: { status: "current" },
  ...over,
});

describe("summarizeInsights", () => {
  it("counts insights in use, and ranks the top ones by stored quality with current support only", () => {
    const rows = [
      insight({ id: "a", headline: "A", quality_score: 21 }),
      insight({ id: "b", headline: "B", quality_score: 23, support: { status: "invalid" } }),
      insight({ id: "c", headline: "C", quality_score: 19, independent_source_count: 3 }),
      insight({ id: "d", headline: "D", quality_score: 19, independent_source_count: 1 }),
      insight({ id: "e", headline: "E", quality_score: null, quality_tier: null, confidence_tier: null, support: { status: "unknown" } }),
      insight({ id: "f", headline: "F", quality_score: 25, review_status: "rejected", support: { status: "stale" } }),
    ];
    const o = summarizeInsights(rows);
    expect(o.total).toBe(6);
    expect(o.review).toEqual({ accepted: 5, rejected: 1 });
    // The rejected insight is left out of the support, quality and confidence tiles.
    expect(o.support).toEqual({ current: 3, stale: 0, invalid: 1, unknown: 1 });
    expect(o.quality).toEqual({ qualified: 4, partial: 0, finding: 0, unscored: 1 });
    // E has no tier but its sources were checked: "unrated", never counted as a tier.
    expect(o.corroboration).toEqual({ strong: 0, moderate: 4, exploratory: 0, unrated: 1, unchecked: 0 });
    // B scores highest but its support is no longer valid; F is rejected. Ties: more sources first.
    expect(o.top.map((i) => i.id)).toEqual(["a", "c", "d"]);
  });

  it("never ranks an unscored insight above a scored one", () => {
    const o = summarizeInsights([insight({ id: "u", quality_score: null, quality_tier: null }), insight({ id: "s", quality_score: 7, quality_tier: "finding" })], 2);
    expect(o.top.map((i) => i.id)).toEqual(["s", "u"]);
  });
});

// Codex OV-01 to OV-03 (21 October 2026): every figure opens exactly the records it counted.
const ids = <T extends { id: string }>(rows: T[]) => rows.map((r) => r.id).sort();

describe("overview drill-downs open the records they count", () => {
  // A mixed set: each state appears accepted and rejected, so the in-use restriction is exercised.
  const tiers = ["strong", "moderate", "exploratory", null] as const;
  const rows: OverviewInsight[] = [];
  let n = 0;
  for (const review of ["accepted", "rejected"] as const)
    for (const support of SUPPORT_STATES)
      for (const tier of tiers)
        for (const independent of [null, 0, 1, 3])
          rows.push(
            insight({
              id: `i${n++}`,
              review_status: review,
              support: { status: support },
              confidence_tier: tier,
              independent_source_count: independent,
              quality_tier: (["qualified", "partial", "finding", null] as const)[n % 4],
              quality_score: n % 4 === 3 ? null : 10,
            }),
          );
  const o = summarizeInsights(rows);
  const opened = (f: InsightFilter) => ids(rows.filter((i) => insightMatches(i, f)));
  const counted = (pred: (i: OverviewInsight) => boolean) => ids(rows.filter(pred));
  const inUse = (i: OverviewInsight) => i.review_status !== "rejected";

  it("support figures count and open in-use insights in that state only", () => {
    for (const s of SUPPORT_STATES) {
      const expected = counted((i) => inUse(i) && i.support.status === s);
      expect(opened(inUseWith({ support: s }))).toEqual(expected);
      expect(o.support[s]).toBe(expected.length);
      // A rejected insight in that state is never opened by the figure.
      expect(opened(inUseWith({ support: s })).some((id) => rows.find((r) => r.id === id)!.review_status === "rejected")).toBe(false);
    }
  });

  it("quality figures, Not scored included, count and open the same insights", () => {
    for (const q of QUALITY_STATES) {
      const expected = counted((i) => inUse(i) && (i.quality_tier ?? "unscored") === q);
      expect(opened(inUseWith({ quality: q }))).toEqual(expected);
      expect(o.quality[q]).toBe(expected.length);
    }
  });

  it("an unchecked independence is never strong, moderate or exploratory, whatever tier it carries (OV-02)", () => {
    for (const c of CORROBORATION_STATES) {
      const expected = counted((i) => {
        if (!inUse(i)) return false;
        if (i.independent_source_count === null) return c === "unchecked";
        return (i.confidence_tier ?? "unrated") === c;
      });
      expect(opened(inUseWith({ corroboration: c }))).toEqual(expected);
      expect(o.corroboration[c]).toBe(expected.length);
    }
    // Each tier with unchecked independence lands in "unchecked".
    for (const tier of tiers) {
      expect(summarizeInsights([insight({ confidence_tier: tier, independent_source_count: null })]).corroboration).toMatchObject({ strong: 0, moderate: 0, exploratory: 0, unrated: 0, unchecked: 1 });
    }
    // Zero, one and several checked sources keep their stored tier.
    for (const count of [0, 1, 3]) expect(summarizeInsights([insight({ confidence_tier: "strong", independent_source_count: count })]).corroboration.strong).toBe(1);
  });

  it("review figures count and open accepted and rejected insights", () => {
    expect(opened({ review: "accepted" })).toEqual(counted(inUse));
    expect(opened({ review: "rejected" })).toEqual(counted((i) => !inUse(i)));
    expect(o.review.accepted + o.review.rejected).toBe(rows.length);
  });

  it("the top insights are in use with current support", () => {
    for (const i of summarizeInsights(rows, 50).top) expect(insightMatches(i, inUseWith({ support: "current" }))).toBe(true);
  });
});

describe("theme keys (OV-03)", () => {
  const rows = [
    finding({ id: "plain", theme: "Trust" }),
    finding({ id: "padded", theme: "  Trust  " }),
    finding({ id: "other", theme: "Price" }),
    finding({ id: "null", theme: null }),
    finding({ id: "blank", theme: "" }),
    finding({ id: "spaces", theme: "   " }),
    finding({ id: "named", theme: "No theme" }),
  ];
  it("groups padded and plain themes together, and missing, empty and blank themes together", () => {
    expect(themeKeyOf("  Trust  ")).toBe("Trust");
    expect([themeKeyOf(null), themeKeyOf(undefined), themeKeyOf(""), themeKeyOf("   ")]).toEqual([NO_THEME_KEY, NO_THEME_KEY, NO_THEME_KEY, NO_THEME_KEY]);
    // A researcher's theme that reads "No theme" is its own theme.
    expect(themeKeyOf("No theme")).not.toBe(NO_THEME_KEY);
  });
  it("each theme row's key opens exactly the findings it counts", () => {
    const o = summarizeFindings(rows, []);
    for (const t of o.themes) {
      const opened = ids(rows.filter((f) => themeKeyOf(f.theme) === t.key));
      expect(opened.length).toBe(t.status.total);
    }
    const byKey = Object.fromEntries(o.themes.map((t) => [t.key, ids(rows.filter((f) => themeKeyOf(f.theme) === t.key))]));
    expect(byKey.Trust).toEqual(["padded", "plain"]);
    expect(byKey[NO_THEME_KEY]).toEqual(["blank", "null", "spaces"]);
    expect(byKey["No theme"]).toEqual(["named"]);
    // The label shows the stored text trimmed; the stored text itself is untouched.
    expect(o.themes.find((t) => t.key === NO_THEME_KEY)!.theme).toBe(NO_THEME);
    expect(rows.find((r) => r.id === "padded")!.theme).toBe("  Trust  ");
  });
  it("attention figures and their filter use the same test", () => {
    const mixed = [
      finding({ id: "c1", contradicts_report: true }),
      finding({ id: "c2", is_contradicted: true, status: "pending" }),
      finding({ id: "c3", contradicts_report: true, status: "rejected" }),
      finding({ id: "q1", origin: "stated", quote_match: "none" }),
      finding({ id: "d1", designFreshness: "stale" }),
      finding({ id: "d2", designFreshness: "unknown", status: "rejected" }),
    ];
    const o = summarizeFindings(mixed, []);
    expect(ids(mixed.filter((f) => findingNeedsAttention(f, "contradictions")))).toEqual(["c1", "c2"]);
    expect(o.attention.contradictions).toBe(2);
    expect(o.attention.quoteNotFound).toBe(ids(mixed.filter((f) => findingNeedsAttention(f, "quoteNotFound"))).length);
    expect(o.attention.designChanged).toBe(1);
    expect(o.attention.designUnknown).toBe(0);
  });
});
