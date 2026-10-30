"use client";

import { useState, useTransition } from "react";
import type { BinItem } from "@/lib/documentBin";
import { emptyBinAction, eraseDocumentAction, restoreDocumentAction } from "@/lib/documentActions";
import { actionFailureMessage } from "./actionFailure";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-ZA", { year: "numeric", month: "short", day: "numeric" });

function summary(item: BinItem): string {
  const c = item.counts;
  const parts = [`${c.findings} finding${c.findings === 1 ? "" : "s"} archived`];
  if (c.notes > 0) parts.push(`${c.notes} with your note${c.notes === 1 ? "" : "s"}`);
  if (c.suggestionsRemoved > 0) parts.push(`${c.suggestionsRemoved} objective or decision suggestion${c.suggestionsRemoved === 1 ? "" : "s"} removed`);
  if (c.objectivesMarked > 0) parts.push(`${c.objectivesMarked} kept objective${c.objectivesMarked === 1 ? "" : "s"} or decision${c.objectivesMarked === 1 ? "" : "s"} marked`);
  return parts.join(", ");
}

/**
 * Removed files, each with Restore (the file, its findings, review decisions and notes come back) and
 * Erase now (cannot be undone), and Empty bin for all of them. The list follows the server after each action (revalidation); a refusal
 * is shown beside the item.
 */
export default function BinPanel({ runId, items, expired, error }: { runId: string; items: BinItem[]; expired: number; error: string | null }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [messages, setMessages] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [binMessage, setBinMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const emptyBin = () => {
    if (!confirm(`Erase all ${items.length} removed file${items.length === 1 ? "" : "s"} for good? Their findings, the history of those findings and your notes on them, and the stored files are removed. This cannot be undone.`)) return;
    start(async () => {
      try {
        const r = await emptyBinAction(runId);
        setBinMessage(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
      } catch (e) {
        setBinMessage({ ok: false, text: actionFailureMessage(e) });
      }
    });
  };
  const act = (item: BinItem, kind: "restore" | "erase") => {
    if (kind === "erase" && !confirm(`Erase ${item.filename} for good? Its findings, their history and your notes on them, and the stored file are removed. This cannot be undone.`)) return;
    start(async () => {
      try {
        const r = kind === "restore" ? await restoreDocumentAction(runId, item.removalId) : await eraseDocumentAction(runId, item.documentId);
        setMessages((m) => ({ ...m, [item.removalId]: r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error } }));
      } catch (e) {
        setMessages((m) => ({ ...m, [item.removalId]: { ok: false, text: actionFailureMessage(e) } }));
      }
    });
  };
  return (
    <section className="mb-3 rounded-xl border border-border bg-white px-3 py-2 text-sm" aria-label="Removed files" data-testid="bin-panel">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between text-left font-medium text-foreground">
        <span>
          Removed files{items.length > 0 ? ` (${items.length})` : ""}
        </span>
        <span className="text-xs text-muted">{open ? "Hide" : "Show"}</span>
      </button>
      {error && (
        <p role="alert" className="mt-1 text-xs text-danger">
          The removed files could not be read: {error}
        </p>
      )}
      {expired > 0 && (
        <p className="mt-1 text-xs text-muted" data-testid="bin-expired">
          {expired} file{expired === 1 ? " was" : "s were"} erased after 30 days in the bin.
        </p>
      )}
      {binMessage && (
        <p role={binMessage.ok ? "status" : "alert"} className={`mt-1 text-xs ${binMessage.ok ? "text-emerald-700" : "text-danger"}`}>
          {binMessage.text}
        </p>
      )}
      {open && items.length > 0 && (
        <div className="mt-2 flex justify-end">
          <button type="button" disabled={pending} onClick={emptyBin} className="rounded-md border border-border px-2 py-1 text-xs font-medium text-danger hover:border-danger disabled:opacity-50">
            Empty bin
          </button>
        </div>
      )}
      {open && items.length > 0 && (
        <ul className="mt-2 space-y-2">
          {items.map((item) => (
            <li key={item.removalId} className="rounded-lg border border-border px-3 py-2" data-testid="bin-item" data-document-id={item.documentId}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-medium text-foreground">{item.filename}</div>
                  <div className="text-xs text-muted">
                    Removed {day(item.removedAt)}; erased {day(item.expiresAt)} unless restored. {summary(item)}.
                  </div>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <button type="button" disabled={pending} onClick={() => act(item, "restore")} className="rounded-md border border-border px-2 py-1 text-xs font-medium hover:border-primary disabled:opacity-50">
                    Restore
                  </button>
                  <button type="button" disabled={pending} onClick={() => act(item, "erase")} className="rounded-md border border-border px-2 py-1 text-xs font-medium text-danger hover:border-danger disabled:opacity-50">
                    Erase now
                  </button>
                </div>
              </div>
              {messages[item.removalId] && (
                <p role={messages[item.removalId].ok ? "status" : "alert"} className={`mt-1 text-xs ${messages[item.removalId].ok ? "text-emerald-700" : "text-danger"}`}>
                  {messages[item.removalId].text}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
