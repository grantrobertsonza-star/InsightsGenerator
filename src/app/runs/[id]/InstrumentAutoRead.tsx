"use client";

import type { InstrumentSummary } from "@/lib/instruments";
import { useInstrumentAutoStart } from "./useInstrumentAutoStart";

/**
 * Starts a questionnaire's or guide's first read (and a questionnaire's first match) as soon as the
 * Import screen shows it, whichever file is selected (Grant, 2026-10-20: "when I add one, it is not
 * automatically read"). Renders nothing: the card and the linked file's tab show the progress, from
 * the same shared state (useInstrumentAutoStart). The match target is the data file it was matched to
 * before; otherwise the server chooses (the only data file, or the one whose variables clearly match
 * the most questions) or, when several fit, leaves the choice on the card.
 */
export default function InstrumentAutoRead({
  runId,
  documentId,
  summary,
}: {
  runId: string;
  documentId: string;
  summary: InstrumentSummary;
}) {
  const isGuide = summary.type === "interview_guide" || summary.type === "focus_group_guide";
  // No data file named yet: the server chooses it (chooseMatchTarget), or asks when several fit.
  const target = isGuide ? "" : (summary.forDocumentId ?? "");
  useInstrumentAutoStart({ runId, documentId, summary, isGuide, target, enabled: true });
  return null;
}
