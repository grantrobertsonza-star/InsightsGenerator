// The Recommendations review opened from its overview (Grant, 2026-10-21): the request's filters
// are applied during render, so the actual review component lists exactly the recommendations the
// overview counted, says how many of how many it shows, and marks the one asked for. Rendered
// statically; scrolling and clicking are established by the browser check, not here.
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/recommendationActions", () => ({}));
vi.mock("@/lib/qualityActions", () => ({}));
vi.mock("@/components/icons", async () => await import("../../components/icons"));
vi.mock("@/lib/recommendationDecisions", async () => await import("../recommendationDecisions"));
vi.mock("@/lib/evidenceTrailActions", () => ({ loadEvidenceTrailAction: async () => ({ ok: false, error: "not in this test" }), loadObjectiveTrailAction: async () => ({ ok: false, error: "not in this test" }) }));
vi.mock("@/lib/supportStatusShared", async () => await import("../supportStatusShared"));
vi.mock("@/lib/recommendationQualification", async () => await import("../recommendationQualification"));
vi.mock("@/lib/figureChecks", async () => await import("../figureChecks"));
vi.mock("@/lib/numberTrace", async () => await import("../numberTrace"));
vi.mock("@/lib/recommendationOverview", async () => await import("../recommendationOverview"));

const { default: Review } = await import("../../app/runs/[id]/SynthesizedRecommendationsReview");
type Props = Parameters<typeof Review>[0];
type Row = Props["recommendations"][number];

const row = (id: string, p: Partial<Row>): Row => ({
  id,
  synthesized_insight_id: `i-${id}`,
  synthesized_insight_headline: `Insight ${id}`,
  action_text: `Action ${id}`,
  owner_role: "Owner",
  owner_feasibility_note: "",
  timeline: "Q1",
  metric: "Metric",
  priority: "medium",
  assumptions_and_risks: "",
  alternatives_considered: "",
  source: "ai_suggested",
  status: "accepted",
  edited: false,
  confidence_tier: null,
  quality_score: null,
  quality_tier: null,
  support: { status: "current", reasons: [] },
  decision_state: null,
  ...p,
});
const rows: Row[] = [
  row("a", { priority: "high" }),
  row("b", { support: { status: "invalid", reasons: [] } }),
  row("c", { status: "rejected", support: { status: "invalid", reasons: [] } }),
  row("d", { support: undefined, decision_state: "earlier" }),
];
const render = (request?: Props["request"]) =>
  renderToStaticMarkup(<Review runId="run" recommendations={rows} insightOptions={[]} parkedInsights={[]} hasDecision hasInsights request={request} />);
const cards = (html: string) => [...html.matchAll(/data-testid="recommendation-card" data-recommendation-id="([^"]+)"/g)].map((m) => m[1]);

describe("SynthesizedRecommendationsReview opened from the overview", () => {
  it("without a request lists accepted and pending, rejected only in the folded group", () => {
    const html = render();
    expect(cards(html)).toEqual(["a", "b", "d"]);
    expect(html).not.toContain('data-testid="recommendations-showing"');
  });

  it("a support filter lists exactly the matching recommendations in use, with the count", () => {
    const html = render({ start: { support: "invalid" }, n: 1 });
    expect(cards(html)).toEqual(["b"]);
    expect(html).toContain("Showing 2 of 4"); // the rejected one matches too, and stays folded on the right
  });

  it("absent support filters as not checked, never as current", () => {
    expect(cards(render({ start: { support: "unknown" }, n: 1 }))).toEqual(["d"]);
    expect(cards(render({ start: { support: "current" }, n: 1 }))).toEqual(["a"]);
  });

  it("the rejected filter lists the rejected recommendations in the main list, once", () => {
    const html = render({ start: { review: "rejected" }, n: 1 });
    expect(cards(html)).toEqual(["c"]);
  });

  it("decision and priority filters, and the selected recommendation is marked", () => {
    expect(cards(render({ start: { decision: "earlier" }, n: 1 }))).toEqual(["d"]);
    expect(cards(render({ start: { priority: "high" }, n: 1 }))).toEqual(["a"]);
    const html = render({ start: { selectedId: "b" }, n: 1 });
    expect(cards(html)).toEqual(["a", "b", "d"]);
    expect(html).toMatch(/data-recommendation-id="b" data-priority="medium" data-selected="true"/);
  });

  // Codex OV-01: the overview's in-use figures carry the in-use restriction, so the rejected
  // recommendation with the same support is not listed or counted.
  it("an in-use drill-down lists and counts only recommendations not rejected", () => {
    const html = render({ start: { inUse: true, support: "invalid" }, n: 1 });
    expect(cards(html)).toEqual(["b"]);
    expect(html).toContain("Showing 1 of 4");
    expect(html).toContain("In use (not rejected)");
    expect(cards(render({ start: { inUse: true }, n: 1 }))).toEqual(["a", "b", "d"]);
  });
});
