"use client";

import { useState, useTransition } from "react";
import {
  acceptObjectiveCandidate,
  unacceptObjectiveCandidate,
  rejectObjectiveCandidate,
  restoreObjectiveCandidate,
  deleteObjectiveCandidate,
} from "@/lib/objectiveCandidateActions";
import type { ObjectiveRow } from "./ObjectiveReviewTable";
import { attemptResult } from "./actionFailure";

/**
 * OBJ-REV-M02: the status-transition logic behind one objective's row
 * controls (accept, edit + save, unaccept, reject, restore, delete) used to
 * be implemented twice - once in ObjectiveReviewTable.tsx's Row, once in
 * ObjectivesWorkspace.tsx's Detail - and both copies shared the same bug:
 * their "Unaccept" button called restoreObjectiveCandidate, which only
 * performs the rejected -> accepted transition, so clicking Unaccept on an
 * already-accepted candidate silently did nothing. Shared here so both
 * presentations are driven by one transition contract (now wired to the new
 * unacceptObjectiveCandidate, accepted -> pending) and can't drift apart
 * again, while each keeps its own layout and markup around it.
 *
 * Every action reports its own failure in `error` (shown by both presentations) instead of
 * throwing out of the transition, which replaced the page and lost an open edit. A failed save
 * keeps the editor open with the researcher's draft.
 *
 * Edit sessions (GT500-F03, GT1000-F03): the wording the editor opened with is captured when
 * editing starts (`baseline`) and sent as the expected state on save, so an objective changed or
 * removed meanwhile is refused as a conflict. A refresh of the row's props while the editor is open
 * (another objective unaccepted, the page revalidated) never moves that baseline: the draft was
 * written against the opened wording, not the refreshed one. On a conflict the draft stays and the
 * researcher decides explicitly: use the current wording (the draft and baseline become the row's
 * current text), or replace the current wording with theirs (the baseline becomes the current text
 * they have now seen, then the save runs again). Cancel, then Edit, always starts from the current
 * wording.
 */
export function useObjectiveRowActions(runId: string, row: ObjectiveRow, onDeleted?: () => void) {
  const [isPending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(row.text);
  const [baseline, setBaseline] = useState(row.text);
  const [conflict, setConflict] = useState(false);
  // The stored wording the refusal reported (null: deleted). The row's props may not have refreshed
  // yet, so the conflict choices use this, not row.text.
  const [conflictCurrent, setConflictCurrent] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const run = (action: () => Promise<unknown>, after?: () => void) =>
    start(async () => {
      setError(null);
      setConflict(false);
      setConflictCurrent(undefined);
      let refusedAsConflict = false;
      let reportedCurrent: string | null | undefined = undefined;
      const failure = await attemptResult(async () => {
        const result = await action();
        if (result && typeof result === "object" && (result as { conflict?: unknown }).conflict === true) {
          refusedAsConflict = true;
          const current = (result as { currentText?: unknown }).currentText;
          reportedCurrent = typeof current === "string" || current === null ? current : undefined;
        }
        return result;
      });
      if (failure) {
        setError(failure);
        setConflict(refusedAsConflict);
        setConflictCurrent(reportedCurrent);
      } else after?.();
    });
  const accepted = row.status === "accepted";
  const rejected = row.status === "rejected";

  const beginEdit = () => {
    setDraft(row.text);
    setBaseline(row.text);
    setError(null);
    setConflict(false);
    setEditing(true);
  };
  const cancelEdit = () => {
    setDraft(row.text);
    setBaseline(row.text);
    setError(null);
    setConflict(false);
    setEditing(false);
  };
  const saveAgainst = (expected: string) => run(() => acceptObjectiveCandidate(runId, row.id, draft.trim(), expected), () => setEditing(false));
  const save = () => saveAgainst(baseline);
  // The wording the conflict panel shows and the choices act on: the stored wording the refusal
  // reported, falling back to the row's props when the refusal did not say.
  const currentText = conflictCurrent === undefined ? row.text : conflictCurrent;
  /** After a conflict: drop the draft and continue from the wording as it now is. */
  const useCurrentWording = () => {
    if (currentText === null) return;
    setDraft(currentText);
    setBaseline(currentText);
    setError(null);
    setConflict(false);
    setConflictCurrent(undefined);
  };
  /** After a conflict, the researcher's explicit choice: their wording replaces the current one they now see. */
  const replaceCurrentWording = () => {
    if (currentText === null) return;
    setBaseline(currentText);
    saveAgainst(currentText);
  };
  const accept = () => run(() => acceptObjectiveCandidate(runId, row.id));
  const unaccept = () => run(() => unacceptObjectiveCandidate(runId, row.id));
  const reject = () => run(() => rejectObjectiveCandidate(runId, row.id));
  const restore = () => run(() => restoreObjectiveCandidate(runId, row.id));
  const remove = () => {
    if (!confirm("Delete this objective? This can't be undone.")) return;
    run(() => deleteObjectiveCandidate(runId, row.id), () => onDeleted?.());
  };

  return {
    isPending,
    editing,
    draft,
    setDraft,
    error,
    conflict,
    currentText,
    useCurrentWording,
    replaceCurrentWording,
    accepted,
    rejected,
    beginEdit,
    cancelEdit,
    save,
    accept,
    unaccept,
    reject,
    restore,
    remove,
  };
}
