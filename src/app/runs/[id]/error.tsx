"use client";

import { useEffect } from "react";
import { actionFailureMessage } from "./actionFailure";

/**
 * Fallback for an unexpected error anywhere in a project page. Without this route boundary an
 * uncaught error replaced the whole application with the framework's generic client-exception
 * screen and no way back except a manual reload. Controls that hold researcher text catch their
 * own failures (actionFailure.ts) so they never reach here; this covers everything else.
 * `retry` re-fetches and re-renders the page segment.
 */
export default function ProjectError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div role="alert" className="mx-auto max-w-xl space-y-3 rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-900">
      <h2 className="text-base font-semibold">This part of the project could not be shown</h2>
      <p>{actionFailureMessage(error)}</p>
      <p className="text-red-800">Work that was already saved is kept. Changes that were not yet saved may need to be entered again. Try again, or reload the page.</p>
      <button
        type="button"
        onClick={() => retry()}
        className="rounded-lg border border-red-300 bg-white px-3 py-1.5 font-medium text-red-900 hover:bg-red-100"
      >
        Try again
      </button>
    </div>
  );
}
