import type { DataSetup } from "./dataSetupShared";

/**
 * Codex re-review, package 4 (cross-tab handover repair): "add same-document save-response
 * ordering protection... earlier responses must not overwrite newer state." CrosstabWorkspace.tsx's
 * debounced design-save effect previously only checked whether the researcher had switched
 * documents entirely - it had no guard for two save requests issued for the SAME document (a
 * pause, an edit, a pause again, each firing its own debounced save), where a slow network can
 * let the OLDER request's response land after the NEWER request's response already applied,
 * silently reverting state the newer response had just set.
 *
 * Brief 36/37 repair (IMP-014): that first fix still compared each response against only the
 * latest APPLIED response, not the latest SCHEDULED/requested one - so Codex's own reproduction
 * still broke it: issue an old save, issue a new save (still in flight, nothing applied yet),
 * resolve the OLD save first as a conflict (nothing newer has "applied" yet, so the old guard let
 * it through), which overwrote the picker with the stale value; then the new save resolves as a
 * success, which only updated `lastSavedSetupRef` and left the picker showing the old conflict's
 * value - inconsistent with what was actually just persisted. The fix: track the latest
 * REQUESTED sequence number per document (recorded the moment a save is scheduled, not when it
 * resolves) and discard any response whose sequence has since been superseded by a newer
 * request, whether or not that newer request has resolved yet.
 *
 * Extracted as its own tiny, pure module so the actual decision the component makes is directly
 * testable - a unit test imports and calls these same functions, not a reimplementation of the
 * logic inside a test file.
 */

/**
 * True when `seq` is still the newest sequence number seen for `documentId` - i.e. no later
 * response for this same document has already been applied. `appliedSeqByDoc` is mutated by
 * `markSaveResponseApplied` below, never by this function. Kept as a second, independent guard
 * alongside `isLatestRequestedSave` below - defensive against a duplicate or re-delivered
 * response for the same sequence number being applied twice.
 */
export function shouldApplySaveResponse(appliedSeqByDoc: Map<string, number>, documentId: string, seq: number): boolean {
  const appliedSoFar = appliedSeqByDoc.get(documentId) ?? 0;
  return seq > appliedSoFar;
}

/** Records that `seq` is now the latest sequence number applied for `documentId`. */
export function markSaveResponseApplied(appliedSeqByDoc: Map<string, number>, documentId: string, seq: number): void {
  appliedSeqByDoc.set(documentId, seq);
}

/**
 * Records that `seq` is now the latest save REQUESTED (scheduled) for `documentId` - called the
 * moment a save is scheduled, before its network call even fires, so a later request that hasn't
 * resolved yet still counts as superseding an earlier one that resolves first.
 */
export function recordRequestedSave(requestedSeqByDoc: Map<string, number>, documentId: string, seq: number): void {
  requestedSeqByDoc.set(documentId, seq);
}

/**
 * True when `seq` is still the latest save requested for `documentId` - i.e. no newer save has
 * since been scheduled for this same document, whether or not that newer save has resolved yet.
 * A response failing this check belongs to an intent the researcher has already moved past: it
 * must not reconcile the picker, the saved-state reference, or the error banner - only the newer
 * request's own eventual resolution governs those.
 */
export function isLatestRequestedSave(requestedSeqByDoc: Map<string, number>, documentId: string, seq: number): boolean {
  return requestedSeqByDoc.get(documentId) === seq;
}

/**
 * Brief 38 repair (Codex re-review of Brief 37, item 1): the seq-based checks above protect
 * against reordering WITHIN one continuous visit to a document, but they cannot see a visit
 * boundary - returning to a document (A -> B -> A) is a brand-new visit, yet `requestedSeqByDoc`
 * still shows whatever seq the FIRST visit last scheduled. If the researcher does not issue a
 * new save during the second visit, a slow response from the first visit is still "the latest
 * requested save for this document" by seq alone, and would wrongly reconcile against the
 * reopened document's current (fresh-hydrated) state. A monotonically increasing `visit` number
 * - incremented once per document transition, including a transition back to a document already
 * visited - closes this: a save response is only reconciled when the visit it was scheduled
 * under is still the CURRENT visit, not merely the latest-requested seq for that document.
 */
export type SaveResponseOutcome =
  | { kind: "success"; setup: DataSetup }
  | { kind: "conflict"; current: DataSetup }
  | { kind: "failure"; error: string };

export type SaveReconciliationState = {
  requestedSeqByDoc: Map<string, number>;
  appliedSeqByDoc: Map<string, number>;
};

export type SaveReconciliationDecision =
  | { action: "ignore" }
  | { action: "apply-success"; setup: DataSetup }
  | { action: "apply-conflict"; setup: DataSetup }
  | { action: "apply-failure"; error: string };

/**
 * The single decision CrosstabWorkspace.tsx's save-response handler makes for every response,
 * of every outcome (success, conflict, failure): whether to reconcile the workspace's picker
 * and saved-state reference against this response at all, and if so, with what. Centralising
 * this (rather than three independent inline branches, each re-deciding whether it still
 * applies) is what makes "newer success, conflict and failure each reconcile the picker and
 * saved-state reference consistently" true by construction - there is exactly one gate, applied
 * uniformly ahead of all three outcomes, instead of three copies that could drift.
 *
 * `currentDocumentId` is read fresh at response time (the document the workspace has open right
 * now); `savingForDocumentId` is the document this particular save was FOR, captured when it was
 * scheduled. A response for a document the researcher has since switched away from - including
 * switching A -> B -> A, where this save's own document is open again but a NEWER request for it
 * has since been scheduled - is handled by the two seq-based checks below exactly the same as
 * same-document reordering; there is no separate "switched away and back" case to maintain.
 */
export function reconcileSaveResponse(
  state: SaveReconciliationState,
  params: {
    currentDocumentId: string;
    savingForDocumentId: string;
    seq: number;
    outcome: SaveResponseOutcome;
    /** The visit number active right now (read fresh at response time). */
    currentVisit: number;
    /** The visit number that was active when this save was scheduled. */
    savingForVisit: number;
  },
): SaveReconciliationDecision {
  const { currentDocumentId, savingForDocumentId, seq, outcome, currentVisit, savingForVisit } = params;
  // The researcher has since switched to a different document entirely - this response belongs
  // to a document that isn't even open any more.
  if (currentDocumentId !== savingForDocumentId) return { action: "ignore" };
  // Brief 38 (IMP-014): this response belongs to an earlier VISIT to this same document (A -> B
  // -> A, with the response arriving after A was reopened). The document identity check above
  // cannot see this, because the document id itself hasn't changed - only the visit has. A stale
  // visit's response must not reconcile the freshly hydrated state of the current visit, even
  // when no new save was scheduled during the current visit (so the seq-based check below would
  // otherwise still call it "latest").
  if (savingForVisit !== currentVisit) return { action: "ignore" };
  // IMP-014: a newer save has since been SCHEDULED for this same document (whether or not it has
  // resolved yet) - this response is for an intent the researcher has already moved past, so it
  // must not reconcile anything. The newer request's own eventual resolution is what governs the
  // picker and the saved-state reference, not this older one.
  if (!isLatestRequestedSave(state.requestedSeqByDoc, savingForDocumentId, seq)) return { action: "ignore" };
  // Defensive: an already-applied newer response for this same request slot (duplicate
  // delivery, or this same seq somehow resolving twice) must not be re-applied or reverted.
  if (!shouldApplySaveResponse(state.appliedSeqByDoc, savingForDocumentId, seq)) return { action: "ignore" };
  markSaveResponseApplied(state.appliedSeqByDoc, savingForDocumentId, seq);
  if (outcome.kind === "success") return { action: "apply-success", setup: outcome.setup };
  if (outcome.kind === "conflict") return { action: "apply-conflict", setup: outcome.current };
  return { action: "apply-failure", error: outcome.error };
}
