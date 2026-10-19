"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { readInstrumentAction, setInstrumentTargetAction } from "@/lib/instrumentActions";
import type { InstrumentSummary } from "@/lib/instruments";

/**
 * Reads a questionnaire or guide, then matches a questionnaire to its data file, once, without a
 * click, when it has not been read or matched yet. Shared by the full InstrumentCard and the
 * one-line questionnaire entry shown in a data file's pane (Grant, 2026-10-19: the full card there
 * repeated the questionnaire's own card), so either place starts the same work by the same rule.
 * The actions revalidate the page, so the summary that drives this updates by itself.
 */
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
}): { running: boolean; error: string | null; message: string | null } {
  const [running, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const started = useRef(false);
  useEffect(() => {
    if (started.current || running) return;
    const needsRead = enabled && summary.items === 0;
    const links = summary.links.suggested + summary.links.confirmed + summary.links.rejected;
    const needsMatch = enabled && !isGuide && !!target && summary.items > 0 && links === 0;
    if (!needsRead && !needsMatch) return;
    started.current = true;
    start(async () => {
      if (needsRead) {
        const r = await readInstrumentAction(runId, documentId);
        if (!r.ok) {
          setError(r.error);
          return;
        }
      }
      if (!isGuide && target) {
        const m = await setInstrumentTargetAction(runId, documentId, target);
        if (!m.ok) setError(m.error);
        else setMessage(`${m.suggested} links suggested. Check them before they are used.`);
      }
    });
  }, [enabled, running, summary.items, summary.links.suggested, summary.links.confirmed, summary.links.rejected, isGuide, target, runId, documentId]);
  return { running, error, message };
}
