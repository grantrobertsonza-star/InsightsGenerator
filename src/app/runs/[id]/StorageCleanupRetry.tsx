"use client";

import { useState, useTransition } from "react";
import { retryDocumentStorageCleanup } from "@/lib/documentActions";

export default function StorageCleanupRetry({ runId, count }: { runId: string; count: number }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
      <p>{count} file cleanup{count === 1 ? " is" : "s are"} pending after an upload or deletion. Stored files without a document still need cleanup.</p>
      {error && <p role="alert">{error}</p>}
      <button disabled={pending} className="mt-2 font-medium underline" onClick={() => start(async () => {
        const result = await retryDocumentStorageCleanup(runId);
        setError(result.ok ? null : result.error ?? "Cleanup could not complete. Try again.");
      })}>{pending ? "Retrying cleanup..." : "Retry file cleanup"}</button>
    </div>
  );
}
