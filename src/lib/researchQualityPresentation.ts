// Research Quality Review v1: presentation rules shared by the screen and the DOCX export. Pure
// (no database, no server code), so the client component can import it.
import type { DocumentedFact, ObservationPayload, ReviewManifest } from "./researchQualityTypes";
import type { ObservationView } from "./researchQualityView";

export const DOC_LABEL: Record<string, string> = {
  documented: "Documented",
  partial: "Partly documented",
  not_documented: "Not documented",
  conflicting: "Conflicting",
  unavailable: "Unavailable",
  not_assessed: "Not assessed",
};
export const METHOD_LABEL: Record<string, string> = { documented_strength: "Documented strength", concern: "Concern", cannot_assess: "Cannot assess", not_applicable: "Not applicable" };
export const FITNESS_LABEL: Record<string, string> = { suitable_as_documented: "Suitable as documented", qualified: "Qualified", insufficient_basis: "Insufficient basis", not_assessed: "Not assessed" };
export const TIMING_LABEL: Record<string, string> = { before_fieldwork: "Before commissioning or fieldwork", before_decision: "Before this decision", next_study: "Next study" };
export const SUPPORT_LABEL: Record<string, string> = {
  reference_supported: "Supported by an approved reference",
  insufficient_reference_support: "Insufficient reference support",
  specialist_assessment_required: "Specialist assessment required",
  not_applicable: "",
};

/** "Not documented" wording that respects coverage: complete coverage only may say "not documented". */
export function documentationLabel(p: ObservationPayload): string {
  if (p.assessment.documentation === "not_documented" && p.absenceScope !== "complete") return "Not found in the assessed passages";
  return DOC_LABEL[p.assessment.documentation] ?? p.assessment.documentation;
}

/** The text a reader sees for an observation's implication: researcher wording when given. */
export const shownImplication = (o: ObservationView) => o.wording?.text ?? o.payload.implication;

export function overview(observations: ObservationView[]) {
  const live = observations.filter((o) => o.status !== "dismissed");
  return {
    strengths: live.filter((o) => o.payload.assessment.methodology === "documented_strength"),
    concerns: live.filter((o) => o.payload.assessment.methodology === "concern"),
    gaps: live.filter((o) => ["not_documented", "partial", "conflicting", "unavailable"].includes(o.payload.assessment.documentation)),
    decisionImplications: live.filter((o) => o.payload.assessment.decisionFitness.some((d) => d.state === "qualified" || d.state === "insufficient_basis")),
    awaitingReview: observations.filter((o) => o.status === "awaiting_review").length,
    requiresReview: observations.filter((o) => o.freshness !== "current").length,
  };
}

export function improvementsByTiming(observations: ObservationView[]) {
  const live = observations.filter((o) => o.status !== "dismissed" && o.payload.improvement);
  return (["before_fieldwork", "before_decision", "next_study"] as const).map((t) => ({ timing: t, label: TIMING_LABEL[t], items: live.filter((o) => o.payload.improvement!.timing === t) }));
}

/** Facts side by side by topic and source, planned and reported-executed kept apart. */
export function alignmentRows(facts: DocumentedFact[], manifest: ReviewManifest) {
  const topics = ["population", "objective", "decision", "design", "selection", "recruitment", "sample_size", "measure", "instrument_item", "fieldwork", "analysis", "weighting", "missing_data", "claim", "limitation", "scope", "constraint", "deliverable", "assumption"];
  return topics
    .map((topic) => ({
      topic,
      bySource: manifest.sources.map((s) => ({ sourceId: s.sourceId, filename: s.filename, facts: facts.filter((f) => f.topic === topic && f.sourceVersionId === s.sourceVersionId) })),
    }))
    .filter((r) => r.bySource.some((b) => b.facts.length > 0));
}


export const GROUP_LABEL: Record<string, string> = {
  brief: "Brief",
  proposal: "Proposal",
  "proposal-method": "Proposal: methodology",
  design: "Documented design",
  instrument: "Questionnaire or guide",
  alignment: "Alignment and inference",
};

/**
 * One row per criterion: its own score and improvement. Scores are shown side by side and never
 * combined. Dismissed observations are left out; when one criterion has several observations (per
 * decision), each row is listed.
 */
export function scorecard(observations: ObservationView[]) {
  const live = observations.filter((o) => o.status !== "dismissed");
  const groups = [...new Set(live.map((o) => o.group))];
  return groups.map((g) => ({
    group: g,
    label: GROUP_LABEL[g] ?? g,
    rows: live
      .filter((o) => o.group === g)
      .map((o) => ({
        observation: o,
        score: o.payload.rating?.score ?? null,
        label: o.payload.rating?.label ?? "Not rated",
        comparison: o.payload.comparison,
        suggestion: o.payload.improvement ? [o.payload.improvement.currentAction, o.payload.improvement.futureAction].filter(Boolean).join(" ") : null,
      })),
  }));
}

export const comparisonLabel = (c: ObservationPayload["comparison"]) => (c === "compared_with_brief" ? "compared with the brief" : c === "standalone" ? "assessed on its own (no brief)" : null);

// ---------------------------------------------------------------- checklist (RQK-1)

export const CHECKLIST_STATUS_LABEL: Record<string, string> = { present: "Present", partial: "Partial", absent: "Absent", not_assessed: "Not assessed" };
export const CHECKLIST_BAND_LABEL: Record<string, string> = { strong: "Strong", workable: "Workable", weak: "Weak" };
/** "72% (Workable)", or why there is no percentage. */
export function checklistScoreText(score: { pct: number | null; band: string | null; assessed: number; total: number } | null, state: string): string {
  if (state === "failed") return "Could not be scored";
  if (state === "pending" || !score) return "Not scored yet";
  if (score.pct === null) return `Too little could be assessed (${score.assessed} of ${score.total} elements)`;
  return `${score.pct}% (${CHECKLIST_BAND_LABEL[score.band ?? ""] ?? score.band})`;
}
