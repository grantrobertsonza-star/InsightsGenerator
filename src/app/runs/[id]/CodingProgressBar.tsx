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
export default function CodingProgressBar({ runId, active }: { runId: string; active: boolean }) {
  const [entries, setEntries] = useState<Entry[]>([]);

  useEffect(() => {
    if (!active) {
      setEntries([]);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch(`/api/runs/${runId}/coding-progress`, { cache: "no-store" });
        if (!response.ok || cancelled) return;
        const data = (await response.json()) as { progress: Entry[] };
        if (!cancelled) setEntries(data.progress);
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
  }, [active, runId]);

  if (!active || entries.length === 0) return null;
  return (
    <div className="mt-2 space-y-2" aria-live="polite">
      {entries.map((e) => {
        const pct = Math.round((e.done / e.total) * 100);
        const quiet = Date.now() - e.updatedAt > 90_000;
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
