"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PendingProjectCleanup } from "@/lib/projectStorageCleanup";
import { retryProjectStorageCleanup } from "@/lib/runActions";
import { actionFailureMessage } from "./runs/[id]/actionFailure";

/**
 * Storage locations whose removal is not yet confirmed (deleted projects' files and converted copies;
 * Codex RR-F03, RR-M02, 2026-10-23), with the last error
 * and a retry; or a plain note when the list itself could not be read. Nothing shows when there is
 * nothing pending.
 */
export default function ProjectCleanupNotice({ state }: { state: { ok: true; items: PendingProjectCleanup[]; locations: number } | { ok: false; error: string } }) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();
  if (!state.ok)
    return (
      <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900" data-testid="project-cleanup-unknown">
        {`Whether files of deleted projects or converted copies are still in storage could not be checked: ${state.error.replace(/\.$/, "")}. Reload the page to try again.`}
      </p>
    );
  if (state.items.length === 0) return null;
  // Locations, not files (Codex RR-M02): a deleted project's record lists every place its files
  // could be, such as a converted copy that may never have been made, and storage has not confirmed
  // removing them. Whether a file is actually there is not known until the removal succeeds. The
  // total is of distinct locations, read with the list (records can name the same one).
  const locations = state.locations;
  const where = (n: number) => (n === 1 ? "1 storage location" : `${n} storage locations`);
  return (
    <section className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" data-testid="project-cleanup-pending">
      <p className="font-medium">{`Files may still be in storage: removal is not yet confirmed for ${where(locations)}.`}</p>
      <ul className="mt-1 list-disc pl-5 text-xs">
        {state.items.map((i) => (
          <li key={i.id}>
            {i.kind === "converted_copy"
              ? `A converted copy of a data file in ${i.projectName ?? "an untitled project"}`
              : `Deleted project ${i.projectName ?? "Untitled project"}: ${where(i.locations)}`}
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
                // `remaining` counts cleanup records, which can overlap, so it is not shown as a count.
                setMessage(r.ok ? (r.remaining === 0 ? "All removed." : "Not all removed; the error is shown above.") : r.error);
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
