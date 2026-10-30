// Permanent regression tests for IMP-014 (Brief 37/38 repair): "track the latest scheduled/
// requested save, not only the latest applied response... ensure newer success, conflict and
// failure each reconcile the picker and saved-state reference consistently," and (Brief 38,
// Codex re-review) "add a visit identity that changes on every document transition, including
// A -> B -> A... bind saves and hydration responses to that visit." Exercises the actual
// exported decision function CrosstabWorkspace.tsx's save-response handler calls
// (reconcileSaveResponse), not a reimplementation of its logic.
import { describe, expect, it } from "vitest";
import { reconcileSaveResponse, recordRequestedSave, type SaveReconciliationState } from "../saveResponseOrdering";
import type { DataSetup } from "../dataSetupShared";

const BASE_SETUP: DataSetup = {
  unit: "respondents",
  layout: "rows_are_cases",
  method: "survey",
  accepted: false,
  wave: null,
  waveDate: null,
  waveIncluded: true,
  design: null,
  headerRowsSkipped: null,
};

function freshState(): SaveReconciliationState {
  return { requestedSeqByDoc: new Map(), appliedSeqByDoc: new Map() };
}

const explicitDesign = (psu: string): DataSetup => ({ ...BASE_SETUP, design: { mode: "explicit", psu, strata: null } });

// All pre-Brief-38 tests below schedule and resolve everything within a single visit (1), so
// the new visit check is a no-op for them - they retain exactly the behavior Brief 37 fixed.
const SAME_VISIT = { currentVisit: 1, savingForVisit: 1 };

describe("reconcileSaveResponse (saveResponseOrdering.ts) - IMP-014", () => {
  it("Codex's exact reproduction: old save -> new save -> old conflict resolves -> new success resolves", () => {
    const state = freshState();
    const docId = "doc-1";

    // Old save scheduled first.
    recordRequestedSave(state.requestedSeqByDoc, docId, 1);
    // New save scheduled next, while the old save is still in flight - nothing has resolved yet.
    recordRequestedSave(state.requestedSeqByDoc, docId, 2);

    // The OLD save's response now resolves, as a conflict (another write landed in between).
    const oldConflictDecision = reconcileSaveResponse(state, {
      currentDocumentId: docId,
      savingForDocumentId: docId,
      seq: 1,
      outcome: { kind: "conflict", current: explicitDesign("q_old_conflict") },
      ...SAME_VISIT,
    });
    // The critical assertion: an old response must not change newer pending picker state, even
    // though nothing newer has applied yet.
    expect(oldConflictDecision).toEqual({ action: "ignore" });

    // The NEW save's response now resolves, as a success.
    const newSuccessDecision = reconcileSaveResponse(state, {
      currentDocumentId: docId,
      savingForDocumentId: docId,
      seq: 2,
      outcome: { kind: "success", setup: explicitDesign("q_new_success") },
      ...SAME_VISIT,
    });
    expect(newSuccessDecision).toEqual({ action: "apply-success", setup: explicitDesign("q_new_success") });
  });

  it("in-order success, conflict and failure all apply when each is genuinely the latest requested", () => {
    const state = freshState();
    const docId = "doc-1";

    recordRequestedSave(state.requestedSeqByDoc, docId, 1);
    expect(
      reconcileSaveResponse(state, {
        currentDocumentId: docId,
        savingForDocumentId: docId,
        seq: 1,
        outcome: { kind: "success", setup: BASE_SETUP },
        ...SAME_VISIT,
      }),
    ).toEqual({ action: "apply-success", setup: BASE_SETUP });

    recordRequestedSave(state.requestedSeqByDoc, docId, 2);
    const conflictCurrent = explicitDesign("q2");
    expect(
      reconcileSaveResponse(state, {
        currentDocumentId: docId,
        savingForDocumentId: docId,
        seq: 2,
        outcome: { kind: "conflict", current: conflictCurrent },
        ...SAME_VISIT,
      }),
    ).toEqual({ action: "apply-conflict", setup: conflictCurrent });

    recordRequestedSave(state.requestedSeqByDoc, docId, 3);
    expect(
      reconcileSaveResponse(state, {
        currentDocumentId: docId,
        savingForDocumentId: docId,
        seq: 3,
        outcome: { kind: "failure", error: "network error" },
        ...SAME_VISIT,
      }),
    ).toEqual({ action: "apply-failure", error: "network error" });
  });

  it("a superseded FAILURE response is ignored just like a superseded conflict or success", () => {
    const state = freshState();
    const docId = "doc-1";
    recordRequestedSave(state.requestedSeqByDoc, docId, 1);
    recordRequestedSave(state.requestedSeqByDoc, docId, 2);

    const oldFailureDecision = reconcileSaveResponse(state, {
      currentDocumentId: docId,
      savingForDocumentId: docId,
      seq: 1,
      outcome: { kind: "failure", error: "stale timeout" },
      ...SAME_VISIT,
    });
    expect(oldFailureDecision).toEqual({ action: "ignore" });
  });

  it("a response for a document the researcher has entirely switched away from is ignored", () => {
    const state = freshState();
    recordRequestedSave(state.requestedSeqByDoc, "doc-1", 1);

    const decision = reconcileSaveResponse(state, {
      currentDocumentId: "doc-2",
      savingForDocumentId: "doc-1",
      seq: 1,
      outcome: { kind: "success", setup: BASE_SETUP },
      ...SAME_VISIT,
    });
    expect(decision).toEqual({ action: "ignore" });
  });

  it("A -> B -> A document switching: a stale response for A, resolving after A was reopened with a newer request already scheduled, is still ignored", () => {
    const state = freshState();

    // A: a save scheduled for doc A, during visit 1.
    recordRequestedSave(state.requestedSeqByDoc, "A", 1);
    // Researcher switches to B (visit 2), back to A (visit 3), and makes a NEW change -
    // scheduling a newer save for A (seq 2, visit 3) before the first one (seq 1) has resolved.
    recordRequestedSave(state.requestedSeqByDoc, "A", 2);

    // The original (seq 1, visit 1) request's response now finally arrives, for document A,
    // which is open again (currentDocumentId === "A") - but it is still superseded by the newer
    // A request, both by seq and by visit.
    const decision = reconcileSaveResponse(state, {
      currentDocumentId: "A",
      savingForDocumentId: "A",
      seq: 1,
      outcome: { kind: "conflict", current: explicitDesign("stale_from_before_switch") },
      currentVisit: 3,
      savingForVisit: 1,
    });
    expect(decision).toEqual({ action: "ignore" });

    // The newer (seq 2, visit 3) request's own response then resolves and is applied normally.
    const newerDecision = reconcileSaveResponse(state, {
      currentDocumentId: "A",
      savingForDocumentId: "A",
      seq: 2,
      outcome: { kind: "success", setup: explicitDesign("current_choice") },
      currentVisit: 3,
      savingForVisit: 3,
    });
    expect(newerDecision).toEqual({ action: "apply-success", setup: explicitDesign("current_choice") });
  });

  it("Brief 38: A -> B -> A with NO new A save during the reopened visit - the old A conflict must still be ignored, because it belongs to a visit the researcher has moved past", () => {
    const state = freshState();

    // Visit 1: a save is scheduled for A.
    recordRequestedSave(state.requestedSeqByDoc, "A", 1);
    // Researcher switches to B (visit 2), then back to A (visit 3) - WITHOUT making any new
    // edit to A during this second visit, so requestedSeqByDoc still shows seq 1 as "the latest
    // requested save for A." By seq alone, the stale response below would look current - this
    // is exactly the gap the seq-only checks could not close, and the reason a visit identity
    // exists.
    const decision = reconcileSaveResponse(state, {
      currentDocumentId: "A",
      savingForDocumentId: "A",
      seq: 1,
      outcome: { kind: "conflict", current: explicitDesign("stale_from_first_visit") },
      currentVisit: 3,
      savingForVisit: 1,
    });
    expect(decision).toEqual({ action: "ignore" });
  });

  it("two independent documents' save sequences never interfere with each other", () => {
    const state = freshState();
    recordRequestedSave(state.requestedSeqByDoc, "A", 1);
    recordRequestedSave(state.requestedSeqByDoc, "B", 1);

    expect(
      reconcileSaveResponse(state, {
        currentDocumentId: "B",
        savingForDocumentId: "B",
        seq: 1,
        outcome: { kind: "success", setup: BASE_SETUP },
        ...SAME_VISIT,
      }),
    ).toEqual({ action: "apply-success", setup: BASE_SETUP });

    // A's own seq-1 request is still its latest requested (B's bookkeeping didn't touch it).
    expect(
      reconcileSaveResponse(state, {
        currentDocumentId: "A",
        savingForDocumentId: "A",
        seq: 1,
        outcome: { kind: "success", setup: BASE_SETUP },
        ...SAME_VISIT,
      }),
    ).toEqual({ action: "apply-success", setup: BASE_SETUP });
  });

  it("a duplicate/re-delivered response for an already-applied seq is ignored (defensive second guard)", () => {
    const state = freshState();
    const docId = "doc-1";
    recordRequestedSave(state.requestedSeqByDoc, docId, 1);

    expect(
      reconcileSaveResponse(state, {
        currentDocumentId: docId,
        savingForDocumentId: docId,
        seq: 1,
        outcome: { kind: "success", setup: BASE_SETUP },
        ...SAME_VISIT,
      }),
    ).toEqual({ action: "apply-success", setup: BASE_SETUP });

    // The exact same response is somehow delivered a second time.
    expect(
      reconcileSaveResponse(state, {
        currentDocumentId: docId,
        savingForDocumentId: docId,
        seq: 1,
        outcome: { kind: "success", setup: BASE_SETUP },
        ...SAME_VISIT,
      }),
    ).toEqual({ action: "ignore" });
  });
});
