"use client";

import { useEffect, useState, useTransition } from "react";
import {
  acceptDecisionCandidate,
  rejectDecisionCandidate,
  restoreDecisionCandidate,
  deleteDecisionCandidate,
  addOwnDecisionCandidate,
  regenerateDecisionCandidates,
  acceptAllDecisionCandidates,
  deleteAllDecisionCandidates,
} from "@/lib/decisionCandidateActions";
import { TrashIcon } from "@/components/icons";

type DecisionCandidate = {
  id: string;
  candidate_text: string;
  rationale: string;
  source: "researcher_authored" | "ai_suggested";
  status: "pending" | "accepted" | "rejected";
  edited: boolean;
};

const sourceLabel: Record<DecisionCandidate["source"], string> = {
  researcher_authored: "Your text",
  ai_suggested: "Suggested",
};

const textareaClass =
  "w-full resize-none rounded-lg border border-border px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20";

function CandidateCard({ runId, candidate }: { runId: string; candidate: DecisionCandidate }) {
  const [isPending, startTransition] = useTransition();
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(candidate.candidate_text);

  const isAccepted = candidate.status === "accepted";
  const isRejected = candidate.status === "rejected";

  function handleDelete() {
    if (!confirm("Delete this candidate? This can't be undone.")) return;
    startTransition(() => deleteDecisionCandidate(runId, candidate.id));
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
              onClick={() =>
                startTransition(async () => {
                  await acceptDecisionCandidate(runId, candidate.id, draft.trim());
                  setIsEditing(false);
                })
              }
              className="rounded-lg border border-success bg-success px-2.5 py-1 text-xs font-medium text-white transition hover:opacity-90 disabled:opacity-50"
            >
              Save and accept
            </button>
            <button
              onClick={() => {
                setDraft(candidate.candidate_text);
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
            onClick={() => startTransition(() => restoreDecisionCandidate(runId, candidate.id))}
            className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted hover:border-slate-400 hover:text-foreground"
          >
            Restore
          </button>
        ) : (
          <>
            {!isAccepted && (
              <button
                disabled={isPending}
                onClick={() => startTransition(() => acceptDecisionCandidate(runId, candidate.id))}
                className="rounded-lg border border-success px-2.5 py-1 text-xs font-medium text-success transition hover:bg-success-light"
              >
                Accept
              </button>
            )}
            <button
              disabled={isPending}
              onClick={() => setIsEditing(true)}
              className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted hover:border-slate-400 hover:text-foreground"
            >
              {isAccepted ? "Edit" : "Edit and accept"}
            </button>
            {!isAccepted && (
              <button
                disabled={isPending}
                onClick={() => startTransition(() => rejectDecisionCandidate(runId, candidate.id))}
                className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted transition hover:border-danger hover:text-danger"
              >
                Reject
              </button>
            )}
            {isAccepted && (
              <button
                disabled={isPending}
                onClick={() => startTransition(() => restoreDecisionCandidate(runId, candidate.id))}
                className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted transition hover:border-danger hover:text-danger"
              >
                Unaccept
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function DecisionBriefReview({
  runId,
  candidates,
  hasFindings,
  evidenceSynthesis,
}: {
  runId: string;
  candidates: DecisionCandidate[];
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
  const [rejectedOpen, setRejectedOpen] = useState(false);

  const accepted = candidates.filter((c) => c.status === "accepted");
  const pending = candidates.filter((c) => c.status === "pending");
  const rejected = candidates.filter((c) => c.status === "rejected");

  // When a regenerate attempt comes back with nothing usable, a rejected
  // candidate someone already thought through is the most useful thing on
  // this screen, so it's worth surfacing rather than leaving it collapsed.
  useEffect(() => {
    if (regenerateError && rejected.length > 0) {
      setRejectedOpen(true);
    }
  }, [regenerateError, rejected.length]);

  // The framer already runs automatically once documents are processed
  // (see page.tsx), so this button is rarely someone's first way of getting
  // suggestions. Its label reflects what it actually does: the first time,
  // before any AI suggestion exists, it's asking for one; after that, it
  // replaces whatever's still pending with a fresh batch (accepted and
  // rejected candidates are never touched), so "regenerate" is the honest
  // word once there's something to regenerate.
  const hasAnyAiSuggested = candidates.some((c) => c.source === "ai_suggested");
  const regenerateLabel = hasAnyAiSuggested ? "Regenerate suggestions" : "Get suggestions";
  const regenerateBusyLabel = hasAnyAiSuggested ? "Regenerating..." : "Generating...";

  function handleRegenerate() {
    setRegenerateError(null);
    startTransition(async () => {
      const result = await regenerateDecisionCandidates(runId);
      if (!result.ok) {
        setRegenerateError(result.error);
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <p className="max-w-2xl text-sm text-muted">
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
            className="whitespace-nowrap rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-muted transition hover:border-slate-400 hover:text-foreground disabled:opacity-60"
          >
            {isPending ? regenerateBusyLabel : regenerateLabel}
          </button>
        )}
      </div>

      {regenerateError && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-danger bg-danger-light px-4 py-3 text-sm text-danger">
          <span>Couldn&apos;t generate suggestions right now: {regenerateError}</span>
          <button onClick={() => setRegenerateError(null)} className="shrink-0 font-medium underline">
            Dismiss
          </button>
        </div>
      )}

      {evidenceSynthesis && (
        <div className="rounded-lg border border-primary/20 bg-primary-light/40 px-4 py-3">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-primary">
            What the evidence shows
          </div>
          <p className="text-sm text-foreground">{evidenceSynthesis}</p>
        </div>
      )}

      {!hasFindings && candidates.length === 0 && (
        <div className="rounded-lg border border-dashed border-border bg-slate-50 px-4 py-3 text-sm text-muted">
          Nothing yet. Process at least one document above and we&apos;ll suggest decisions this project&apos;s
          evidence could inform automatically, or add your own below in the meantime.
        </div>
      )}

      {hasFindings && candidates.length === 0 && (
        <div className="rounded-lg border border-dashed border-border bg-slate-50 px-4 py-3 text-sm text-muted">
          We tried to generate suggestions automatically and it didn&apos;t come back with anything, most
          likely a temporary issue. Click &quot;Get suggestions&quot; above to try again, or add your own below.
        </div>
      )}

      {accepted.length > 0 && (
        <div className="space-y-2">
          {accepted.map((candidate) => (
            <CandidateCard key={candidate.id} runId={runId} candidate={candidate} />
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
                onClick={() => startTransition(() => acceptAllDecisionCandidates(runId))}
                className="rounded-lg border border-success px-2.5 py-1 text-xs font-medium text-success transition hover:bg-success-light disabled:opacity-50"
              >
                Accept all
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={() => {
                  if (!confirm(`Delete all ${pending.length} remaining candidate(s)? This can't be undone.`)) return;
                  startTransition(() => deleteAllDecisionCandidates(runId));
                }}
                className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted transition hover:border-danger hover:text-danger disabled:opacity-50"
              >
                Delete all
              </button>
            </div>
          </div>
          {pending.map((candidate) => (
            <CandidateCard key={candidate.id} runId={runId} candidate={candidate} />
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const text = addText.trim();
          if (!text) return;
          startTransition(async () => {
            await addOwnDecisionCandidate(runId, text);
            setAddText("");
          });
        }}
        className="rounded-lg border border-dashed border-border p-4"
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

      {rejected.length > 0 && (
        <div className="rounded-lg border border-dashed border-border p-3">
          <button
            type="button"
            onClick={() => setRejectedOpen((o) => !o)}
            className="flex w-full items-center justify-between text-left text-sm font-medium text-muted hover:text-foreground"
          >
            <span>
              Rejected ({rejected.length})
              {!rejectedOpen && " — kept in case nothing new turns up"}
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
                <CandidateCard key={candidate.id} runId={runId} candidate={candidate} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
