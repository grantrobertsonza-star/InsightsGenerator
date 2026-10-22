"use client";

import { useState } from "react";
import { openDocumentAction } from "@/lib/documentOpenActions";

/**
 * Opens or downloads an imported file through a short-lived link the server signs after checking the
 * file belongs to this project; on failure the reason is shown here.
 *
 * - `mode="download"` (View original, Grant 2026-10-22): the original downloads under its own name and
 *   the page stays as it is. No window is opened: the signed link is an attachment, so following it
 *   from a plain anchor downloads the file without navigating away.
 * - `mode="view"`: a PDF view in a new tab (or the original as a download). The tab is opened straight
 *   away, inside the click, so the browser does not block it as a pop-up, and pointed at the link once
 *   the server has answered; on failure the tab is closed.
 */
export default function OpenFileButton({
  runId,
  documentId,
  filename,
  className,
  label = "Open",
  mode = "view",
}: {
  runId: string;
  documentId: string;
  filename: string;
  className?: string;
  label?: string;
  mode?: "view" | "download";
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const verb = mode === "download" ? "Download" : "Open";
  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        disabled={busy}
        aria-label={`${verb} ${filename}`}
        title={`${verb} ${filename}`}
        onClick={async (e) => {
          e.stopPropagation(); // the card behind selects the file; opening is separate
          setError(null);
          setBusy(true);
          const tab = mode === "view" ? window.open("", "_blank") : null;
          const res = await openDocumentAction(runId, documentId, mode).catch(() => ({ ok: false as const, error: "The connection to the server was interrupted. Try again." }));
          setBusy(false);
          if (!res.ok) {
            tab?.close();
            setError(res.error);
            return;
          }
          if (mode === "download") {
            const a = document.createElement("a");
            a.href = res.url;
            a.download = filename; // honoured on the same origin; the signed link's attachment header covers the rest
            a.rel = "noopener";
            document.body.appendChild(a);
            a.click();
            a.remove();
            return;
          }
          if (tab) tab.location.href = res.url;
          else window.location.href = res.url; // pop-ups blocked: open here instead
        }}
        className={className ?? "rounded-md border border-border bg-white px-2 py-0.5 text-[11px] font-medium text-primary hover:bg-primary-light disabled:opacity-50"}
        data-testid="open-file"
      >
        {busy ? (mode === "download" ? "Preparing..." : "Opening...") : label}
      </button>
      {error && (
        <span role="alert" className="mt-1 text-[11px] text-red-800">
          {error}
        </span>
      )}
    </span>
  );
}
