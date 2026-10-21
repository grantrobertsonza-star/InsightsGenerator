"use client";

import { useActionState, useRef } from "react";
import SubmitButton from "@/components/SubmitButton";
import { saveRunContextFromForm, type RunContextSaveResult } from "@/lib/runContextActions";
import type { BriefFill, FailedBriefFill } from "@/lib/briefFillRecord";
import { FAILED_FILL_NOT_RECORDED, FAILED_FILL_UNKNOWN, LAST_FILL_UNKNOWN, failedFillText, lastFillText } from "@/lib/briefFillText";

const field =
  "mt-1.5 block w-full rounded-lg border border-border px-3 py-2 text-xs text-foreground placeholder:text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20";

export default function RunContextForm({
  runId,
  businessProblem,
  objective,
  audience,
  documents,
  lastFill,
  failedFill,
}: {
  runId: string;
  businessProblem: string | null;
  objective: string | null;
  audience: string | null;
  /** The project's imported documents that can be read as a brief or proposal, with any role recorded at import. */
  documents: { id: string; filename: string; role: "brief" | "proposal" | null }[];
  /** The last successful fill (briefFillRecord.loadLastBriefFill): null when never filled, error when unknown. */
  lastFill?: BriefFill | null | { error: string };
  /** A requested fill that did not happen and has not been followed by one that did (loadFailedBriefFill). */
  failedFill?: FailedBriefFill | null | { error: string };
}) {
  // The result of this page's last save (GT500-F02): a fill that did not happen is said here, from
  // the response itself, even when recording it failed too. Otherwise the shown failure is the
  // stored, unresolved one: from the save's own read of it once there is a save (R500-01: a save
  // with no document requested is not a successful fill, so an earlier failure and its retry stay
  // shown), from the page's (failedFill) before.
  const [result, formAction] = useActionState<RunContextSaveResult | null, FormData>(saveRunContextFromForm.bind(null, runId), null);
  const formRef = useRef<HTMLFormElement>(null);
  const briefRef = useRef<HTMLSelectElement>(null);
  const proposalRef = useRef<HTMLSelectElement>(null);
  const documentIds = new Set(documents.map((d) => d.id));
  const responseFailure = result?.fill?.status === "failed" ? result.fill : null;
  const stored = result ? result.unresolvedFailure : failedFill;
  const recordedFailure = stored && !("error" in stored) ? stored : null;
  const failure = responseFailure ?? recordedFailure;
  const failureUnknown = !responseFailure && !!stored && "error" in stored;
  // Retrying submits the whole form again, so the fields as they now stand are saved with it and
  // nothing typed is overwritten; only documents still in the project are chosen again.
  function retryFill(target: { briefDocumentId: string | null; proposalDocumentId: string | null }) {
    if (briefRef.current) briefRef.current.value = target.briefDocumentId && documentIds.has(target.briefDocumentId) ? target.briefDocumentId : "";
    if (proposalRef.current) proposalRef.current.value = target.proposalDocumentId && documentIds.has(target.proposalDocumentId) ? target.proposalDocumentId : "";
    formRef.current?.requestSubmit();
  }
  const canRetry = !!failure && [failure.briefDocumentId, failure.proposalDocumentId].some((id) => !!id && documentIds.has(id));
  const skipped = result ? [
    ...(result.alreadyInProject > 0 ? [`${result.alreadyInProject} already in this project`] : []),
    ...(result.importedBefore > 0 ? [`${result.importedBefore} imported by an earlier fill (edited, rejected or deleted since)`] : []),
  ] : [];
  return (
    <form
      ref={formRef}
      action={formAction}
      className="flex flex-col gap-4"
    >
      {documents.length > 0 && (
        <div className="rounded-lg border border-dashed border-border bg-slate-50 p-3">
          <span className="text-sm font-medium text-foreground">Fill in from a brief or proposal</span>
          <span className="ml-1.5 text-xs font-normal text-muted">(optional)</span>
          <p className="mt-1 text-xs text-muted">
            Choose an imported brief and/or proposal and we will fill in whichever fields below you leave blank when you save. Text you type yourself always wins. Add files under Import data.
            The choice applies to one save, so it shows Not used again afterwards; choose a document again to fill again.
          </p>
          {failure && (
            <div role="alert" className="mt-1.5 rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-800" data-testid="brief-fill-failed">
              <p>{failedFillText(failure)}</p>
              {responseFailure && !responseFailure.recorded && <p className="mt-0.5">{FAILED_FILL_NOT_RECORDED}</p>}
              {canRetry && (
                <button type="button" onClick={() => retryFill(failure)} className="mt-1 rounded-md border border-red-300 bg-white px-2 py-0.5 text-[11px] font-medium text-red-800 hover:bg-red-100" data-testid="brief-fill-retry">
                  Try the fill again
                </button>
              )}
            </div>
          )}
          {failureUnknown && (
            <p className="mt-1.5 text-xs font-medium text-amber-800" data-testid="brief-fill-unknown">{FAILED_FILL_UNKNOWN}</p>
          )}
          {lastFill && (
            <p className="mt-1.5 text-xs font-medium text-slate-700" data-testid="brief-last-fill">
              {"error" in lastFill ? LAST_FILL_UNKNOWN : lastFillText(lastFill, { previous: !!failure })}
            </p>
          )}
          <div className="mt-2 grid grid-cols-1 gap-2">
            {(
              [
                ["briefDocumentId", "Brief (from the client)", "brief"],
                ["proposalDocumentId", "Proposal (your response)", "proposal"],
              ] as const
            ).map(([name, label, role]) => (
              <label key={name} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <span className="text-xs font-medium text-foreground">{label}</span>
                <select name={name} ref={role === "brief" ? briefRef : proposalRef} defaultValue="" className="min-w-0 max-w-full rounded-lg border border-border bg-white px-2 py-1 text-xs text-foreground">
                  <option value="">Not used</option>
                  {[...documents].sort((a, b) => Number(b.role === role) - Number(a.role === role)).map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.role === role ? `${d.filename} (imported as ${role})` : d.filename}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </div>
      )}
      <label className="block">
        <span className="text-sm font-medium text-foreground">Business problem</span>
        <span className="ml-1.5 text-xs font-normal text-muted">(optional)</span>
        <textarea
          name="businessProblem"
          rows={10}
          defaultValue={businessProblem ?? ""}
          placeholder="e.g. Renewal among lapsed members has dropped 12% year on year and we don't know why."
          className={`${field} min-h-48 resize-y`}
        />
      </label>
      <label className="block">
        <span className="text-sm font-medium text-foreground">Add research objectives or hypotheses</span>
        <span className="ml-1.5 text-xs font-normal text-muted">(optional, one per line. Saved ones appear on the right)</span>
        <textarea
          name="researchObjective"
          rows={3}
          placeholder="e.g. Understand whether price or service is the bigger driver of lapsed renewals."
          className={field}
        />
      </label>
      <label className="block">
        <span className="text-sm font-medium text-foreground">Audience</span>
        <span className="ml-1.5 text-xs font-normal text-muted">(optional)</span>
        <input name="audience" defaultValue={audience ?? ""} className={field} />
      </label>
      {skipped.length > 0 && (
        <p className="text-xs text-slate-600" data-testid="objectives-not-added" role="status">
          {`Not added again: ${skipped.join("; ")}.`}
        </p>
      )}
      <SubmitButton
        pendingLabel="Saving..."
        className="w-fit rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-primary-hover hover:shadow-md"
      >
        Save
      </SubmitButton>
    </form>
  );
}
