"use client";

import { useState } from "react";
import CrosstabWorkspace from "./CrosstabWorkspace";

/**
 * The launcher on a data file's card. The work happens in a full-window
 * workspace because a survey can have thousands of variables.
 */
export default function CrosstabBuilder({
  runId,
  documentId,
  filename,
  saved,
}: {
  runId: string;
  documentId: string;
  filename: string;
  saved: { id: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-border bg-white p-3 text-xs">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-medium text-foreground">Crosstabs</p>
          <p className="text-[11px] text-muted">
            {saved.length > 0
              ? `${saved.length} table${saved.length > 1 ? "s" : ""} in the set. Open the workspace to view, add or commit.`
              : "Build a set of weighted crosstabs from the full variable list, then commit it to generate findings."}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:opacity-90"
        >
          Open workspace
        </button>
      </div>
      {open && (
        <CrosstabWorkspace
          runId={runId}
          documentId={documentId}
          filename={filename}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
