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
import { attempt } from "./actionFailure";

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
 */
export function useObjectiveRowActions(runId: string, row: ObjectiveRow, onDeleted?: () => void) {
  const [isPending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(row.text);
  const [error, setError] = useState<string | null>(null);
  const run = (action: () => Promise<unknown>, after?: () => void) =>
    start(async () => {
      setError(null);
      const failure = await attempt(action);
      if (failure) setError(failure);
      else after?.();
    });
  const accepted = row.status === "accepted";
  const rejected = row.status === "rejected";

  const beginEdit = () => setEditing(true);
  const cancelEdit = () => {
    setDraft(row.text);
    setError(null);
    setEditing(false);
  };
  const save = () => run(() => acceptObjectiveCandidate(runId, row.id, draft.trim()), () => setEditing(false));
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
