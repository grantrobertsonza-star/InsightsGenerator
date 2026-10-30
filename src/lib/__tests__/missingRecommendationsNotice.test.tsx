// REC-002: the actual incomplete-run notice on the recommendations panel, rendered statically, and
// the rule that decides when it shows (accepted insights with an action plan and no recommendation
// of any status). Mounted orchestration (the retry click) is not established here.
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

const { MissingRecommendationsNotice, missingRecommendationCount } = await import("../../app/runs/[id]/SynthesizedRecommendationsReview");

const parked = (action: "has_action" | "retained_no_action", hasAny: boolean) => ({
  id: Math.random().toString(),
  headline: "h",
  observation: "o",
  tension: "t",
  implication: "i",
  action_plan_status: action,
  has_any_recommendation: hasAny,
});

describe("MissingRecommendationsNotice (REC-002)", () => {
  it("counts only insights with an action plan and no recommendation at all", () => {
    expect(
      missingRecommendationCount([
        parked("has_action", false),
        parked("has_action", false),
        parked("has_action", true), // has a pending/rejected one: a review decision, not a gap
        parked("retained_no_action", false), // deliberately parked by the synthesizer
      ]),
    ).toBe(2);
  });

  it("says how many are missing, that written ones are kept, and offers a retry; nothing when complete", () => {
    const html = renderToStaticMarkup(<MissingRecommendationsNotice count={2} onRetry={() => {}} busy={false} />);
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    expect(text).toContain("2 accepted insights with an action plan have no recommendation yet");
    expect(text).toContain("already written are kept");
    expect(text).toContain("Generate the missing ones");
    expect(renderToStaticMarkup(<MissingRecommendationsNotice count={0} onRetry={() => {}} busy={false} />)).toBe("");
  });
});
