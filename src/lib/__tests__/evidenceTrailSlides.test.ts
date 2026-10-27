// The deck's evidence-trail slides (evidence trail extras, 26 October 2026): a long trail continues on
// further slides with every line kept whole, in order, so a break stated at the end of a line is never cut.
import { describe, expect, it, vi } from "vitest";
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));
import { trailOutline, type EvidenceTrail, type TrailNode } from "../evidenceTrail";
import { trailSlidePages } from "../evidenceTrailSlides";

const node = (kind: TrailNode["kind"], label: string, extra: Partial<TrailNode> = {}): TrailNode => ({ kind, id: null, label, details: [], state: "current", note: null, children: [], ...extra });

describe("trailSlidePages", () => {
  it("keeps a short trail on one slide", () => {
    const trail: EvidenceTrail = { purpose: [node("decision", "Whether to cut fees")], root: node("recommendation", "Cut fees", { children: [node("insight", "Fees drive churn")] }) };
    expect(trailSlidePages(trail)).toEqual([trailOutline(trail)]);
  });

  it("splits a long trail across slides without dropping, reordering or shortening a line", () => {
    const pres = Array.from({ length: 30 }, (_, i) =>
      node("pre_insight", `Pre-insight ${i} ${"with a long headline ".repeat(4)}`, {
        children: [node("finding", `Finding ${i}`, { state: i === 29 ? "broken" : "current", note: i === 29 ? "Rejected by the researcher." : null })],
      }),
    );
    const trail: EvidenceTrail = { purpose: [], root: node("recommendation", "Cut fees", { children: [node("insight", "Fees", { children: pres })] }) };
    const pages = trailSlidePages(trail);
    expect(pages.length).toBeGreaterThan(2);
    expect(pages.flat()).toEqual(trailOutline(trail));
    expect(pages.at(-1)!.at(-1)!.text).toBe("Finding: Finding 29 [Break in the trail: Rejected by the researcher.]");
  });

  it("gives a single line longer than a slide a slide of its own rather than cutting it", () => {
    const long = "x".repeat(4000);
    const trail: EvidenceTrail = { purpose: [], root: node("recommendation", "Cut fees", { children: [node("insight", long)] }) };
    const pages = trailSlidePages(trail);
    expect(pages.map((p) => p.length)).toEqual([1, 1]);
    expect(pages[1][0].text).toBe(`Insight: ${long}`);
  });
});
