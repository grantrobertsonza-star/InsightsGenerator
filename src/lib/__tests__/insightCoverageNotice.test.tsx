// Batch 64, Codex EC10K-F01 (screen): the Insights review said nothing when verified findings had no insight,
// so a partial or bounded generation read as complete. The notice states the gap with the last attempt's
// reason, says when the count could not be read, and shows nothing when every finding is covered or a
// validate project is still waiting for its decision. Rendered from the actual component.
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/discoveryClassification", async () => await import("../discoveryClassification"));
vi.mock("@/lib/caveatLabels", async () => await import("../caveatLabels"));
vi.mock("@/lib/decisionContext", async () => await import("../decisionContext"));
vi.mock("@/lib/supportStatusShared", async () => await import("../supportStatusShared"));
vi.mock("@/lib/figureChecks", async () => await import("../figureChecks"));
vi.mock("@/lib/numberTrace", async () => await import("../numberTrace"));

const { default: InsightsReview, InsightCoverageNotice } = await import("../../app/runs/[id]/InsightsReview");
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const gap = (uncovered: number | null, extra: Partial<{ waitingForDecision: boolean; error: string | null; reason: string | null }> = {}) => ({ uncovered, waitingForDecision: false, error: null, reason: null, ...extra });

describe("InsightCoverageNotice (EC10K-F01)", () => {
  it("states how many verified findings have no insight, with the last attempt's reason", () => {
    const t = text(renderToStaticMarkup(<InsightCoverageNotice gap={gap(20, { reason: "20 verified finding(s) still have no insight after 8 pass(es)." })} />));
    expect(t).toContain("20 verified findings have no insight yet, so this list is incomplete.");
    expect(t).toContain("Last attempt: 20 verified finding(s) still have no insight after 8 pass(es).");
    expect(t).toContain("drafts only the missing ones");
    expect(text(renderToStaticMarkup(<InsightCoverageNotice gap={gap(1)} />))).toContain("1 verified finding has no insight yet");
  });
  it("says the count is unknown when it could not be read; nothing when complete or waiting for a decision", () => {
    expect(text(renderToStaticMarkup(<InsightCoverageNotice gap={gap(null, { error: "connection lost" })} />))).toBe("Whether every verified finding has an insight could not be checked: connection lost.");
    expect(renderToStaticMarkup(<InsightCoverageNotice gap={gap(0)} />)).toBe("");
    expect(renderToStaticMarkup(<InsightCoverageNotice gap={gap(0, { waitingForDecision: true })} />)).toBe("");
  });
  it("appears in the review whether or not any insight exists yet", () => {
    const empty = text(renderToStaticMarkup(<InsightsReview insights={[]} inputState="report_and_data" totalFindings={3} verdictSummary={null} insightError="Cut off." failedVerdictSamples={[]} coverageGap={gap(3, { reason: "ignored on the empty view" })} />));
    expect(empty).toContain("Last automatic attempt failed: Cut off.");
    expect(empty).toContain("3 verified findings have no insight yet");
    expect(empty).not.toContain("ignored on the empty view");
    const insight = { id: "i1", headline: "Access matters", observation: "o", tension: "t", implication: "i", decision_context: null, finding_text: "f", theme: "Access", verdict_tier: "robust" as const, from_report: true, verification_basis: "report_only" as const, caveats: [], written_for_earlier_decisions: false, support_status: "current" as const, support_summary: null };
    const listed = text(renderToStaticMarkup(<InsightsReview insights={[insight]} inputState="report_and_data" totalFindings={3} verdictSummary={null} insightError={null} failedVerdictSamples={[]} coverageGap={gap(2, { reason: "Some were left out." })} />));
    expect(listed).toContain("2 verified findings have no insight yet, so this list is incomplete. Last attempt: Some were left out.");
    expect(listed).toContain("Access matters");
  });
});
