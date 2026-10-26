"use client";

import { useEffect, useState } from "react";

type Entry = {
  documentId: string;
  label: string;
  done: number;
  total: number;
  updatedAt: number;
  estimatedRemainingMs: number | null;
};

function eta(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes <= 0) return "under a minute left";
  return minutes === 1 ? "about 1 minute left" : `about ${minutes} minutes left`;
}

/**
 * A bar for the long model steps of coding, so the page does not look stuck. Polls only while `active`.
 * It shows the current pass; a stability check names its pass in the label. If nothing has finished for
 * a while it says the model is still working, since a few slow calls are normal.
 */
export default function CodingProgressBar({
  runId,
  active,
  documentId,
}: {
  runId: string;
  active: boolean;
  /** Show only this transcript's progress (Code themes on one card); all of the run's otherwise. */
  documentId?: string;
}) {
  const [entries, setEntries] = useState<Entry[]>([]);
  // When the last poll answered: the "still working" hint compares against this rather than
  // reading the clock during render (the bar re-renders on every poll, so the timing is the same).
  const [polledAt, setPolledAt] = useState(0);

  // Progress from an earlier active period is dropped when the bar is switched off, so switching it on
  // again never shows the previous run of work until the first poll answers. Done while rendering
  // (React's pattern for state that follows a prop) rather than in the effect.
  const [wasActive, setWasActive] = useState(active);
  if (active !== wasActive) {
    setWasActive(active);
    if (!active) setEntries([]);
  }

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch(`/api/runs/${runId}/coding-progress`, { cache: "no-store" });
        if (!response.ok || cancelled) return;
        const data = (await response.json()) as { progress: Entry[] };
        if (!cancelled) {
          setEntries(documentId ? data.progress.filter((p) => p.documentId === documentId) : data.progress);
          setPolledAt(Date.now());
        }
      } catch {
        // A missed poll just means one update is skipped.
      }
    };
    poll();
    const timer = setInterval(poll, 1500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [active, runId, documentId]);

  if (!active || entries.length === 0) return null;
  return (
    <div className="mt-2 space-y-2" aria-live="polite">
      {entries.map((e) => {
        const pct = Math.round((e.done / e.total) * 100);
        const quiet = polledAt - e.updatedAt > 90_000;
        return (
          <div key={e.documentId}>
            <div className="flex justify-between text-[11px] text-muted">
              <span>{e.label}</span>
              <span>
                {e.total > 1 ? `${e.done} of ${e.total} (${pct}%)` : "working"}
                {e.estimatedRemainingMs !== null ? `, ${eta(e.estimatedRemainingMs)}` : ""}
              </span>
            </div>
            <div
              className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-200"
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
            </div>
            {quiet && (
              <p className="mt-1 text-[11px] text-muted">Still working. A few slow calls to the model are normal.</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
