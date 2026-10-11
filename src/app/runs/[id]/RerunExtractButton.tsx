"use client";

import { useFormStatus } from "react-dom";

/**
 * Small "run again" button for a report that has already been extracted. Asks first, because a rerun
 * replaces the report's findings (the current ones are archived in the run's history, not lost).
 * Must sit inside the form whose action runs the extraction.
 */
export default function RerunExtractButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      onClick={(e) => {
        if (
          !window.confirm(
            "Run extraction again? This replaces the findings from this report. The current ones are kept in the run's history.",
          )
        ) {
          e.preventDefault();
        }
      }}
      className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-white px-2 py-1 text-xs font-medium text-foreground shadow-sm transition hover:bg-slate-50 disabled:cursor-wait disabled:opacity-70"
    >
      {pending ? (
        <>
          <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent" />
          Extracting...
        </>
      ) : (
        "Run again"
      )}
    </button>
  );
}
