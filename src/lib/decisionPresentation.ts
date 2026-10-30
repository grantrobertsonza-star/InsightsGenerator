import { splitSentences } from "./sentences";

/**
 * The evidence summary (runs.evidence_synthesis, written by the decision framer's first pass) as
 * its sentences, for display. Presentation only: the stored wording is unchanged and nothing is
 * dropped, so joining the points gives back the summary with its spacing normalised.
 */
export function evidenceSummaryPoints(text: string): string[] {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat ? splitSentences(flat) : [];
}
