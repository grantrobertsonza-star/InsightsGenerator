// In-memory, per-process tracker for "Process documents" progress, read by
// the process-progress API route and polled by the ProcessProgress client
// component while a processing form is mid-submission. This is the bare
// minimum visibility fix: a document count and a rough time estimate, not
// a true job queue, and (like the in-flight Sets in runs/[id]/page.tsx) it
// lives in process memory, so it resets on a server restart and would need
// a shared store (Redis, a DB row) behind a multi-instance deployment.
// Good enough for a single long-running Node server, which is what this
// runs on today.

export type ProcessProgress = {
  // "extracting": documents are being read and findings pulled out, one
  // tick per document (not per chunk) as each one finishes. "finishing":
  // every document is done; verification, stated-insight chain validation,
  // insight generation, synthesis, and recommendations are still running
  // as one remaining block with no further sub-progress of its own.
  phase: "extracting" | "finishing";
  done: number;
  total: number;
  startedAt: number;
};

export type ProcessProgressWithEstimate = ProcessProgress & {
  // Extrapolated from how long the documents finished so far actually
  // took: elapsed / done gives an average per document, times however many
  // are left. Null until at least one document has finished (nothing to
  // extrapolate from yet) and once the extracting phase is over: the
  // finishing stage's length depends on how many findings need verifying,
  // chain-checking, and turning into insights, not on document count, so
  // the same per-document average would be a misleading number there.
  estimatedRemainingMs: number | null;
};

const progressByRun = new Map<string, ProcessProgress>();

export function startProcessProgress(runId: string, total: number): void {
  progressByRun.set(runId, { phase: "extracting", done: 0, total, startedAt: Date.now() });
}

export function incrementProcessProgress(runId: string): void {
  const current = progressByRun.get(runId);
  if (!current) return;
  progressByRun.set(runId, { ...current, done: current.done + 1 });
}

export function setProcessPhase(runId: string, phase: ProcessProgress["phase"]): void {
  const current = progressByRun.get(runId);
  if (!current) return;
  progressByRun.set(runId, { ...current, phase });
}

export function clearProcessProgress(runId: string): void {
  progressByRun.delete(runId);
}

export function getProcessProgress(runId: string): ProcessProgressWithEstimate | null {
  const current = progressByRun.get(runId);
  if (!current) return null;

  const estimatedRemainingMs =
    current.phase === "extracting" && current.done > 0
      ? ((Date.now() - current.startedAt) / current.done) * (current.total - current.done)
      : null;

  return { ...current, estimatedRemainingMs };
}
