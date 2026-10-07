// In-memory, per-process tracker for the processing pipeline, read by the
// process-progress API route and polled by the client. It is not a job queue:
// it lives in process memory, so it resets on a server restart. That is fine
// for a single long-running Node server, which is what this runs on today.
//
// The pipeline is a list of stages. The first (reading documents and coding
// transcripts) is awaited by the click that started it; the rest run in the
// background afterwards. Each stage flips to "done" as it finishes, so the
// page can show finished work as finished while later stages carry on.

export type StageStatus = "pending" | "active" | "done" | "error";

export type PipelineStage = {
  id: string;
  label: string;
  status: StageStatus;
};

export const PIPELINE_STAGES: { id: string; label: string }[] = [
  { id: "documents", label: "Reading documents and coding transcripts" },
  { id: "verify", label: "Verifying findings" },
  { id: "insights", label: "Writing insights" },
  { id: "framing", label: "Proposing objectives and decisions" },
  { id: "synthesis", label: "Synthesizing insights and scoring them" },
  { id: "recommendations", label: "Writing and scoring recommendations" },
];

export type ProcessProgress = {
  // "extracting": documents are being read, one tick per document.
  // "finishing": every document is done and later stages are running.
  // "done": every stage has finished (kept briefly so the page can say so).
  phase: "extracting" | "finishing" | "done";
  done: number;
  total: number;
  startedAt: number;
  stages: PipelineStage[];
  finishedAt: number | null;
};

export type ProcessProgressWithEstimate = ProcessProgress & {
  // Extrapolated from how long the documents finished so far took. Null until
  // one document has finished and once the extracting phase is over.
  estimatedRemainingMs: number | null;
};

const progressByRun = new Map<string, ProcessProgress>();
const KEEP_FINISHED_MS = 90_000;
const STALE_AFTER_MS = 60 * 60 * 1000;

export function startProcessProgress(runId: string, total: number): void {
  progressByRun.set(runId, {
    phase: "extracting",
    done: 0,
    total,
    startedAt: Date.now(),
    stages: PIPELINE_STAGES.map((s, i) => ({
      ...s,
      status: i === 0 ? "active" : "pending",
    })),
    finishedAt: null,
  });
}

export function incrementProcessProgress(runId: string): void {
  const current = progressByRun.get(runId);
  if (!current) return;
  progressByRun.set(runId, { ...current, done: current.done + 1 });
}

export function setProcessPhase(
  runId: string,
  phase: ProcessProgress["phase"],
): void {
  const current = progressByRun.get(runId);
  if (!current) return;
  progressByRun.set(runId, { ...current, phase });
}

export function setStageStatus(
  runId: string,
  stageId: string,
  status: StageStatus,
): void {
  const current = progressByRun.get(runId);
  if (!current) return;
  progressByRun.set(runId, {
    ...current,
    stages: current.stages.map((s) =>
      s.id === stageId ? { ...s, status } : s,
    ),
  });
}

/** True while a pipeline for this run has not finished (including background stages). */
export function isPipelineActive(runId: string): boolean {
  const current = progressByRun.get(runId);
  if (current === undefined || current.phase === "done") return false;
  // A run that never finished (a crash between stages) must not block new
  // clicks forever.
  return Date.now() - current.startedAt < STALE_AFTER_MS;
}

/** Marks everything finished and drops the entry shortly afterwards. */
export function finishProcessProgress(runId: string): void {
  const current = progressByRun.get(runId);
  if (!current) return;
  const finishedAt = Date.now();
  progressByRun.set(runId, { ...current, phase: "done", finishedAt });
  const timer = setTimeout(() => {
    const now = progressByRun.get(runId);
    if (now && now.finishedAt === finishedAt) progressByRun.delete(runId);
  }, KEEP_FINISHED_MS);
  if (typeof timer.unref === "function") timer.unref();
}

export function clearProcessProgress(runId: string): void {
  progressByRun.delete(runId);
}

export function getProcessProgress(
  runId: string,
): ProcessProgressWithEstimate | null {
  const current = progressByRun.get(runId);
  if (!current) return null;

  const estimatedRemainingMs =
    current.phase === "extracting" && current.done > 0
      ? ((Date.now() - current.startedAt) / current.done) *
        (current.total - current.done)
      : null;

  return { ...current, estimatedRemainingMs };
}
