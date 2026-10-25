"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { readDataFileAction } from "@/lib/dataSetupActions";
import { actionFailureMessage } from "./actionFailure";

/**
 * Replaces a data file's stored table with what the file holds now, read by the engine's one reader
 * (readDataFileAction). Offered where a stored preview was withheld because it could not be verified
 * (importPreviewIdentity.ts). Only the stored table is replaced: findings, corrections and review
 * decisions are untouched. A failed read says why and leaves the earlier table in place.
 */
export default function ReadFileAgainButton({ runId, documentId }: { runId: string; documentId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={pending}
        data-testid="read-file-again"
        onClick={() =>
          start(async () => {
            setError(null);
            try {
              const r = await readDataFileAction(runId, documentId);
              if (r.ok) router.refresh();
              else setError(r.error);
            } catch (e) {
              setError(actionFailureMessage(e));
            }
          })
        }
        className="rounded-md border border-amber-300 bg-white px-2 py-1 text-xs font-medium text-amber-900 hover:border-amber-500 disabled:opacity-50"
      >
        {pending ? "Reading the file..." : "Read the file again"}
      </button>
      {error && (
        <span role="alert" className="text-xs text-danger">
          The file was not read again: {error}
        </span>
      )}
    </div>
  );
}
