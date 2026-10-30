"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { TrashIcon } from "@/components/icons";
import type { DeleteRunResult } from "@/lib/runActions";
import { actionFailureMessage } from "./runs/[id]/actionFailure";

/**
 * Deletes a project after confirmation and says what happened (Codex RR-F03, 2026-10-23): a refusal
 * (for example the database update deletion needs is missing) is shown beside the button, and a
 * deletion whose file removal failed says the files are listed above for a retry.
 */
export default function DeleteRunButton({ action }: { action: () => Promise<DeleteRunResult> }) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!confirm("Delete this project and everything in it? This can't be undone.")) return;
          setMessage(null);
          start(async () => {
            try {
              const r = await action();
              if (!r.ok) setMessage(r.error);
              router.refresh();
            } catch (e) {
              setMessage(actionFailureMessage(e));
            }
          });
        }}
        className="flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-500 transition hover:border-danger hover:bg-danger-light hover:text-danger disabled:opacity-60"
      >
        <TrashIcon className="h-3.5 w-3.5" />
        {pending ? "Deleting..." : "Delete"}
      </button>
      {message && (
        <p role="alert" className="max-w-xs text-right text-xs text-red-700" data-testid="delete-run-error">
          {message}
        </p>
      )}
    </div>
  );
}
