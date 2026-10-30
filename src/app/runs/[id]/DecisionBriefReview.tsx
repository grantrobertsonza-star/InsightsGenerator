"use client";

import SourceRemovedTag from "./SourceRemovedTag";
import { useState, useTransition } from "react";
import { attempt } from "./actionFailure";
import { Pane, ThreePane } from "./ThreePane";
import {
  acceptDecisionCandidate,
  rejectDecisionCandidate,
  restoreDecisionCandidate,
  unacceptDecisionCandidate,
  deleteDecisionCandidate,
  addOwnDecisionCandidate,
  regenerateDecisionCandidates,
  acceptAllDecisionCandidates,
  deleteAllDecisionCandidates,
  retryDecisionRefresh,
  type DecisionChangeResult,
  type DecisionConflict,
} from "@/lib/decisionCandidateActions";
import { TrashIcon } from "@/components/icons";
import { EARLIER_DECISIONS_LABEL } from "@/lib/decisionContext";
import { evidenceSummaryPoints } from "@/lib/decisionPresentation";
import type { EarlierDecisionCounts } from "@/lib/decisionRefresh";

type DecisionCandidate = {
  id: string;
  candidate_text: string;
  rationale: string;
  source: "researcher_authored" | "ai_suggested";
  status: "pending" | "accepted" | "rejected";
  edited: boolean;
  /** When a file this decision was drawn from was removed to the bin (migration 0115). */
  source_removed_at?: string | null;
};

const sourceLabel: Record<DecisionCandidate["source"], string> = {
  researcher_authored: "Your text",
  ai_suggested: "Suggested",
};

const textareaClass =
  "w-full resize-none rounded-lg border border-border px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20";

// A decision change that was saved reports whether the insights and recommendations were updated
// to match; the list shows that outcome (see DecisionRefreshNotice).
type OnChanged = (result: DecisionChangeResult | void) => void;

function CandidateCard({ runId, candidate, onChanged }: { runId: string; candidate: DecisionCandidate; onChanged: OnChanged }) {
  const [isPending, startTransition] = useTransition();
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(candidate.candidate_text);
  // Codex DEC500-F01: the wording the editor opened with, captured when Edit is pressed and never
  // from later props, sent with the save so the server can refuse it when the decision changed or
  // was deleted meanwhile. After a conflict it becomes the current stored wording, so "Replace with
  // mine" saves deliberately over what is there now.
  const [opened, setOpened] = useState<string | null>(null);
  // A refused save: its message and the decision's current wording (null when it was deleted).
  const [conflict, setConflict] = useState<{ currentText: string | null } | null>(null);
  // Each action reports its failure here instead of throwing out of the transition, which
  // replaced the page and lost an open edit; a failed save keeps the editor and draft.
  const [error, setError] = useState<string | null>(null);
  const run = (action: () => Promise<DecisionChangeResult | DecisionConflict | void>, after?: () => void) =>
    startTransition(async () => {
      setError(null);
      setConflict(null);
      let result: DecisionChangeResult | DecisionConflict | void = undefined;
      const failure = await attempt(async () => {
        result = await action();
      });
      const refused = result as DecisionConflict | void;
      if (failure) setError(failure);
      else if (refused && refused.ok === false) {
        // Nothing was saved: the editor, the draft and what is stored now stay on screen.
        setError(refused.error);
        setConflict({ currentText: refused.currentText });
      } else {
        onChanged(result as DecisionChangeResult | void);
        after?.();
      }
    });
  const startEditing = () => {
    setDraft(candidate.candidate_text);
    setOpened(candidate.candidate_text);
    setConflict(null);
    setError(null);
    setIsEditing(true);
  };
  const save = (expected: string | null) =>
    run(() => acceptDecisionCandidate(runId, candidate.id, draft.trim(), expected ?? undefined), () => setIsEditing(false));

  const isAccepted = candidate.status === "accepted";
  const isRejected = candidate.status === "rejected";

  function handleDelete() {
    if (!confirm("Delete this candidate? This can't be undone.")) return;
    run(() => deleteDecisionCandidate(runId, candidate.id));
  }

  return (
    <div
      className={`rounded-lg border p-4 transition ${
        isAccepted
          ? "border-success bg-success-light"
          : isRejected
            ? "border-border opacity-50"
            : "border-border bg-white"
      }`}
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
              candidate.source === "ai_suggested" ? "bg-primary-light text-primary" : "bg-slate-100 text-slate-500"
            }`}
          >
            {sourceLabel[candidate.source]}
          </span>
          {candidate.edited && (
            <span className="inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Edited before accepting
            </span>
          )}
          <SourceRemovedTag removedAt={candidate.source_removed_at} />
          {isAccepted && (
            <span className="inline-block rounded bg-success px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
              Accepted decision
            </span>
          )}
        </div>
        <button
          disabled={isPending}
          onClick={handleDelete}
          aria-label="Delete candidate"
          title="Delete candidate"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted transition hover:bg-danger-light hover:text-danger"
        >
          <TrashIcon className="h-3 w-3" />
        </button>
      </div>

      {isEditing ? (
        <textarea
          autoFocus
          rows={2}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className={`${textareaClass} mb-2`}
        />
      ) : (
        <div className="mb-1 text-sm font-medium text-foreground">{candidate.candidate_text}</div>
      )}

      {candidate.rationale && <div className="text-xs text-muted">{candidate.rationale}</div>}

      <div className="mt-3 flex flex-wrap gap-1.5">
        {isEditing ? (
          <>
            <button
              disabled={isPending || !draft.trim()}
              onClick={() => save(opened)}
              className="rounded-lg border border-success bg-success px-2.5 py-1 text-xs font-medium text-white transition hover:opacity-90 disabled:opacity-50"
            >
              Save and accept
            </button>
            <button
              onClick={() => {
                setDraft(candidate.candidate_text);
                setError(null);
                setConflict(null);
                setIsEditing(false);
              }}
              className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted hover:text-foreground"
            >
              Cancel
            </button>
          </>
        ) : isRejected ? (
          <button
            disabled={isPending}
            onClick={() => run(() => restoreDecisionCandidate(runId, candidate.id))}
            className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted hover:border-slate-400 hover:text-foreground"
          >
            Restore
          </button>
        ) : (
          <>
            {!isAccepted && (
              <button
                disabled={isPending}
                onClick={() => run(() => acceptDecisionCandidate(runId, candidate.id))}
                className="rounded-lg border border-success px-2.5 py-1 text-xs font-medium text-success transition hover:bg-success-light"
              >
                Accept
              </button>
            )}
            <button
              disabled={isPending}
              onClick={startEditing}
              className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted hover:border-slate-400 hover:text-foreground"
            >
              {isAccepted ? "Edit" : "Edit and accept"}
            </button>
            {!isAccepted && (
              <button
                disabled={isPending}
                onClick={() => run(() => rejectDecisionCandidate(runId, candidate.id))}
                className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted transition hover:border-danger hover:text-danger"
              >
                Reject
              </button>
            )}
            {isAccepted && (
              <button
                disabled={isPending}
                onClick={() => run(() => unacceptDecisionCandidate(runId, candidate.id))}
                className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted transition hover:border-danger hover:text-danger"
              >
                Unaccept
              </button>
            )}
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs text-red-700" data-testid={conflict ? "decision-edit-conflict" : undefined}>
          {error}
        </p>
      )}
      {isEditing && conflict && (
        <div className="mt-2 rounded-md bg-amber-50 p-2 text-xs text-amber-900">
          {conflict.currentText !== null ? (
            <>
              <p data-testid="decision-current-wording">Stored now: {conflict.currentText}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <button
                  disabled={isPending}
                  onClick={() => {
                    setDraft(conflict.currentText!);
                    setOpened(conflict.currentText);
                    setConflict(null);
                    setError(null);
                  }}
                  className="rounded-lg border border-border bg-white px-2.5 py-1 font-medium text-foreground"
                >
                  Use current wording
                </button>
                <button
                  disabled={isPending || !draft.trim()}
                  onClick={() => {
                    setOpened(conflict.currentText);
                    save(conflict.currentText);
                  }}
                  className="rounded-lg border border-border bg-white px-2.5 py-1 font-medium text-foreground"
                >
                  Replace with mine
                </button>
              </div>
            </>
          ) : (
            <p data-testid="decision-current-wording">Reload the page to see the current decisions; your wording is kept here until you cancel.</p>
          )}
        </div>
      )}
    </div>
  );
}

export default function DecisionBriefReview({
  runId,
  candidates,
  hasFindings,
  evidenceSynthesis,
  refreshPending,
  earlierDecisions,
}: {
  runId: string;
  candidates: DecisionCandidate[];
  // Whether the insights and recommendations are still owed a refresh after a decision change
  // (null: could not be checked). Read on the server from the persisted marker.
  refreshPending: boolean | null;
  // Existing insights and AI recommendations that may not reflect the current accepted decisions
  // (null: could not be checked). A refresh does not rewrite these.
  earlierDecisions: EarlierDecisionCounts | null;
  // Whether this run has any findings yet, i.e. whether the framer has had
  // anything to read. Passed from the server component since that check
  // reads the findings table, not the candidate list.
  hasFindings: boolean;
  // The framer's own statement of what the evidence shows, written before
  // it proposes any decision, so a researcher can judge whether a candidate
  // actually follows from it rather than taking the leap on faith.
  evidenceSynthesis: string | null;
}) {
  const [isPending, startTransition] = useTransition();
  const [addText, setAddText] = useState("");
  const [regenerateError, setRegenerateError] = useState<string | null>(null);
  // List-level actions (add your own, accept all, delete all) report failure here; a failed add
  // keeps the typed text.
  const [actionError, setActionError] = useState<string | null>(null);
  // The reason the last saved change's insight and recommendation update failed, if it did.
  const [refreshProblem, setRefreshProblem] = useState<string | null>(null);
  const onChanged: OnChanged = (result) => setRefreshProblem(result ? result.refreshError : null);
  const runListAction = (action: () => Promise<DecisionChangeResult | void>, after?: () => void) =>
    startTransition(async () => {
      setActionError(null);
      let result: DecisionChangeResult | void = undefined;
      const failure = await attempt(async () => {
        result = await action();
      });
      if (failure) setActionError(failure);
      else {
        onChanged(result);
        after?.();
      }
    });
  const [rejectedOpen, setRejectedOpen] = useState(false);

  const accepted = candidates.filter((c) => c.status === "accepted");
  const pending = candidates.filter((c) => c.status === "pending");
  const rejected = candidates.filter((c) => c.status === "rejected");

  // The framer already runs automatically once documents are processed
  // (see page.tsx), so this button is rarely someone's first way of getting
  // suggestions. Its label reflects what it actually does: the first time,
  // before any AI suggestion exists, it's asking for one; after that, it
  // replaces the AI suggestions nobody has edited with a fresh batch, so
  // "regenerate" is the honest word once there's something to regenerate.
  // What survives is decided in decisionFramer.ts (the authoritative rule,
  // Codex M-DEC500-01): an AI suggestion is replaced unless it was rejected or
  // edited, so an unedited suggestion is replaced even when it is accepted,
  // because suggestions land accepted and status alone cannot show that a
  // researcher looked at one. The researcher's own decisions, edited
  // suggestions and rejected ones are kept.
  const hasAnyAiSuggested = candidates.some((c) => c.source === "ai_suggested");
  const regenerateLabel = hasAnyAiSuggested ? "Regenerate suggestions" : "Get suggestions";
  const regenerateBusyLabel = hasAnyAiSuggested ? "Regenerating..." : "Generating...";

  function handleRegenerate() {
    setRegenerateError(null);
    startTransition(async () => {
      const result = await regenerateDecisionCandidates(runId);
      if (!result.ok) {
        setRegenerateError(result.error);
        // When a regenerate attempt comes back with nothing usable, a rejected candidate someone
        // already thought through is the most useful thing on this screen, so it is opened
        // rather than left collapsed. Done here, where the failure is learned, rather than in an
        // effect that sets state after render.
        if (rejected.length > 0) setRejectedOpen(true);
      }
    });
  }

  return (
    <ThreePane
      storageKey="decisions-v3"
      leftMaxShare={0.5}
      left={
        <Pane side="plain" title="What the evidence shows">
          <EvidenceSummary text={evidenceSynthesis} />
        </Pane>
      }
      middle={
        <Pane
          side="plain"
          title="Decisions"
          badge={
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-muted">
              {accepted.length} accepted
            </span>
          }
        >
      {/* Suggest and add, at the top of the list (Grant, 2026-10-20): two panes, as on Research quality. */}
      <div className="flex flex-col gap-3 border-b border-border pb-4" data-testid="decisions-suggest-add">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="min-w-0 flex-1 text-xs text-muted">
            Every decision suggested here is already accepted, so the project moves on without waiting on a
            review step; everything downstream (findings, verdicts, recommendations) is judged against
            whichever decision(s) are currently accepted, and a project can genuinely be organized around
            more than one. Reject anything that doesn&apos;t belong (it never affects another accepted one),
            edit one in place, or write your own below.
          </p>
          {hasFindings && (
            <button
              disabled={isPending}
              onClick={handleRegenerate}
              className="self-start whitespace-nowrap rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-muted transition hover:border-slate-400 hover:text-foreground disabled:opacity-60"
            >
              {isPending ? regenerateBusyLabel : regenerateLabel}
            </button>
          )}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const text = addText.trim();
            if (!text) return;
            runListAction(() => addOwnDecisionCandidate(runId, text), () => setAddText(""));
          }}
          className="rounded-lg border border-dashed border-border p-3"
        >
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted">
            Add your own decision
          </label>
          <textarea
            rows={2}
            value={addText}
            onChange={(e) => setAddText(e.target.value)}
            placeholder="e.g. Whether to launch the loyalty tier in Q2 or hold for the rebrand"
            className={textareaClass}
          />
          <button
            type="submit"
            disabled={isPending || !addText.trim()}
            className="mt-2 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white transition hover:bg-primary-hover disabled:opacity-50"
          >
            Add decision
          </button>
        </form>
      </div>
      {actionError && (
        <p role="alert" className="rounded-lg border border-danger bg-danger-light px-4 py-3 text-sm text-danger">
          Not saved: {actionError}
        </p>
      )}
      <DecisionRefreshNotice
        problem={refreshProblem}
        pending={refreshPending}
        busy={isPending}
        onRetry={() => runListAction(() => retryDecisionRefresh(runId))}
      />
      <EarlierDecisionsNotice counts={earlierDecisions} />
      {regenerateError && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-danger bg-danger-light px-4 py-3 text-sm text-danger">
          <span>Couldn&apos;t generate suggestions right now: {regenerateError}</span>
          <button onClick={() => setRegenerateError(null)} className="shrink-0 font-medium underline">
            Dismiss
          </button>
        </div>
      )}

      {!hasFindings && candidates.length === 0 && (
        <div className="rounded-lg border border-dashed border-border bg-slate-50 px-4 py-3 text-sm text-muted">
          Nothing yet. Process at least one document above and we&apos;ll suggest decisions this project&apos;s
          evidence could inform automatically, or add your own above in the meantime.
        </div>
      )}

      {hasFindings && candidates.length === 0 && (
        <div className="rounded-lg border border-dashed border-border bg-slate-50 px-4 py-3 text-sm text-muted">
          We tried to generate suggestions automatically and it didn&apos;t come back with anything, most
          likely a temporary issue. Click &quot;Get suggestions&quot; above to try again, or add your own above.
        </div>
      )}

      {accepted.length > 0 && (
        <div className="space-y-2">
          {accepted.map((candidate) => (
            <CandidateCard key={candidate.id} runId={runId} candidate={candidate} onChanged={onChanged} />
          ))}
        </div>
      )}

      {pending.length > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {accepted.length > 0 ? (
              <div className="text-xs font-semibold uppercase tracking-wide text-muted">Other candidates</div>
            ) : (
              <span />
            )}
            <div className="flex gap-1.5">
              <button
                type="button"
                disabled={isPending}
                onClick={() => runListAction(() => acceptAllDecisionCandidates(runId))}
                className="rounded-lg border border-success px-2.5 py-1 text-xs font-medium text-success transition hover:bg-success-light disabled:opacity-50"
              >
                Accept all
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={() => {
                  if (!confirm(`Delete all ${pending.length} remaining candidate(s)? This can't be undone.`)) return;
                  runListAction(() => deleteAllDecisionCandidates(runId));
                }}
                className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted transition hover:border-danger hover:text-danger disabled:opacity-50"
              >
                Delete all
              </button>
            </div>
          </div>
          {pending.map((candidate) => (
            <CandidateCard key={candidate.id} runId={runId} candidate={candidate} onChanged={onChanged} />
          ))}
        </div>
      )}

      {rejected.length > 0 && (
        <div className="rounded-lg border border-dashed border-border p-3">
          <button
            type="button"
            onClick={() => setRejectedOpen((o) => !o)}
            className="flex w-full items-center justify-between text-left text-sm font-medium text-muted hover:text-foreground"
          >
            <span>
              Rejected ({rejected.length})
              {!rejectedOpen && ", kept in case nothing new turns up"}
            </span>
            <span className="text-xs">{rejectedOpen ? "Hide" : "Show"}</span>
          </button>
          {rejectedOpen && (
            <div className="mt-3 space-y-2">
              {regenerateError && (
                <p className="text-xs text-muted">
                  No new suggestions came back. Restoring one of these puts it back with the other
                  candidates above.
                </p>
              )}
              {rejected.map((candidate) => (
                <CandidateCard key={candidate.id} runId={runId} candidate={candidate} onChanged={onChanged} />
              ))}
            </div>
          )}
        </div>
      )}
        </Pane>
      }
    />
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The model's summary of what the evidence points to (decisionFramer.ts, first pass), shown on the
 * left because the suggested decisions are drawn from it (Grant, 2026-10-20). Shown as its
 * sentences, the first as the lead, so it can be read rather than scanned as one block; the
 * wording is the model's, unchanged. It is rewritten only when suggestions are generated again.
 */
function EvidenceSummary({ text }: { text: string | null }) {
  const points = text ? evidenceSummaryPoints(text) : [];
  if (points.length === 0) {
    return <p className="text-sm text-muted">A summary of what the evidence shows appears here when decisions are suggested. The suggestions are drawn from it.</p>;
  }
  const [lead, ...rest] = points;
  return (
    <div className="flex flex-col gap-3" data-testid="evidence-summary">
      <p className="text-xs text-muted">Written by the AI when it suggested the decisions, which are drawn from it. Check the figures against the insights.</p>
      <p className="text-sm font-medium leading-relaxed text-foreground">{lead}</p>
      {rest.length > 0 && (
        <ul className="flex list-disc flex-col gap-2 pl-5 text-sm leading-relaxed text-foreground marker:text-primary">
          {rest.map((point, i) => (
            <li key={i}>{point}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Says when existing insights or AI recommendations may not reflect the current accepted
 * decisions (rules in decisionContext.ts): written for earlier decisions, or, for recommendations
 * written before their decisions were recorded, unknown. These are kept as they are (rewriting
 * would discard reviewed wording, recommendations and support links), so this is a standing
 * qualification rather than something "Update them now" can clear. Pre-insights also carry the
 * mark in their list and Excel export; other screens rely on this count (limitations recorded).
 */
function EarlierDecisionsNotice({ counts }: { counts: EarlierDecisionCounts | null }) {
  if (counts === null) {
    return (
      <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        Could not check whether the existing insights and recommendations were written for the current accepted decisions.
      </p>
    );
  }
  const earlierRecommendations = counts.recommendations - counts.recommendationsUnknown;
  const parts = [
    counts.insights > 0 ? `${plural(counts.insights, "insight was", "insights were")} written for earlier ones` : null,
    earlierRecommendations > 0 ? `${plural(earlierRecommendations, "recommendation was", "recommendations were")} written for earlier ones` : null,
    counts.recommendationsUnknown > 0
      ? `${plural(counts.recommendationsUnknown, "recommendation was", "recommendations were")} written before the decisions behind them were recorded, so whether they match is unknown`
      : null,
  ].filter((p): p is string => p !== null);
  if (parts.length === 0) return null;
  return (
    <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
      {`The existing insights and recommendations do not all reflect the current accepted decisions: ${parts.join("; ")}. ` +
        "They have not been rewritten, so your review work is kept." +
        (counts.insights > 0 ? ` Pre-insights are marked "${EARLIER_DECISIONS_LABEL}" in the pre-insights list and its Excel export.` : "")}
    </p>
  );
}

/**
 * Says when the insights and recommendations do not yet reflect the accepted decisions: right
 * after a saved change whose update failed (with the reason), and on any later visit while the
 * persisted marker says an update is still owed. Unknown is said as unknown.
 */
function DecisionRefreshNotice({ problem, pending, busy, onRetry }: { problem: string | null; pending: boolean | null; busy: boolean; onRetry: () => void }) {
  const message = problem
    ? `Saved. The insights and recommendations were not updated to match: ${problem}`
    : pending === true
      ? "The insights and recommendations have not been updated since the accepted decisions last changed."
      : pending === null
        ? "Could not check whether the insights and recommendations match the accepted decisions."
        : null;
  if (!message) return null;
  return (
    <div role="status" className="flex items-start justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
      <span>{message}</span>
      <button type="button" disabled={busy} onClick={onRetry} className="shrink-0 font-medium underline disabled:opacity-50">
        {busy ? "Updating..." : "Update them now"}
      </button>
    </div>
  );
}
