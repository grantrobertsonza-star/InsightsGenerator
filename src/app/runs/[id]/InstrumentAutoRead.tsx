"use client";

import type { InstrumentSummary } from "@/lib/instruments";
import { useInstrumentAutoStart } from "./useInstrumentAutoStart";

/**
 * Starts a questionnaire's or guide's first read (and a questionnaire's first match) as soon as the
 * Import screen shows it, whichever file is selected (Grant, 2026-10-20: "when I add one, it is not
 * automatically read"). Renders nothing: the card and the linked file's tab show the progress, from
 * the same shared state (useInstrumentAutoStart). The match target is the card's own default: the
 * data file it was matched to before, else the first raw data file.
 */
export default function InstrumentAutoRead({
  runId,
  documentId,
  summary,
  dataDocIds,
}: {
  runId: string;
  documentId: string;
  summary: InstrumentSummary;
  dataDocIds: string[];
}) {
  const isGuide = summary.type === "interview_guide" || summary.type === "focus_group_guide";
  const target = isGuide ? "" : (summary.forDocumentId ?? dataDocIds[0] ?? "");
  useInstrumentAutoStart({ runId, documentId, summary, isGuide, target, enabled: true });
  return null;
}
