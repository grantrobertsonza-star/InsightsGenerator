// Research Quality Review v1: presentation rules shared by the screen and the DOCX export. Pure
// (no database, no server code), so the client component can import it.
import checklistRelease from "../research-quality/checklists/RQK-2.json";
import criteriaRelease from "../research-quality/criteria/RQC-6.json";
import type { DocumentedFact, ObservationPayload, ReviewManifest } from "./researchQualityTypes";
import type { ObservationView } from "./researchQualityView";
import type { CriterionRating, DashboardView } from "./researchQualityDashboard";

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
  "RQ-PROP-SAMPLE-SIZE": "Sample size and precision",
  "RQ-PROP-SAMPLE-METHOD": "Sampling method",
  "RQ-PROP-ANALYSIS": "Analysis plan",
  "RQ-PROP-PRODUCTS": "Deliverables",
  "RQ-PROP-TIMELINE": "Timeline",
  "RQ-PROP-BUDGET": "Budget",
  "RQ-PROP-TEAM": "Team",
  "RQ-PROP-MANAGEMENT": "Project management",
  "RQ-PROP-COMPLIANCE": "Compliance and ethics",
  "RQ-PROP-INNOVATION": "Value-add",
  "RQ-CMP-PROBLEM": "Problem restated",
  "RQ-CMP-OBJECTIVES": "Objectives covered",
  "RQ-CMP-AUDIENCE": "Audience matches",
  "RQ-CMP-METHOD": "Method guidance respected",
  "RQ-CMP-DELIVERABLES": "Deliverables match",
  "RQ-CMP-TIMING": "Meets the deadline",
  "RQ-CMP-BUDGET": "Within budget",
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

// ---------------------------------------------------------------- review steps

const CHECKLIST_LABEL = new Map(checklistRelease.checklists.map((c) => [c.checklistId, c.label]));

/**
 * A review step in plain words, for the status box (Grant, 2026-10-20: "extract:00:03" meant
 * nothing on screen). Read from the task key the review writes (researchQualityReview.ts):
 * extract:<source>:<part>, assess:<group>, checklist:<source>:<checklistId>, with zero-padded
 * indexes into the frozen manifest. The document is named only when the review has more than one.
 * A key in a shape this does not know, or pointing outside the manifest, is shown as it is, so an
 * unexpected step stays visible rather than being given a wrong name.
 */
export function reviewStepLabel(key: string, manifest: Pick<ReviewManifest, "sources">): string {
  const [stage, a, b] = key.split(":");
  const source = a !== undefined && /^\d+$/.test(a) ? manifest.sources[Number(a)] : undefined;
  const ofDoc = source && manifest.sources.length > 1 ? ` (${source.filename})` : "";
  if (stage === "extract" && source && b !== undefined && /^\d+$/.test(b)) {
    const parts = source.assessedRanges.length;
    const part = Number(b) + 1;
    return parts > 1 ? `Reading part ${part} of ${parts}${ofDoc}` : `Reading the document${ofDoc}`;
  }
  if (stage === "assess" && a && GROUP_LABEL[a]) return `Rating ${GROUP_LABEL[a]}`;
  if (stage === "checklist" && source && b) return `Scoring the ${CHECKLIST_LABEL.get(b) ?? b} checklist${ofDoc}`;
  return key;
}

type StepRow = { key: string; status: string };
/**
 * The failed steps to list under a review. The stored step list is written when a run settles, so
 * while a retry is running it still holds the last run's failures (Grant, 2026-10-20: old
 * connection errors showed beside "Retrying the failed steps only"). They are listed only once the
 * run has settled, or when it was interrupted and is waiting for Continue; while it runs, the live
 * count of this run's failures is shown instead.
 */
export function shownFailedSteps<T extends StepRow>(r: { state: string; progress: { interrupted?: boolean }; coverage: { tasks?: T[] } }): T[] {
  const running = (r.state === "pending" || r.state === "running") && !r.progress.interrupted;
  return running ? [] : (r.coverage.tasks ?? []).filter((t) => t.status === "failed");
}

// ---------------------------------------------------------------- the Overview's status filter

/** One criterion of a review, with the dimension (or category) it sits in and its status. */
export type CriterionRow = { criterionId: string; dimensionId: string; dimensionLabel: string; score: number | null; status: string };

/** A criterion's status as the dashboard shows it: the rating's own label once rated, otherwise Not rated, Pending or Failed. */
export const criterionStatus = (c: Pick<CriterionRating, "state" | "label">) => (c.state === "rated" ? c.label : CRITERION_STATE_LABEL[c.state] ?? c.state);
const CRITERION_STATE_LABEL: Record<string, string> = { not_rated: "Not rated", pending: "Pending", failed: "Failed" };

/**
 * Every criterion of a review's dashboards, in dashboard order, each with its status (criterionStatus).
 * A criterion on two dashboards is listed once, under the first. It gives the Overview filter its
 * choices (since 2026-10-22 the filter lives on the Overview; the Criteria tab was removed).
 */
export function criterionRows(dashboards: DashboardView[]): CriterionRow[] {
  const seen = new Set<string>();
  const rows: CriterionRow[] = [];
  for (const d of dashboards)
    for (const x of d.dimensions)
      for (const c of x.criteria) {
        if (seen.has(c.criterionId)) continue;
        seen.add(c.criterionId);
        rows.push({
          criterionId: c.criterionId,
          dimensionId: x.dimensionId,
          dimensionLabel: x.categoryLabel ?? criterionShortLabel(x.dimensionId),
          score: c.score,
          status: criterionStatus(c),
        });
      }
  return rows;
}

// The filter's order: the rating bands from best to worst, then the states without a rating.
const STATUS_ORDER = ["Strong", "Workable", "Weak", "Absent", "Not rated", "Pending", "Failed"];

/** The statuses present, in STATUS_ORDER (an unknown one last), for the Overview's "Show" filter. */
export function statusChoices(statuses: string[]): string[] {
  const rank = (s: string) => (STATUS_ORDER.indexOf(s) === -1 ? STATUS_ORDER.length : STATUS_ORDER.indexOf(s));
  return [...new Set(statuses)].sort((a, b) => rank(a) - rank(b));
}

/**
 * The Overview's dimensions with the "Show" filter applied (Grant, 2026-10-22): each dimension with
 * the criteria of that status, a dimension none of whose criteria has it left out. The dimension
 * itself (a category's heading, bar and score) is kept unchanged beside its matching criteria, so
 * the researcher sees where each sits; "all" keeps everything.
 */
export function filterDimensionsByStatus(d: DashboardView, status: string): { dimension: DashboardView["dimensions"][number]; criteria: CriterionRating[] }[] {
  return d.dimensions
    .map((x) => ({ dimension: x, criteria: status === "all" ? x.criteria : x.criteria.filter((c) => criterionStatus(c) === status) }))
    .filter((v) => status === "all" || v.criteria.length > 0);
}

/** A criterion's rating as the screen shows it: from the dashboard once rated there, else its observation's own. */
export function criterionRating(dashboards: DashboardView[], observations: ObservationView[], criterionId: string): { score: number | null; label: string } {
  const rated = dashboards.flatMap((d) => d.dimensions.flatMap((x) => x.criteria)).find((c) => c.criterionId === criterionId);
  const first = observations.find((o) => o.criterionId === criterionId && o.status !== "dismissed");
  return { score: rated?.score ?? first?.payload.rating?.score ?? null, label: rated?.label ?? first?.payload.rating?.label ?? "Not rated" };
}
