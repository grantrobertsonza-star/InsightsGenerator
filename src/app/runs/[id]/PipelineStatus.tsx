"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Stage = {
  id: string;
  label: string;
  status: "pending" | "active" | "done" | "error";
};

type Payload = {
  phase: "extracting" | "finishing" | "done";
  stages: Stage[];
} | null;

/**
 * Shows each stage of the processing pipeline as it finishes. The click that
 * starts processing returns once documents are read and coded; the stages
 * after that carry on in the background, and this card marks each one
 * complete as it is done and refreshes the page so its results appear. It
 * renders nothing when no run is in progress.
 */
export default function PipelineStatus({ runId }: { runId: string }) {
  const router = useRouter();
  const [progress, setProgress] = useState<Payload>(null);
  const lastDone = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch(`/api/runs/${runId}/process-progress`, {
          cache: "no-store",
        });
        if (!response.ok || cancelled) return;
        const data = (await response.json()) as { progress: Payload };
        if (cancelled) return;
        setProgress(data.progress);
        const done = data.progress
          ? data.progress.stages.filter((s) => s.status === "done").length
          : 0;
        if (data.progress && done > lastDone.current) router.refresh();
        lastDone.current = data.progress ? done : 0;
      } catch {
        // A missed poll just means the next one picks it up.
      }
    };
    poll();
    const timer = setInterval(poll, 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [runId, router]);

  if (!progress) return null;
  const allDone = progress.phase === "done";

  return (
    <div className="mb-4 rounded-lg border border-border bg-white px-4 py-3 text-xs">
      <p className="mb-2 font-bold text-foreground">
        {allDone
          ? "Processing complete"
          : "Processing continues in the background"}
      </p>
      <ul className="space-y-1">
        {progress.stages.map((s) => (
          <li key={s.id} className="flex items-center gap-2">
            <span
              aria-hidden
              className={
                s.status === "done"
                  ? "text-success"
                  : s.status === "error"
                    ? "text-danger"
                    : s.status === "active"
                      ? "animate-pulse text-primary"
                      : "text-slate-300"
              }
            >
              {s.status === "done"
                ? "✓"
                : s.status === "error"
                  ? "!"
                  : s.status === "active"
                    ? "●"
                    : "○"}
            </span>
            <span
              className={
                s.status === "pending" ? "text-muted" : "text-foreground"
              }
            >
              {s.label}
              {s.status === "done" ? " (done)" : ""}
              {s.status === "error" ? " (did not finish, see the trace)" : ""}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
