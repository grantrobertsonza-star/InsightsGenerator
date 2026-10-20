"use client";

import { useEffect, useSyncExternalStore } from "react";
import { readInstrumentAction, setInstrumentTargetAction } from "@/lib/instrumentActions";
import type { InstrumentSummary } from "@/lib/instruments";

/**
 * Reads a questionnaire or guide, then matches a questionnaire to its data file, once, without a
 * click, when it has not been read or matched yet. Used by the Import screen's background reader
 * (InstrumentAutoRead: every questionnaire and guide is read as soon as Import shows it, Grant
 * 2026-10-20: "when I add one, it is not automatically read"), the full InstrumentCard and the
 * one-line entry in a data file's or transcript's tab, so all start the same work by the same rule.
 *
 * Once per page, not once per place: several of these can be mounted for one questionnaire at the
 * same time, and reading is a paid model call, so the first to see the need starts it and the rest
 * show its progress. The state lives here, outside the components, keyed by the questionnaire. A
 * read that failed is not retried by itself, in this page or on a later visit (the failure is
 * recorded, InstrumentSummary.readFailure); "Read" again on the card is the researcher's retry.
 * The actions revalidate the page, so the summary that drives this updates by itself.
 */
type AutoState = { running: boolean; error: string | null; message: string | null };
const IDLE: AutoState = { running: false, error: null, message: null };
const states = new Map<string, AutoState>();
const listeners = new Set<() => void>();
const begun = new Set<string>();
const setState = (documentId: string, s: AutoState) => {
  states.set(documentId, s);
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useInstrumentAutoStart({
  runId,
  documentId,
  summary,
  isGuide,
  target,
  enabled,
}: {
  runId: string;
  documentId: string;
  summary: InstrumentSummary;
  isGuide: boolean;
  /** The data file to match a questionnaire to; empty when there is none. */
  target: string;
  enabled: boolean;
}): AutoState {
  const state = useSyncExternalStore(
    subscribe,
    () => states.get(documentId) ?? IDLE,
    () => IDLE,
  );
  useEffect(() => {
    if (!enabled) return;
    // A read that failed before (readFailure, recorded) is not repeated by itself: reading is paid.
    const needsRead = summary.items === 0 && !summary.readFailure;
    const links = summary.links.suggested + summary.links.confirmed + summary.links.rejected;
    const needsMatch = !isGuide && !!target && summary.items > 0 && links === 0;
    const key = needsRead ? `${documentId}:read` : needsMatch ? `${documentId}:match:${target}` : null;
    if (!key || begun.has(key)) return;
    begun.add(key);
    // Reading leads on to matching in the same run; a later match of the same file is not repeated.
    if (needsRead && !isGuide && target) begun.add(`${documentId}:match:${target}`);
    setState(documentId, { running: true, error: null, message: null });
    void (async () => {
      if (needsRead) {
        const r = await readInstrumentAction(runId, documentId).catch(() => ({ ok: false as const, error: "The connection to the server was interrupted while reading. Use Read again." }));
        if (!r.ok) return setState(documentId, { running: false, error: r.error, message: null });
      }
      if (!isGuide && target) {
        const m = await setInstrumentTargetAction(runId, documentId, target).catch(() => ({ ok: false as const, error: "The connection to the server was interrupted while matching. Use Match again." }));
        if (!m.ok) return setState(documentId, { running: false, error: m.error, message: null });
        return setState(documentId, { running: false, error: null, message: `${m.suggested} links suggested. Check them before they are used.` });
      }
      setState(documentId, { running: false, error: null, message: null });
    })();
  }, [enabled, summary.items, summary.readFailure, summary.links.suggested, summary.links.confirmed, summary.links.rejected, isGuide, target, runId, documentId]);
  return state;
}
