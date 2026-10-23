"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PendingProjectCleanup } from "@/lib/projectStorageCleanup";
import { retryProjectStorageCleanup } from "@/lib/runActions";
import { actionFailureMessage } from "./runs/[id]/actionFailure";

/**
 * Deleted projects whose files are still in storage (Codex RR-F03, 2026-10-23), with the last error
 * and a retry; or a plain note when the list itself could not be read. Nothing shows when there is
 * nothing pending.
 */
export default function ProjectCleanupNotice({ state }: { state: { ok: true; items: PendingProjectCleanup[] } | { ok: false; error: string } }) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();
  if (!state.ok)
    return (
      <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900" data-testid="project-cleanup-unknown">
        {`Whether files of deleted projects are still in storage could not be checked: ${state.error.replace(/\.$/, "")}. Reload the page to try again.`}
      </p>
    );
  if (state.items.length === 0) return null;
  const files = state.items.reduce((n, i) => n + i.files, 0);
  return (
    <section className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" data-testid="project-cleanup-pending">
      <p className="font-medium">
        {`${files === 1 ? "1 file" : `${files} files`} from ${state.items.length === 1 ? "a deleted project is" : `${state.items.length} deleted projects are`} still in storage.`}
      </p>
      <ul className="mt-1 list-disc pl-5 text-xs">
        {state.items.map((i) => (
          <li key={i.id}>
            {`${i.projectName ?? "Untitled project"}: ${i.files === 1 ? "1 file" : `${i.files} files`}`}
            {i.lastError ? `. Last attempt failed: ${i.lastError.replace(/\.$/, "")}.` : "."}
          </li>
        ))}
      </ul>
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setMessage(null);
              try {
                const r = await retryProjectStorageCleanup();
                setMessage(r.ok ? (r.remaining === 0 ? "All removed." : `${r.remaining} still pending; the error is shown above.`) : r.error);
              } catch (e) {
                setMessage(actionFailureMessage(e));
              }
              router.refresh();
            })
          }
          className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-60"
          data-testid="project-cleanup-retry"
        >
          {pending ? "Removing..." : "Remove them now"}
        </button>
        {message && <span className="text-xs">{message}</span>}
      </div>
    </section>
  );
}
