// Research Quality Review v1: presentation rules shared by the screen and the DOCX export. Pure
// (no database, no server code), so the client component can import it.
import criteriaRelease from "../research-quality/criteria/RQC-4.json";
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
 * Short names for the scorecard, so a row reads at a glance; the full assessment question (the
 * criteria release's own wording, which is what the model was asked) stays one hover away. Keyed
 * by the stable criterion id, never by wording. A criterion added to a later release without a
 * name here shows its id, so a missing name is visible rather than silently blank.
 */
export const CRITERION_SHORT_LABEL: Record<string, string> = {
  "RQ-BRIEF-BACKGROUND": "Background",
  "RQ-BRIEF-PROBLEM": "Business problem",
  "RQ-BRIEF-DECISION": "Decisions to inform",
  "RQ-BRIEF-OBJECTIVES": "Research objectives",
  "RQ-BRIEF-METHOD-PARAMS": "Method parameters", // retired in RQC-3 (now Audience and Method)
  "RQ-BRIEF-DEADLINE": "Deadline", // retired in RQC-3 (now Timing); kept for earlier reviews
  "RQ-BRIEF-BUDGET": "Budget",
  "RQ-BRIEF-AUDIENCE": "Audience and scope",
  "RQ-BRIEF-METHOD": "Method guidance",
  "RQ-BRIEF-DELIVERABLES": "Deliverables",
  "RQ-BRIEF-TIMING": "Timing",
  "RQ-BRIEF-PRACTICAL": "Practicalities",
  "RQ-PROP-LITERATURE": "Prior evidence review",
  "RQ-PROP-RESTATEMENT": "Problem and objectives restated",
  "RQ-PROP-OBJECTIVES-ADDED": "Added objectives",
  "RQ-PROP-METHOD": "Method suitability",
  "RQ-PROP-DESIGN": "Research design",
  "RQ-PROP-SAMPLE": "Sample",
  "RQ-PROP-ANALYSIS": "Analysis plan",
  "RQ-PROP-PRODUCTS": "Deliverables",
  "RQ-PROP-TIMELINE": "Timeline",
  "RQ-PROP-BUDGET": "Budget",
  "RQ-PROP-TEAM": "Team",
  "RQ-PROP-MANAGEMENT": "Project management",
  "RQ-PROP-COMPLIANCE": "Compliance and ethics",
  "RQ-PROP-INNOVATION": "Value-add",
  "RQ-DESIGN-ALIGN": "Design fits objectives",
  "RQ-SAMPLE-RECRUIT": "Selection and recruitment",
  "RQ-MEASURE-ANALYSIS": "Measurement and analysis",
  "RQ-INFERENCE-SCOPE": "What the evidence supports",
  "RQ-INSTR-COVERAGE": "Objectives covered",
  "RQ-INSTR-WORDING": "Item wording",
  "RQ-ALIGN-CONSISTENCY": "Documents agree",
  "RQ-PLAN-EXECUTION": "Plan versus execution",
  "RQ-QUAL-PROCESS": "Qualitative process",
  "RQ-MIXED-INTEGRATION": "Mixed-method integration",
};
export const criterionShortLabel = (criterionId: string) => CRITERION_SHORT_LABEL[criterionId] ?? criterionId;

/**
 * One row per criterion: its own score and improvement. Scores are shown side by side and never
 * combined. Dismissed observations are left out; when one criterion has several observations (per
 * decision), each row is listed.
 */
export function scorecard(observations: ObservationView[]) {
  // Groups and rows follow the criteria release's order (brief, proposal, ...; background before
  // budget), not the order observations happened to be saved in.
  const live = observations.filter((o) => o.status !== "dismissed").sort((a, b) => releaseOrder(a.criterionId) - releaseOrder(b.criterionId));
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

const RELEASE_ORDER = new Map(criteriaRelease.criteria.map((c, i) => [c.criterionId, i]));
/** Position in the criteria release; a criterion it does not list goes last. */
const releaseOrder = (criterionId: string) => RELEASE_ORDER.get(criterionId) ?? Number.MAX_SAFE_INTEGER;

export const comparisonLabel = (c: ObservationPayload["comparison"]) => (c === "compared_with_brief" ? "compared with the brief" : c === "standalone" ? "assessed on its own (no brief)" : null);

// ---------------------------------------------------------------- checklist (RQK)

export const CHECKLIST_STATUS_LABEL: Record<string, string> = { present: "Present", partial: "Partial", absent: "Absent", not_assessed: "Not assessed" };
export const CHECKLIST_BAND_LABEL: Record<string, string> = { strong: "Strong", workable: "Workable", weak: "Weak" };
/** "72% (Workable)", or why there is no percentage. */
export function checklistScoreText(score: { pct: number | null; band: string | null; assessed: number; total: number } | null, state: string): string {
  if (state === "failed") return "Could not be scored";
  if (state === "pending" || !score) return "Not scored yet";
  if (score.pct === null) return `Too little could be assessed (${score.assessed} of ${score.total} elements)`;
  return `${score.pct}% (${CHECKLIST_BAND_LABEL[score.band ?? ""] ?? score.band})`;
}
