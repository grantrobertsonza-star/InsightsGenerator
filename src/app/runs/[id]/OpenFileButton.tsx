"use client";

import { useState } from "react";
import { openDocumentAction } from "@/lib/documentOpenActions";

/**
 * Opens an imported file in a new tab (a PDF view, or the original as a download). The tab is opened
 * straight away, inside the click, so the browser does not block it as a pop-up, and is pointed at the
 * short-lived link once the server has checked the file belongs to this project; on failure the tab
 * is closed and the reason is shown here.
 */
export default function OpenFileButton({ runId, documentId, filename, className, label = "Open" }: { runId: string; documentId: string; filename: string; className?: string; label?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        disabled={busy}
        aria-label={`Open ${filename}`}
        title={`Open ${filename}`}
        onClick={async (e) => {
          e.stopPropagation(); // the card behind selects the file; opening is separate
          setError(null);
          setBusy(true);
          const tab = window.open("", "_blank");
          const res = await openDocumentAction(runId, documentId).catch(() => ({ ok: false as const, error: "The connection to the server was interrupted. Try again." }));
          setBusy(false);
          if (!res.ok) {
            tab?.close();
            setError(res.error);
            return;
          }
          if (tab) tab.location.href = res.url;
          else window.location.href = res.url; // pop-ups blocked: open here instead
        }}
        className={className ?? "rounded-md border border-border bg-white px-2 py-0.5 text-[11px] font-medium text-primary hover:bg-primary-light disabled:opacity-50"}
        data-testid="open-file"
      >
        {busy ? "Opening..." : label}
      </button>
      {error && (
        <span role="alert" className="mt-1 text-[11px] text-red-800">
          {error}
        </span>
      )}
    </span>
  );
}
