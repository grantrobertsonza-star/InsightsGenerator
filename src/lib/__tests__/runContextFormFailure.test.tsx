// R500-01 (Codex re-review, 2026-10-21): the Set objectives form shows an unresolved failed fill
// the same way after an ordinary save as after a reload. The form is rendered with the result of a
// save (useActionState is the boundary controlled here); the server action itself is not called.
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { RunContextSaveResult } from "../runContextActions";
import type { FailedBriefFill } from "../briefFillRecord";

const state = vi.hoisted(() => ({ result: null as unknown }));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, useActionState: () => [state.result, vi.fn(), false] };
});
vi.mock("@/lib/runContextActions", () => ({ saveRunContextFromForm: vi.fn() }));
vi.mock("@/lib/briefFillText", async () => await import("../briefFillText"));
vi.mock("@/components/SubmitButton", () => ({ default: ({ children }: { children: unknown }) => <button type="submit">{children as string}</button> }));

const { default: RunContextForm } = await import("../../app/runs/[id]/RunContextForm");

const DOC = "11111111-1111-4111-8111-111111111111";
const stored: FailedBriefFill = {
  at: "2026-10-21T12:00:00.000Z",
  documents: "the proposal Independent_boundary_proposal.txt",
  reason: "Synthetic model chunk outage (HTTP 503)",
  briefDocumentId: null,
  proposalDocumentId: DOC,
};
const saved = (over: Partial<RunContextSaveResult>): RunContextSaveResult => ({
  ok: true,
  alreadyInProject: 0,
  importedBefore: 0,
  fill: null,
  unresolvedFailure: null,
  ...over,
});
const render = (result: RunContextSaveResult | null, failedFill: FailedBriefFill | null | { error: string } = null) => {
  state.result = result;
  return renderToStaticMarkup(
    <RunContextForm
      runId="synthetic-run"
      businessProblem="Typed problem"
      objective={null}
      audience={null}
      documents={[{ id: DOC, filename: "Independent_boundary_proposal.txt", role: "proposal" }]}
      lastFill={null}
      failedFill={failedFill}
    />,
  );
};

describe("RunContextForm keeps an unresolved failed fill through ordinary saves (R500-01)", () => {
  it("before any save, the stored failure and its retry are shown (as after a reload)", () => {
    const html = render(null, stored);
    expect(html).toContain('data-testid="brief-fill-failed"');
    expect(html).toContain("Synthetic model chunk outage (HTTP 503)");
    expect(html).toContain('data-testid="brief-fill-retry"');
  });

  it("after an ordinary save (no document requested), the still unresolved failure and its retry stay", () => {
    const html = render(saved({ fill: null, unresolvedFailure: stored }), stored);
    expect(html).toContain('data-testid="brief-fill-failed"');
    expect(html).toContain("Synthetic model chunk outage (HTTP 503)");
    expect(html).toContain('data-testid="brief-fill-retry"');
  });

  it("after a successful fill the failure is gone, even if the page's earlier read still had it", () => {
    const html = render(saved({ fill: { status: "filled", objectivesAdded: 1, filledBusinessProblem: false }, unresolvedFailure: null }), stored);
    expect(html).not.toContain('data-testid="brief-fill-failed"');
    expect(html).not.toContain('data-testid="brief-fill-retry"');
  });

  it("another failed attempt replaces the shown failure", () => {
    const html = render(
      saved({
        fill: { status: "failed", documents: "the proposal Independent_boundary_proposal.txt", reason: "Second synthetic timeout", recorded: true, briefDocumentId: null, proposalDocumentId: DOC },
        unresolvedFailure: { ...stored, reason: "Second synthetic timeout" },
      }),
      stored,
    );
    expect(html).toContain("Second synthetic timeout");
    expect(html).not.toContain("Synthetic model chunk outage");
  });

  it("an unreadable failure state stays shown as unknown after a save", () => {
    const html = render(saved({ fill: null, unresolvedFailure: { error: "synthetic read failure" } }), { error: "synthetic read failure" });
    expect(html).toContain('data-testid="brief-fill-unknown"');
    expect(html).not.toContain('data-testid="brief-fill-failed"');
  });
});
