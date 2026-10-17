// How a recommendation's decision currentness is said in words, in every export that lists
// recommendations (golden-thread GT-004). The rule itself is in decisionContext.ts
// (recommendationDecisionStateSql); this only turns its result into the text an export shows, so
// the workbook and the deck cannot word it differently.
import { EARLIER_DECISIONS_LABEL } from "./decisionContext";

export type RecommendationDecisionRow = {
  source: string;
  decision_context: string | null;
  decision_state: "earlier" | "unknown" | null;
};

/** Cell text for "Decisions written for". */
export function decisionsWrittenFor(row: RecommendationDecisionRow): string {
  if (row.source !== "ai_suggested") return "Written by the researcher";
  if (row.decision_state === "earlier") return `${EARLIER_DECISIONS_LABEL} (the accepted decisions have changed since): ${row.decision_context}`;
  if (row.decision_state === "unknown") return "Not recorded: written before the decisions behind recommendations were recorded; check it against the current decisions";
  return row.decision_context ?? "";
}

/** Short tag for a deck card; empty when the recommendation matches the current decisions. */
export function decisionTag(row: RecommendationDecisionRow): string {
  if (row.decision_state === "earlier") return " · WRITTEN FOR EARLIER DECISIONS";
  if (row.decision_state === "unknown") return " · DECISIONS NOT RECORDED";
  return "";
}
