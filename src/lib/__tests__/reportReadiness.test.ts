import { describe, expect, it } from "vitest";
import { formatGeneratedAt, summarizeReportReadiness, type ReadinessInsight } from "../reportReadiness";
import { summariseNarrativeSupport } from "../narrativeSupportSummary";
import type { SupportStatus } from "../supportStatusShared";

const ins = (id: string, status: SupportStatus, review: "accepted" | "rejected" = "accepted"): ReadinessInsight => ({
  id,
  review_status: review,
  support: { status, reasons: [] },
});

describe("summarizeReportReadiness", () => {
  it("counts what the exports include: no longer valid is left out, changed and not checked stay in", () => {
    const insights = [ins("a", "current"), ins("b", "stale"), ins("c", "invalid"), ins("d", "unknown"), ins("e", "current", "rejected")];
    const recs = [
      { id: "r1", status: "accepted" as const, synthesized_insight_id: "a" },
      { id: "r2", status: "accepted" as const, synthesized_insight_id: "c" }, // inherits invalid
      { id: "r3", status: "accepted" as const, synthesized_insight_id: "e" }, // insight rejected
      { id: "r4", status: "pending" as const, synthesized_insight_id: "b" },
      { id: "r5", status: "rejected" as const, synthesized_insight_id: "a" },
    ];
    const r = summarizeReportReadiness(insights, recs, null, null);
    expect(r.insights).toEqual({ accepted: 4, rejected: 1, support: { current: 1, stale: 1, invalid: 1, unknown: 1 }, included: 3 });
    expect(r.recommendations).toEqual({
      accepted: 2,
      pending: 1,
      onUnacceptedInsight: 1,
      support: { current: 1, stale: 0, invalid: 1, unknown: 0 },
      included: 1,
    });
    // No narrative yet: nothing is claimed about one.
    expect(r.narrative).toBeNull();
    expect(r.narrativeFigures).toBeNull();
  });

  it("counts the narrative's cited insights exactly as its support line does, a rejected or missing one as no longer valid", () => {
    const insights = [ins("a", "current"), ins("b", "unknown"), ins("c", "current", "rejected"), ins("d", "current")];
    const narrative = {
      generated_at: "2026-10-21T08:00:00.000Z",
      pillars: [
        { insight_ids: ["a", "b"], insight_overflow_count: 1 },
        { insight_ids: ["a", "c", "gone"], insight_overflow_count: 0 },
      ],
    };
    const r = summarizeReportReadiness(insights, [], narrative, "needs_review");
    expect(r.narrative).toEqual({
      generatedAt: "2026-10-21 08:00 UTC",
      cited: 4,
      support: { current: 1, stale: 0, invalid: 2, unknown: 1 },
      notCited: 1, // d
      overflow: 1,
      pillars: 2,
    });
    // The same counts the banner over the narrative states (it is given accepted insights' support).
    const banner = summariseNarrativeSupport(
      narrative.pillars.flatMap((p) => p.insight_ids),
      { a: insights[0].support, b: insights[1].support, d: insights[3].support },
    );
    expect(banner?.counts).toEqual(r.narrative?.support);
    expect(r.narrativeFigures).toBe("needs_review");
  });

  it("a narrative whose cited insights are all current counts them all as current", () => {
    const r = summarizeReportReadiness([ins("a", "current"), ins("b", "current")], [], {
      generated_at: "2026-10-21T08:00:00.000Z",
      pillars: [{ insight_ids: ["a", "b", "a"], insight_overflow_count: 0 }],
    }, "traced");
    expect(r.narrative?.support).toEqual({ current: 2, stale: 0, invalid: 0, unknown: 0 });
    expect(r.narrative?.notCited).toBe(0);
  });

  it("nothing accepted and no narrative: every count is zero", () => {
    const r = summarizeReportReadiness([], [], null, null);
    expect(r.insights.accepted).toBe(0);
    expect(r.recommendations.accepted).toBe(0);
    expect(r.narrative).toBeNull();
  });

  // The database driver hands generated_at (timestamptz) to the page as a Date: the Insights report
  // section crashed on "f.slice is not a function" when it was treated as a string.
  it("accepts generated_at as a Date or a string, and says nothing about a missing or invalid one", () => {
    const narrative = (generated_at: string | Date | null) => ({ generated_at, pillars: [{ insight_ids: ["a"], insight_overflow_count: 0 }] });
    const insights = [ins("a", "current")];
    expect(summarizeReportReadiness(insights, [], narrative(new Date("2026-10-21T08:15:30.000Z")), null).narrative?.generatedAt).toBe("2026-10-21 08:15 UTC");
    expect(summarizeReportReadiness(insights, [], narrative("2026-10-21T08:15:30.000Z"), null).narrative?.generatedAt).toBe("2026-10-21 08:15 UTC");
    expect(summarizeReportReadiness(insights, [], narrative(null), null).narrative?.generatedAt).toBeNull();
    expect(formatGeneratedAt("not a date")).toBeNull();
    expect(formatGeneratedAt(new Date("invalid"))).toBeNull();
    expect(formatGeneratedAt(undefined)).toBeNull();
  });

  it("matches the export rules for each support state: only no longer valid is left out, of insights and the recommendations on them", () => {
    const insights = [ins("cur", "current"), ins("st", "stale"), ins("unk", "unknown"), ins("inv", "invalid"), ins("rej", "invalid", "rejected")];
    const recs = (["cur", "st", "unk", "inv", "rej"] as const).map((i) => ({ id: `r-${i}`, status: "accepted" as const, synthesized_insight_id: i }));
    const r = summarizeReportReadiness(insights, [...recs, { id: "p", status: "pending" as const, synthesized_insight_id: "cur" }], null, null);
    // Insights: four accepted, the invalid one left out; stale and unknown go in, qualified.
    expect(r.insights).toEqual({ accepted: 4, rejected: 1, support: { current: 1, stale: 1, invalid: 1, unknown: 1 }, included: 3 });
    // Recommendations inherit their insight's support; the one on the rejected insight is never used.
    expect(r.recommendations).toEqual({ accepted: 4, pending: 1, onUnacceptedInsight: 1, support: { current: 1, stale: 1, invalid: 1, unknown: 1 }, included: 3 });
  });
});
