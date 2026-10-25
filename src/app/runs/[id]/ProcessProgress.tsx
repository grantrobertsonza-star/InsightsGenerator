"use client";

import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import CodingProgressBar from "./CodingProgressBar";

type ProgressPayload = {
  phase: "extracting" | "finishing" | "done";
  done: number;
  total: number;
  estimatedRemainingMs: number | null;
} | null;

function formatEta(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes <= 0) return "under a minute remaining";
  if (minutes === 1) return "about 1 minute remaining";
  return `about ${minutes} minutes remaining`;
}

/**
 * The bare-minimum "it's still working, here's roughly where it's at"
 * signal for the long-running processing forms. Must be rendered inside
 * the same <form> as the SubmitButton whose pending state it piggybacks
 * on (useFormStatus reads from that form), and it only starts polling once
 * that form goes pending, so it never shows a stale count from a previous
 * run. The ETA is a straight-line extrapolation from the documents
 * finished so far in THIS run, so it only appears once at least one
 * document is done and only while still in the per-document "extracting"
 * phase; the verify/chain-validate/insights/synthesis/recommendations
 * tail that follows has no per-document signal to extrapolate from, so
 * that stretch just says it's finishing up with no ETA.
 */
export default function ProcessProgress({ runId }: { runId: string }) {
  const { pending } = useFormStatus();
  const [progress, setProgress] = useState<ProgressPayload>(null);
  // The last submission's progress is dropped when it ends, so the next one never starts from it.
  // Done while rendering (React's pattern for state that follows a value) rather than in the effect.
  const [wasPending, setWasPending] = useState(pending);
  if (pending !== wasPending) {
    setWasPending(pending);
    if (!pending) setProgress(null);
  }

  useEffect(() => {
    if (!pending) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const response = await fetch(`/api/runs/${runId}/process-progress`, {
          cache: "no-store",
        });
        if (!response.ok || cancelled) return;
        const data = (await response.json()) as { progress: ProgressPayload };
        if (!cancelled) setProgress(data.progress);
      } catch {
        // A missed poll just means we skip one update; the next tick retries.
      }
    };

    poll();
    const timer = setInterval(poll, 1500);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [pending, runId]);

  if (!pending) return null;
  const bar = <CodingProgressBar runId={runId} active={pending} />;
  if (!progress || progress.phase === "done") return bar;

  if (progress.phase === "finishing") {
    return (
      <>
        <p className="mt-1.5 text-xs text-muted">
          Finishing up (verifying and synthesizing)...
        </p>
        {bar}
      </>
    );
  }

  const etaText =
    progress.estimatedRemainingMs !== null
      ? `, ${formatEta(progress.estimatedRemainingMs)}`
      : "";

  return (
    <>
      <p className="mt-1.5 text-xs text-muted">
        {progress.done} of {progress.total} documents processed{etaText}
      </p>
      {bar}
    </>
  );
}
