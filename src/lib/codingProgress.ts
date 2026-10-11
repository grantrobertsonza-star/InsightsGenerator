// In-memory tracker for the long model steps of qualitative coding, so the page can show a bar and an
// estimate instead of a spinner that looks stuck. Like processProgress.ts it lives in process memory and
// resets on a server restart, which is fine for a single long-running Node server. One entry per
// transcript; the bar covers the current pass (the coding step, or one pass of a stability check).

export type CodingProgress = {
  runId: string;
  documentId: string;
  label: string;
  done: number;
  total: number;
  startedAt: number;
  updatedAt: number;
};

export type CodingProgressView = CodingProgress & { estimatedRemainingMs: number | null };

const g = globalThis as unknown as { __codingProgress?: Map<string, CodingProgress> };
const entries = (g.__codingProgress ??= new Map<string, CodingProgress>());
const STALE_AFTER_MS = 30 * 60 * 1000;

/** Starts (or restarts) the bar for a transcript. `total` is the number of model calls in this pass. */
export function beginCodingWork(runId: string, documentId: string, label: string, total: number): void {
  const now = Date.now();
  entries.set(documentId, { runId, documentId, label, done: 0, total: Math.max(1, total), startedAt: now, updatedAt: now });
}

export function tickCodingWork(documentId: string): void {
  const e = entries.get(documentId);
  if (!e) return;
  entries.set(documentId, { ...e, done: Math.min(e.total, e.done + 1), updatedAt: Date.now() });
}

export function endCodingWork(documentId: string): void {
  entries.delete(documentId);
}

/** The bar's wording, set by a caller that knows more than "coding", such as "Stability check, pass 2 of 3". */
export function relabelCodingWork(documentId: string, label: string): void {
  pendingLabels.set(documentId, label);
}
const pendingLabels = new Map<string, string>();

/** Label chosen by the caller for the next pass, or the default. Reading it clears nothing: it stays until relabelled. */
export function labelFor(documentId: string, fallback: string): string {
  return pendingLabels.get(documentId) ?? fallback;
}

export function clearCodingLabel(documentId: string): void {
  pendingLabels.delete(documentId);
}

export function getRunCodingProgress(runId: string): CodingProgressView[] {
  const now = Date.now();
  const out: CodingProgressView[] = [];
  for (const [id, e] of entries) {
    if (now - e.updatedAt > STALE_AFTER_MS) {
      entries.delete(id);
      continue;
    }
    if (e.runId !== runId) continue;
    const estimatedRemainingMs = e.done > 0 ? ((now - e.startedAt) / e.done) * (e.total - e.done) : null;
    out.push({ ...e, estimatedRemainingMs });
  }
  return out;
}
