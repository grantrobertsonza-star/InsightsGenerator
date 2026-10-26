// OBJ-REV-012: Review Objectives coverage shows the stored "evidence check degraded" qualification
// for a conclusion generated while data-evidence retrieval was failing, and nothing extra for one
// that was not. The conclusion, status and full wording are unchanged either way, and the
// qualification stays when one objective is selected (shown under its detail in the middle pane on the
// one-page Objectives prototype, with the Update coverage button; the coverage pane steps aside). Static render of the actual component; its
// server actions and the selection hook are controlled. Reload and reassessment are covered by the
// native check e2e/ui/objective-coverage-degraded.check.mjs.
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const selection = vi.hoisted(() => ({ selected: null as { id: string | null; text: string } | null }));
vi.mock("@/lib/objectiveLines", async () => await import("../objectiveLines"));
vi.mock("@/lib/objectiveCoverageActions", () => ({ checkObjectiveCoverage: vi.fn(), suggestObjectivesFromUnmatched: vi.fn() }));
vi.mock("../../app/runs/[id]/ObjectiveSelection", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../app/runs/[id]/ObjectiveSelection")>();
  return { ...actual, useObjectiveSelection: () => ({ selected: selection.selected, select: () => {}, clear: () => {} }) };
});
const { default: ObjectiveCoverage, SelectedObjectiveCoverage } = await import("../../app/runs/[id]/ObjectiveCoverage");

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&apos;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const longConclusion = "The accepted evidence answers this objective: buyers favour delivery speed over price, by a clear margin in every region checked.";
const validation = (order: number, text: string, degraded: boolean) => ({
  item_kind: "objective" as const, item_order: order, item_text: text, status: "resolved" as const,
  conclusion: `${longConclusion} (${text})`, synthesized_insight_ids: ["i1"], inferred: false, evidence_digest_degraded: degraded,
});
const renderSelected = (validations: ReturnType<typeof validation>[]) =>
  renderToStaticMarkup(<SelectedObjectiveCoverage runId="r1" hasObjectiveOrDecision validations={validations} insights={[{ id: "i1", headline: "Speed beats price", review_status: "accepted" }]} />);
const render = (validations: ReturnType<typeof validation>[]) =>
  renderToStaticMarkup(
    <ObjectiveCoverage runId="r1" validations={validations} insights={[{ id: "i1", headline: "Speed beats price", review_status: "accepted" }]} hasObjectiveOrDecision />,
  );

describe("Review Objectives coverage degraded qualification (OBJ-REV-012)", () => {
  it("a degraded conclusion shows the qualification in words; a current one does not; wording and status are kept", () => {
    selection.selected = null;
    const html = render([validation(0, "Degraded objective", true), validation(1, "Current objective", false)]);
    expect(html.match(/data-testid="coverage-evidence-degraded"/g)).toHaveLength(1);
    const t = text(html);
    expect(t.match(/Evidence check degraded/g)).toHaveLength(1);
    expect(t).toContain("Generated while data-evidence retrieval was failing");
    expect(t).toContain(`${longConclusion} (Degraded objective)`);
    expect(t).toContain(`${longConclusion} (Current objective)`);
    expect(t.match(/Answered/g)).toHaveLength(2);
    // The qualification sits with the degraded item, before the next item starts.
    expect(t.indexOf("Generated while data-evidence retrieval was failing")).toBeLessThan(t.indexOf("Current objective"));
  });

  it("keeps the qualification when the degraded objective is selected, and shows none when only a current one is", () => {
    const both = [validation(0, "Degraded objective", true), validation(1, "Current objective", false)];
    selection.selected = { id: null, text: "Degraded objective" };
    expect(text(renderSelected(both))).toContain("Evidence check degraded");
    expect(text(renderSelected(both))).not.toContain("(Current objective)");
    // The coverage pane steps aside (2026-10-26): the middle tile has the verdict and the one button
    // that updates coverage, so neither appears twice.
    expect(render(both)).toBe("");
    expect(text(renderSelected(both))).toContain("Update coverage");
    selection.selected = { id: null, text: "Current objective" };
    const t = text(renderSelected(both));
    expect(t).not.toContain("Evidence check degraded");
    expect(t).toContain(`${longConclusion} (Current objective)`);
  });

  it("says when the selected objective was not in the last check, and renders nothing with none selected", () => {
    selection.selected = { id: null, text: "An objective added since" };
    expect(text(renderSelected([validation(0, "Degraded objective", true)]))).toContain("was not in the last coverage check");
    expect(text(renderSelected([]))).toContain("Not checked against the insights yet");
    selection.selected = null;
    expect(renderSelected([validation(0, "Degraded objective", true)])).toBe("");
  });
});
