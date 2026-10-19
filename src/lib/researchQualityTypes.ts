// Research Quality Review v1: the module's typed contracts (brief 2026-10-16, sections 1, 3 and 5).
//
// Three assessments stay separate on every observation and are never combined into a score:
//   documentation   what the assessed material states
//   methodology     whether the documented approach suits the stated purpose
//   decisionFitness what the documented evidence can support, per decision
// "Suitable as documented" is a bounded judgement about documents, not proof of execution, and a
// researcher's acceptance means agreement, not scientific verification.

export const SOURCE_ROLES = ["brief", "proposal", "questionnaire", "discussion_guide", "methodology", "report", "fieldwork"] as const;
export type SourceRole = (typeof SOURCE_ROLES)[number];
export const ROLE_LABEL: Record<SourceRole, string> = {
  brief: "Brief",
  proposal: "Proposal or plan",
  questionnaire: "Questionnaire",
  discussion_guide: "Interview or discussion guide",
  methodology: "Methodology",
  report: "Report",
  fieldwork: "Sampling or fieldwork notes",
};

export const REVIEW_MODES = ["improve_planned", "review_documented"] as const;
export type ReviewMode = (typeof REVIEW_MODES)[number];
export const STUDY_TYPES = ["quantitative", "qualitative", "mixed", "unclear"] as const;
export type StudyType = (typeof STUDY_TYPES)[number];

export const PHASES = ["planned", "reported_executed", "unspecified"] as const;
export type Phase = (typeof PHASES)[number];

export const FACT_TOPICS = [
  "decision",
  "objective",
  "population",
  "scope",
  "deliverable",
  "constraint",
  "assumption",
  "design",
  "selection",
  "recruitment",
  "sample_size",
  "measure",
  "instrument_item",
  "fieldwork",
  "analysis",
  "weighting",
  "missing_data",
  "claim",
  "limitation",
] as const;
export type FactTopic = (typeof FACT_TOPICS)[number];

// What the material says about how participants were chosen, when it says so. "unstated" is the
// default; the extractor must not guess.
export const SELECTION_KINDS = ["probability", "non_probability", "purposive", "census", "unstated"] as const;
export type SelectionKind = (typeof SELECTION_KINDS)[number];

export const DOCUMENTATION_STATES = ["documented", "partial", "not_documented", "conflicting", "unavailable", "not_assessed"] as const;
export type DocumentationState = (typeof DOCUMENTATION_STATES)[number];
export const METHODOLOGY_STATES = ["documented_strength", "concern", "cannot_assess", "not_applicable"] as const;
export type MethodologyState = (typeof METHODOLOGY_STATES)[number];
export const FITNESS_STATES = ["suitable_as_documented", "qualified", "insufficient_basis", "not_assessed"] as const;
export type FitnessState = (typeof FITNESS_STATES)[number];
// Per-criterion score on the app's existing quality scale (qualityRubrics.ts: 1, 3, 5) plus 0 for
// "absent". Each criterion is scored on its own; scores are never added up into one figure.
export const CRITERION_SCORES = [0, 1, 3, 5] as const;
export type CriterionScore = (typeof CRITERION_SCORES)[number];
export const SCORE_LABEL: Record<CriterionScore, string> = { 5: "Strong", 3: "Workable", 1: "Weak", 0: "Absent" };
export const PRIORITY_TIMINGS = ["before_fieldwork", "before_decision", "next_study"] as const;
export type PriorityTiming = (typeof PRIORITY_TIMINGS)[number];
export const REFERENCE_SUPPORT = ["reference_supported", "insufficient_reference_support", "specialist_assessment_required", "not_applicable"] as const;
export type ReferenceSupport = (typeof REFERENCE_SUPPORT)[number];

export type Segment = { id: string; kind: "page" | "paragraph"; page: number | null; start: number; end: number };

/** A documented fact: a verified exact quote from one pinned source version. */
export type DocumentedFact = {
  factId: string; // "F<n>" within one review, assigned by code after quote verification
  sourceId: string;
  sourceVersionId: string;
  topic: FactTopic;
  phase: Phase;
  selection: SelectionKind;
  statement: string; // the extractor's short paraphrase, labelled as such
  exactQuote: string;
  locator: { start: number; end: number; segmentId: string; page: number | null };
};

export type ReviewDecision = { decisionId: string | null; text: string };
export type ReviewObjective = { objectiveId: string | null; text: string };

export type CriterionSelection = { criterionId: string; version: number; status: "selected" | "excluded" | "unresolved"; reason: string };

export type ReferencePassage = { referenceId: string; version: number; passageId: string; text: string; title: string; release: string; synthetic: boolean };

/** Frozen inputs of one review (research_quality_reviews.manifest). */
export type ReviewManifest = {
  sources: {
    sourceId: string;
    sourceVersionId: string;
    documentId: string | null;
    filename: string;
    roles: SourceRole[];
    canonicalSha256: string;
    charCount: number;
    assessedRanges: { start: number; end: number }[];
  }[];
  mode: ReviewMode;
  studyType: StudyType;
  purpose: string;
  decisions: ReviewDecision[];
  objectives: ReviewObjective[];
  clarificationIds: string[];
  clarifications: { entryId: string; text: string; actorEmail: string | null; at: string }[];
  criteria: CriterionSelection[];
  referencePassages: ReferencePassage[];
  referenceCatalogue: { release: string; kind: "production" | "synthetic_test"; hash: string };
  limits: ReviewLimits;
  /** The checklist release the documents are scored against (RQK-1 or later), or null when migration 0106 is not applied. Absent on reviews made before the checklist existed. */
  checklistRelease?: { release: string; hash: string } | null;
};

export type ReviewLimits = { maxDocuments: number; maxCharsPerDocument: number; maxCharsTotal: number; maxAttempts: number; concurrency: number };
export const DEFAULT_LIMITS: ReviewLimits = { maxDocuments: 6, maxCharsPerDocument: 40_000, maxCharsTotal: 120_000, maxAttempts: 30, concurrency: 2 };

/** One generated observation version (research_quality_observation_versions.payload). */
export type ObservationPayload = {
  criterionId: string;
  criterionVersion: number;
  category: string;
  objectiveRefs: number[]; // indexes into manifest.objectives
  decisionRefs: number[]; // indexes into manifest.decisions
  provenance: "ai_judgement" | "deterministic_check";
  basis: "documented_facts" | "absence_in_assessed_scope";
  // Code-derived: "complete" only when every relevant source was fully read; otherwise absence
  // wording must say "not found in the assessed passages".
  absenceScope: "complete" | "partial" | null;
  statements: { factId: string; sourceVersionId: string; exactQuote: string; phase: Phase; locator: DocumentedFact["locator"] }[];
  clarificationRefs: string[]; // researcher clarification entry ids the judgement relied on
  // null when the criterion could not be rated (its material was unavailable or not assessed).
  rating: { score: CriterionScore | null; label: string; reason: string };
  // For proposal criteria that compare with the brief: whether a brief was there to compare with.
  comparison: "compared_with_brief" | "standalone" | null;
  assessment: {
    documentation: DocumentationState;
    methodology: MethodologyState;
    decisionFitness: { decisionRef: number | null; state: FitnessState; reasoning: string }[];
    reasoning: string;
  };
  uncertainty: string[];
  implication: string;
  improvement: {
    currentAction: string | null;
    futureAction: string | null;
    timing: PriorityTiming;
    rationale: string;
    constraints: string[];
    unresolvedQuestions: string[];
  } | null;
  methodologicalReferenceRefs: { referenceId: string; version: number; passageId: string }[];
  referenceSupportStatus: ReferenceSupport;
  clarificationQuestions: string[];
  validationNotes: string[]; // what code changed or withheld, and why
};

export type ResearcherEntryKind = "accept" | "dismiss" | "reopen" | "comment" | "wording" | "clarification";

export class ResearchQualityError extends Error {}
/** The module's tables are missing: migration 0105 has not been applied. No write or model call happened. */
export class ResearchQualitySetupError extends ResearchQualityError {
  constructor() {
    super("Research quality review needs database migration 0105_research_quality_review.sql. Nothing was changed and no model call was made.");
  }
}
/** A save named an older revision of the observation than the current one. */
export class ResearchQualityConflictError extends ResearchQualityError {}
