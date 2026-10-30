// OBJ-REV-001/002 Rule B: UI consumer check. Executed rendering, not a browser: the real
// EvidenceGroups / partitionEvidenceItems from ObjectiveEvidence.tsx are rendered to static HTML with
// react-dom/server, fed by the real rollUp classification. The component's `@/` imports are mapped
// here because this repo has no Vitest alias configuration: the two server-action modules are
// stubbed (no action is called during a static render) and objectiveLines is the real module.
// Mounted interaction (clicks, hydration) and a real browser remain separate checks.
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/objectiveEvidenceActions", () => ({}));
vi.mock("@/lib/crosstabActions", () => ({}));
vi.mock("@/lib/objectiveLines", async () => await import("../objectiveLines"));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));
vi.mock("../anthropic", () => ({ anthropic: {}, CLAUDE_MODEL: "test" }));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn() }));

import type { EvidenceQuestion } from "../objectiveEvidence";

function q(id: string, kind: "objective" | "decision", order: number, link: string | null, text: string, extra: Partial<EvidenceQuestion> = {}): EvidenceQuestion {
  return {
    id,
    item_kind: kind,
    item_order: order,
    objective_candidate_id: kind === "objective" ? link : null,
    decision_candidate_id: kind === "decision" ? link : null,
    origin_candidate_id: null,
    origin_recorded: false,
    item_text: text,
    question: `Question ${id}`,
    request_text: "req",
    supports_if: "",
    against_if: "",
    expectation: null,
    source: "auto",
    excluded: false,
    question_revision: 1,
    approval: "proposed",
    approved_revision: null,
    approved_at: null,
    stance: null,
    basis: null,
    error: null,
    results: [],
    ...extra,
  };
}

const noop = () => {};
const handlers = {
  runId: "run-1",
  editing: null,
  draft: { question: "", request_text: "", supports_if: "", against_if: "" },
  onDraft: noop,
  onStartEdit: noop,
  onCancelEdit: noop,
  onSave: noop,
  onToggle: noop,
  onRetry: noop,
  onApprove: noop,
  busy: false,
};

async function setup() {
  const { rollUp, currentItemKey } = await import("../objectiveEvidence");
  const ui = await import("../../app/runs/[id]/ObjectiveEvidence");
  // Current: free-text objective 0 "Brand awareness" and decision candidate dec-B.
  const currentKeys = new Set([
    currentItemKey({ kind: "objective", order: 0, text: "Brand awareness", candidateId: null }),
    currentItemKey({ kind: "decision", order: 0, text: "Cut prices", candidateId: "dec-B" }),
  ]);
  const items = rollUp(
    [
      q("current-text", "objective", 0, null, "Brand awareness", { origin_recorded: true }),
      q("unknown-same-text", "objective", 0, null, "Brand awareness", { source: "manual" }),
      q("deleted-cand", "objective", 0, null, "Brand awareness", { source: "edited", origin_candidate_id: "cand-gone", origin_recorded: true }),
      q("current-decision", "decision", 0, "dec-B", "Cut prices", { origin_candidate_id: "dec-B", origin_recorded: true }),
    ],
    currentKeys,
  );
  return { items, ui };
}

describe("ObjectiveEvidence rendering of Rule B orphans", () => {
  it("renders orphaned groups in a separate, labelled section with their reason; current groups outside it", async () => {
    const { items, ui } = await setup();
    const html = renderToStaticMarkup(createElement(ui.EvidenceGroups, { items, selected: null, originAvailable: true, busy: false, handlers }));
    const [beforeOrphans, orphanSection] = html.split('data-testid="orphaned-evidence"');
    expect(orphanSection).toBeDefined();
    expect(orphanSection).toContain("No longer linked to a current objective or decision");
    expect(beforeOrphans).toContain("Question current-text");
    expect(beforeOrphans).toContain("Question current-decision");
    expect(beforeOrphans).not.toContain("Question unknown-same-text");
    expect(beforeOrphans).not.toContain("Question deleted-cand");
    expect(orphanSection).toContain("Question unknown-same-text");
    expect(orphanSection).toContain("Origin unknown");
    expect(orphanSection).toContain("Question deleted-cand");
    expect(orphanSection).toContain("Its objective or decision was removed.");
    expect(html).not.toContain("origin-migration-notice");
  });

  it("selecting the objective with the same wording shows only the current group; orphans are never attached through the text fallback", async () => {
    const { items, ui } = await setup();
    const selected = { id: null, text: "Brand awareness" };
    const parts = ui.partitionEvidenceItems(items, selected);
    expect(parts.shown.map((i) => i.key)).toEqual(["text:objective:0:brand awareness"]);
    expect(parts.orphans.map((i) => i.key)).toEqual(["unknown:unknown-same-text", "deleted:objective:cand-gone"]);
    const html = renderToStaticMarkup(createElement(ui.EvidenceGroups, { items, selected, originAvailable: true, busy: false, handlers }));
    const [beforeOrphans] = html.split('data-testid="orphaned-evidence"');
    expect(beforeOrphans).toContain("Question current-text");
    expect(beforeOrphans).not.toContain("Question current-decision");
    expect(beforeOrphans).not.toContain("Question unknown-same-text");
  });

  it("a selected objective with no current evidence says so, even when an orphan shares its wording", async () => {
    const { ui } = await setup();
    const { rollUp } = await import("../objectiveEvidence");
    const items = rollUp([q("only-orphan", "objective", 0, null, "Pricing", { source: "manual" }), q("dec", "decision", 0, "dec-B", "Cut prices")], new Set(["id:dec-B"]));
    const html = renderToStaticMarkup(
      createElement(ui.EvidenceGroups, { items, selected: { id: null, text: "Pricing" }, originAvailable: true, busy: false, handlers }),
    );
    expect(html).toContain("No evidence questions for this objective yet.");
  });

  it("shows the actionable 0095 notice when the load reported originAvailable = false", async () => {
    const { items, ui } = await setup();
    const html = renderToStaticMarkup(createElement(ui.EvidenceGroups, { items, selected: null, originAvailable: false, busy: false, handlers }));
    expect(html).toContain('data-testid="origin-migration-notice"');
    expect(html).toContain("0095_objective_evidence_origin");
    expect(html).toContain("npx.cmd supabase migration up");
  });

  it("group keys are distinct even when groups share kind, position and wording", async () => {
    const { items } = await setup();
    const keys = items.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
