"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import CodingProgressBar from "./CodingProgressBar";

/**
 * The "Code themes" button and its progress, for one transcript (Codex IR-07, 2026-10-20).
 *
 * The form's own pending state only lasts while this component stays mounted in the page that
 * submitted it. Coding runs on the server for minutes, so the server's in-memory progress for this
 * transcript (the same /coding-progress the bar polls) is also read: while it lists this document the
 * button stays disabled and the bar shows, after a reload, in another tab, or after the card was
 * remounted. When that server run ends without this page's own submission pending, the page is
 * refreshed once so the new codebook appears.
 *
 * The progress store and the one-run-per-transcript claim (lib/codingProgress.ts) are per server
 * instance: a run on another instance of a multi-instance deployment is not seen here or refused.
 */
export default function CodeThemesSubmit({
  runId,
  documentId,
  className,
  icon,
  children,
}: {
  runId: string;
  documentId: string;
  className: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  const { pending } = useFormStatus();
  const router = useRouter();
  const [serverRunning, setServerRunning] = useState(false);
  const wasRunning = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const response = await fetch(`/api/runs/${runId}/coding-progress`, { cache: "no-store" });
        if (!response.ok || cancelled) return;
        const data = (await response.json()) as { progress: { documentId: string }[] };
        if (!cancelled) setServerRunning(data.progress.some((p) => p.documentId === documentId));
      } catch {
        // A missed check keeps the last answer; the next one corrects it.
      }
    };
    check();
    const timer = setInterval(check, 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [runId, documentId]);

  useEffect(() => {
    if (wasRunning.current && !serverRunning && !pending) router.refresh();
    wasRunning.current = serverRunning;
  }, [serverRunning, pending, router]);

  const running = pending || serverRunning;
  return (
    <>
      <button
        type="submit"
        disabled={running}
        aria-busy={running}
        className={`${className} disabled:cursor-wait disabled:opacity-70`}
      >
        {running ? (
          <>
            <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent" />
            Coding...
          </>
        ) : (
          <>
            {icon}
            {children}
          </>
        )}
      </button>
      <CodingProgressBar runId={runId} active={running} documentId={documentId} />
    </>
  );
}
