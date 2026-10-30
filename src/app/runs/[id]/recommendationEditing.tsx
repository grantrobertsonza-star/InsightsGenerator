"use client";

import { useState, type TransitionStartFunction } from "react";
import { updateAndAcceptRecommendation } from "@/lib/recommendationActions";
import type { RecommendationFields } from "@/lib/recommendationWrites";
import { actionFailureMessage } from "./actionFailure";

/**
 * The edit-and-accept flow shared by both recommendation review screens (Codex REC500-F01).
 *
 * The fields the editor opened with are captured when Edit is pressed and sent with the save, so a
 * save against a recommendation another editor changed, or one deleted meanwhile, is refused by the
 * server instead of overwriting the other change or reporting a save that wrote nothing. A refusal
 * keeps the editor open with the researcher's draft and shows what is stored now, with two ways on:
 * use the stored wording, or save the draft over it deliberately (the stored fields become the new
 * opened state, so the replacement is itself checked). The editor closes only after a save that the
 * server confirmed.
 */
export function useRecommendationEdit({
  runId,
  recommendationId,
  setDraft,
  setError,
  close,
  startTransition,
}: {
  runId: string;
  recommendationId: string;
  setDraft: (d: RecommendationFields) => void;
  setError: (e: string | null) => void;
  close: () => void;
  startTransition: TransitionStartFunction;
}) {
  const [opened, setOpened] = useState<RecommendationFields | null>(null);
  const [conflict, setConflict] = useState<{ current: RecommendationFields | null } | null>(null);

  const begin = (from: RecommendationFields) => {
    setDraft(from);
    setOpened(from);
    setConflict(null);
    setError(null);
  };
  const cancel = () => {
    setOpened(null);
    setConflict(null);
    setError(null);
  };
  const save = (draft: RecommendationFields, expected: RecommendationFields | null) =>
    startTransition(async () => {
      setError(null);
      try {
        const result = await updateAndAcceptRecommendation(runId, recommendationId, draft, expected ?? undefined);
        if (result.ok) {
          setOpened(null);
          setConflict(null);
          close();
          return;
        }
        setError(result.error);
        if ("conflict" in result) setConflict({ current: result.current });
      } catch (error) {
        setError(actionFailureMessage(error));
      }
    });

  const conflictPanel = (draft: RecommendationFields, pending: boolean) =>
    conflict && conflict.current ? (
      <div className="mt-2 space-y-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-900" data-testid="recommendation-edit-conflict">
        <p data-testid="recommendation-current-action">Stored now: {conflict.current.action_text}</p>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              const current = conflict.current!;
              setDraft(current);
              setOpened(current);
              setConflict(null);
              setError(null);
            }}
            className="rounded-md border border-amber-300 bg-white px-2 py-0.5 font-medium hover:bg-amber-100"
          >
            Use current wording
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              const current = conflict.current!;
              setOpened(current);
              save(draft, current);
            }}
            className="rounded-md border border-amber-300 bg-white px-2 py-0.5 font-medium hover:bg-amber-100"
          >
            Replace with mine
          </button>
        </div>
      </div>
    ) : null;

  return { opened, begin, cancel, save: (draft: RecommendationFields) => save(draft, opened), conflictPanel, refusedAsGone: conflict !== null && conflict.current === null };
}
