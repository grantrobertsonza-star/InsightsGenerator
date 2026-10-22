// R500-01 (Codex re-review, 2026-10-21): the Set objectives form shows an unresolved failed fill
// the same way after an ordinary save as after a reload. The form is rendered with the result of a
// save (useActionState is the boundary controlled here); the server action itself is not called.
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { RunContextSaveResult } from "../runContextActions";
import type { FailedBriefFill } from "../briefFillRecord";
import { INITIAL_BRIEF_FILL_FORM_STATE, nextBriefFillFormState, type BriefFillFormState } from "../../app/runs/[id]/briefFillCarry";

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
  already: null,
  ...over,
});
// The form's state after a sequence of saves, built with the form's own reducer (briefFillCarry).
const after = (...results: RunContextSaveResult[]): BriefFillFormState => results.reduce(nextBriefFillFormState, INITIAL_BRIEF_FILL_FORM_STATE);
const render = (result: RunContextSaveResult | BriefFillFormState | null, failedFill: FailedBriefFill | null | { error: string } = null) => {
  state.result = result === null ? INITIAL_BRIEF_FILL_FORM_STATE : "unrecordedFailure" in result ? result : after(result);
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
    const html = render(saved({ fill: { status: "filled", objectivesAdded: 1, filledBusinessProblem: false, reread: false, suggestionsAdded: 0, unusedFromDocument: 0, typedAdded: 0 }, unresolvedFailure: null }), stored);
    expect(html).not.toContain('data-testid="brief-fill-failed"');
    expect(html).not.toContain('data-testid="brief-fill-retry"');
  });

  it("another failed attempt replaces the shown failure", () => {
    const html = render(
      saved({
        fill: { status: "failed", documents: "the proposal Independent_boundary_proposal.txt", reason: "Second synthetic timeout", recorded: true, briefDocumentId: null, proposalDocumentId: DOC, reread: false },
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

  // R500-R01: a failure that could not be recorded exists only in the response; the open form keeps it.
  const unrecorded = saved({
    fill: { status: "failed", documents: "the proposal Independent_boundary_proposal.txt", reason: "Synthetic outage, not recorded", recorded: false, briefDocumentId: null, proposalDocumentId: DOC, reread: false },
    unresolvedFailure: null,
  });
  const ordinary = saved({ fill: null, unresolvedFailure: null });

  it("an unrecorded failure stays, with its retry and the not-recorded note, through several ordinary saves", () => {
    const html = render(after(unrecorded, ordinary, ordinary));
    expect(html).toContain("Synthetic outage, not recorded");
    expect(html).toContain('data-testid="brief-fill-retry"');
    expect(html).toContain("could not be recorded");
  });

  it("a successful fill clears an unrecorded failure", () => {
    const html = render(after(unrecorded, ordinary, saved({ fill: { status: "filled", objectivesAdded: 1, filledBusinessProblem: false, reread: false, suggestionsAdded: 0, unusedFromDocument: 0, typedAdded: 0 }, unresolvedFailure: null }), ordinary));
    expect(html).not.toContain('data-testid="brief-fill-failed"');
  });

  it("a newer recorded failure replaces an unrecorded one", () => {
    const newer = saved({
      fill: { status: "failed", documents: "the proposal Independent_boundary_proposal.txt", reason: "Second synthetic timeout", recorded: true, briefDocumentId: null, proposalDocumentId: DOC, reread: false },
      unresolvedFailure: { ...stored, reason: "Second synthetic timeout" },
    });
    const html = render(after(unrecorded, newer, saved({ fill: null, unresolvedFailure: { ...stored, reason: "Second synthetic timeout" } })));
    expect(html).toContain("Second synthetic timeout");
    expect(html).not.toContain("Synthetic outage, not recorded");
  });

  it("an unrecorded failure is still shown when the stored state cannot be read either", () => {
    const html = render(after(unrecorded, saved({ fill: null, unresolvedFailure: { error: "synthetic read failure" } })));
    expect(html).toContain("Synthetic outage, not recorded");
    expect(html).not.toContain('data-testid="brief-fill-unknown"');
  });

  // Grant, 2026-10-22: a document that already filled the project is not read again.
  it("an already used document says so and offers Read it again; nothing is shown as failed", () => {
    const html = render(saved({ already: { documents: "the proposal Independent_boundary_proposal.txt", at: "2026-10-21T12:00:00.000Z", objectivesFromIt: 2, briefDocumentId: null, proposalDocumentId: DOC } }));
    expect(html).toContain('data-testid="brief-fill-already"');
    expect(html).toContain("Already filled from the proposal Independent_boundary_proposal.txt on 21 Oct 2026; 2 objectives came from it");
    expect(html).toContain('data-testid="brief-fill-reread"');
    expect(html).not.toContain('data-testid="brief-fill-failed"');
  });

  it("a re-read says how many new lines wait on Review and that nothing was added to the objectives", () => {
    const html = render(saved({ fill: { status: "filled", objectivesAdded: 0, filledBusinessProblem: false, reread: true, suggestionsAdded: 2, unusedFromDocument: 0, typedAdded: 0 } }));
    expect(html).toContain('data-testid="brief-fill-reread-result"');
    expect(html).toContain("2 new lines are waiting on Review objectives as suggestions");
  });
  // IR-03 (Codex, 2026-10-22): a re-read whose new lines were not used because the objectives box
  // was not empty must not say "nothing new was found".
  it("a typed re-read with new document lines says they were found but not added, and that the typed objective was added", () => {
    const html = render(saved({ fill: { status: "filled", objectivesAdded: 1, filledBusinessProblem: false, reread: true, suggestionsAdded: 0, unusedFromDocument: 1, typedAdded: 1 } }));
    expect(html).toContain("Read again: 1 new line was found but not added, because what you typed in the objectives box takes priority over the document.");
    expect(html).toContain("1 objective you typed was added.");
    expect(html).not.toContain("nothing new was found");
    expect(html).not.toContain("Nothing was added to your objectives");
  });

  it("a re-read with nothing new and nothing typed still says nothing new was found", () => {
    const html = render(saved({ fill: { status: "filled", objectivesAdded: 0, filledBusinessProblem: false, reread: true, suggestionsAdded: 0, unusedFromDocument: 0, typedAdded: 0 } }));
    expect(html).toContain("Read again: nothing new was found. Nothing was added to your objectives.");
  });

  // IR-01 (Codex, 2026-10-22): a mixed fill that lost to a fill of one of its documents shows the
  // still-new document as not filled, with its retry, beside the already message for the other.
  it("a mixed fill overtaken by another fill shows the still-new document as failed with a retry, and the used one as already filled", () => {
    const html = render(saved({
      already: { documents: "the proposal Independent_boundary_proposal.txt", at: "2026-10-22T08:00:00.000Z", objectivesFromIt: 2, briefDocumentId: null, proposalDocumentId: DOC },
      fill: { status: "failed", documents: "the brief Brief.docx", reason: "another fill from the proposal Independent_boundary_proposal.txt finished while this one was reading, so this fill was not saved", recorded: true, briefDocumentId: "22222222-2222-4222-8222-222222222222", proposalDocumentId: null, reread: false },
    }));
    expect(html).toContain('data-testid="brief-fill-already"');
    expect(html).toContain('data-testid="brief-fill-failed"');
    expect(html).toContain("the brief Brief.docx");
    expect(html).toContain("finished while this one was reading");
  });
});
