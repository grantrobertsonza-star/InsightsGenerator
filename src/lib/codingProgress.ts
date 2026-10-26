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

/**
 * One "Code themes" run per transcript on this server (Codex IR-07, 2026-10-20). The claim covers the
 * whole action, including the steps before the first model pass that have no bar of their own, and
 * shows as "Preparing coding" so a page opened meanwhile sees the transcript as busy. Like the bars it
 * is process memory: it stops a second start on the same server instance (a double click, a second
 * tab, a remounted card), not on another instance of a multi-instance deployment, and it is cleared
 * by a restart. An abandoned claim lapses with the bars, after STALE_AFTER_MS.
 */
const claims = (((globalThis as unknown as { __codingClaims?: Map<string, { runId: string; at: number }> }).__codingClaims ??= new Map()));

/** True when this call now holds the transcript's run; false when another run already holds it. */
export function claimCodingRun(runId: string, documentId: string): boolean {
  const held = claims.get(documentId);
  if (held && Date.now() - held.at <= STALE_AFTER_MS) return false;
  claims.set(documentId, { runId, at: Date.now() });
  return true;
}

export function releaseCodingRun(documentId: string): void {
  claims.delete(documentId);
}

export function getRunCodingProgress(runId: string): CodingProgressView[] {
  const now = Date.now();
  const out: CodingProgressView[] = [];
  for (const [id, c] of claims) {
    if (now - c.at > STALE_AFTER_MS) {
      claims.delete(id);
      continue;
    }
    if (c.runId === runId && !entries.has(id)) {
      out.push({ runId, documentId: id, label: "Preparing coding", done: 0, total: 1, startedAt: c.at, updatedAt: c.at, estimatedRemainingMs: null });
    }
  }
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
