// Research Quality Review v1: the deterministic rules (brief sections 3 and 5). Everything here is
// pure and authoritative: criterion applicability, reference selection, quote verification,
// observation identity and the validation every model answer passes before it is published.
// A model may suggest; only this code decides which criteria apply, which references may be
// cited, which quotes are real and which observation a judgement belongs to.
import { createHash } from "node:crypto";
import criteriaRelease from "../research-quality/criteria/RQC-3.json";
import productionReferences from "../research-quality/references/RQR-1.json";
import syntheticReferences from "../research-quality/references/RQR-T1.json";
import {
  CRITERION_SCORES,
  SCORE_LABEL,
  DOCUMENTATION_STATES,
  FACT_TOPICS,
  FITNESS_STATES,
  METHODOLOGY_STATES,
  PHASES,
  PRIORITY_TIMINGS,
  SELECTION_KINDS,
  type CriterionSelection,
  type DocumentedFact,
  type ObservationPayload,
  type PriorityTiming,
  type CriterionScore,
  type ReferencePassage,
  type ReviewManifest,
  type ReviewMode,
  type Segment,
  type SourceRole,
  type StudyType,
} from "./researchQualityTypes";

// ---------------------------------------------------------------- catalogues and hashes

export type Criterion = (typeof criteriaRelease.criteria)[number];
type ReferenceEntry = (typeof syntheticReferences.entries)[number] | (typeof productionReferences.entries)[number];

/** Canonical JSON (sorted keys) so a hash does not depend on key order. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
export const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

// `criteria` keeps retired entries so reviews made under an earlier release still show their
// questions and groups; selectCriteria never offers a retired criterion to a new review.
export const CRITERIA = { release: criteriaRelease.release, hash: sha256(canonicalJson(criteriaRelease)), criteria: criteriaRelease.criteria };
const isRetired = (c: Criterion) => typeof (c as { retired?: unknown }).retired === "string";

/**
 * The reference catalogue in force. Production unless RESEARCH_QUALITY_REFERENCE_CATALOGUE is
 * "synthetic-test", which only the acceptance fixtures set; every review records which one it used,
 * and a synthetic one is labelled as such wherever it is shown.
 */
export function referenceCatalogue() {
  const synthetic = process.env.RESEARCH_QUALITY_REFERENCE_CATALOGUE === "synthetic-test";
  const data = synthetic ? syntheticReferences : productionReferences;
  return { release: data.release, kind: (synthetic ? "synthetic_test" : "production") as "synthetic_test" | "production", hash: sha256(canonicalJson(data)), entries: data.entries as ReferenceEntry[] };
}
const APPROVED = new Set(["approved", "approved_synthetic_test"]);

// ---------------------------------------------------------------- criterion applicability

/**
 * Which criteria a review assesses, decided only from confirmed context: mode, study type and the
 * roles of the selected material. Missing evidence never excludes the criterion that would report
 * the gap: design criteria stay selected in review mode even with no methodology document, so the
 * absence is reported. A planned study with only a brief has no design yet, so design criteria are
 * excluded as "not yet available", which says the document is absent, not that conduct was poor.
 * Brief criteria apply to a brief and proposal criteria to a proposal; the proposal criteria marked
 * "brief_if_present" compare with the brief when one is selected and are assessed on their own
 * otherwise, and the selection reason says which.
 * An unclear study type keeps general criteria and leaves strand-specific ones unresolved.
 */
export function selectCriteria(mode: ReviewMode, studyType: StudyType, roles: SourceRole[], sourceCount: number): CriterionSelection[] {
  const has = (r: SourceRole) => roles.includes(r);
  const documentedDesign = has("methodology") || has("report");
  const instrument = has("questionnaire") || has("discussion_guide");
  return CRITERIA.criteria.filter((c) => !isRetired(c)).map((c) => {
    const base = { criterionId: c.criterionId, version: c.version };
    const sel = (status: CriterionSelection["status"], reason: string) => ({ ...base, status, reason });
    if (!c.applicability.modes.includes(mode)) return sel("excluded", `applies only when reviewing a documented study`);
    switch (c.applicability.ruleId) {
      case "any-material":
        return sel("selected", "applies to every review");
      case "brief-present":
        return has("brief") ? sel("selected", "a brief is selected") : sel("excluded", "no brief selected; added when one is");
      case "proposal-present":
        if (!has("proposal")) return sel("excluded", "no proposal selected; added when one is");
        if ((c as { comparison?: string }).comparison === "brief_if_present") {
          return sel("selected", has("brief") ? "a proposal is selected; compared with the selected brief" : "a proposal is selected; no brief, so assessed on its own");
        }
        return sel("selected", "a proposal is selected");
      case "documented-design":
      case "documented-design-or-fieldwork":
        if (documentedDesign || (c.applicability.ruleId === "documented-design-or-fieldwork" && has("fieldwork"))) return sel("selected", "a methodology, report or fieldwork document is selected");
        return mode === "review_documented"
          ? sel("selected", "reviewing a documented study: the design must be documented somewhere, so its absence is assessed")
          : sel("excluded", has("proposal") ? "a planned study's design is assessed under the proposal criteria" : "no plan or methodology document yet (planned study); added when one is provided");
      case "instrument-present":
        return instrument ? sel("selected", "a questionnaire or guide is selected") : sel("excluded", "no questionnaire or guide selected; added when one is");
      case "two-or-more-sources":
        return sourceCount >= 2 ? sel("selected", "two or more documents to compare") : sel("excluded", "only one document: nothing to compare");
      case "plan-and-execution":
        return (has("proposal") || has("brief")) && (has("report") || has("fieldwork") || has("methodology"))
          ? sel("selected", "both a plan and an account of what was done are selected")
          : sel("excluded", "needs both a plan and an account of what was done");
      case "qualitative-strand":
        if (studyType === "unclear") return sel("unresolved", "study type is unclear: confirm whether there is a qualitative strand");
        return studyType === "qualitative" || studyType === "mixed" ? sel("selected", "qualitative strand confirmed") : sel("excluded", "no qualitative strand");
      case "mixed-strands":
        if (studyType === "unclear") return sel("unresolved", "study type is unclear: confirm whether the study is mixed methods");
        return studyType === "mixed" ? sel("selected", "mixed methods confirmed") : sel("excluded", "not mixed methods");
      default:
        return sel("unresolved", `no applicability rule ${c.applicability.ruleId}`);
    }
  });
}

/** The criteria grouped into the assessment tasks the review runs (one model call per group). */
export function assessmentGroups(selected: CriterionSelection[]): { group: string; criteria: Criterion[] }[] {
  const chosen = new Set(selected.filter((s) => s.status === "selected").map((s) => s.criterionId));
  const groups = new Map<string, Criterion[]>();
  for (const c of CRITERIA.criteria) {
    if (!chosen.has(c.criterionId)) continue;
    groups.set(c.group, [...(groups.get(c.group) ?? []), c]);
  }
  return [...groups].map(([group, criteria]) => ({ group, criteria }));
}

// ---------------------------------------------------------------- reference selection

/**
 * Approved passages a criterion may cite, chosen by criterion, study type and documented selection.
 * A passage restricted to a design (for example probability-sample precision) is offered only when
 * some documented fact reports that design. Allowlisted is necessary, not sufficient: citations are
 * re-checked against the cited facts in validateObservation.
 */
export function referencePassagesFor(criterionIds: string[], studyType: StudyType, facts: DocumentedFact[]): ReferencePassage[] {
  const cat = referenceCatalogue();
  const out: ReferencePassage[] = [];
  for (const e of cat.entries) {
    if (!APPROVED.has(e.status)) continue;
    const app = e.applicability as { studyTypes: string[]; criteria: string[]; designs?: string[] };
    if (!app.studyTypes.includes(studyType)) continue;
    if (!app.criteria.some((c) => criterionIds.includes(c))) continue;
    if (app.designs && !facts.some((f) => app.designs!.includes(f.selection))) continue;
    if (!(e.permissions as { sendToModel: boolean }).sendToModel) continue;
    for (const p of e.passages as { passageId: string; text: string }[]) {
      out.push({ referenceId: e.referenceId, version: e.version, passageId: p.passageId, text: p.text, title: e.title, release: cat.release, synthetic: cat.kind === "synthetic_test" });
    }
  }
  return out;
}

// ---------------------------------------------------------------- text, segments and quotes

/** Normalised text every locator refers to: CRLF to LF, no NUL, trailing spaces trimmed per line. */
export function canonicalText(raw: string): string {
  return raw.replace(/\r\n?/g, "\n").replace(/\u0000/g, "").replace(/[ \t]+\n/g, "\n").trim();
}

/** Page segments when real pages exist, otherwise paragraph segments. Offsets are into the joined text. */
export function buildSegments(pages: { pageNumber: number; text: string }[] | null, text: string): { text: string; segments: Segment[] } {
  if (pages && pages.length > 0) {
    let joined = "";
    const segments: Segment[] = [];
    for (const p of pages) {
      const t = canonicalText(p.text);
      if (joined) joined += "\n\n";
      const start = joined.length;
      joined += t;
      segments.push({ id: `p${p.pageNumber}`, kind: "page", page: p.pageNumber, start, end: joined.length });
    }
    return { text: joined, segments };
  }
  const t = canonicalText(text);
  const segments: Segment[] = [];
  const re = /[^\n]+(?:\n(?!\n)[^\n]*)*/g;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(t))) segments.push({ id: `s${++n}`, kind: "paragraph", page: null, start: m.index, end: m.index + m[0].length });
  return { text: t, segments };
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Finds `quote` inside text[range] (whitespace-insensitive, exact otherwise) and returns its
 * offsets in the canonical text. Null when the quote is not there: an invented or altered quote is
 * never published.
 */
export function locateQuote(text: string, quote: string, range: { start: number; end: number }, segments: Segment[]): DocumentedFact["locator"] | null {
  const q = squash(quote);
  if (q.length < 8) return null;
  // Map squashed offsets back to original offsets.
  const slice = text.slice(range.start, range.end);
  const map: number[] = [];
  let squashed = "";
  let prevSpace = true;
  for (let i = 0; i < slice.length; i++) {
    const ch = slice[i];
    if (/\s/.test(ch)) {
      if (!prevSpace) {
        squashed += " ";
        map.push(i);
      }
      prevSpace = true;
    } else {
      squashed += ch;
      map.push(i);
      prevSpace = false;
    }
  }
  const at = squashed.indexOf(q);
  if (at < 0) return null;
  const start = range.start + map[at];
  const end = range.start + map[at + q.length - 1] + 1;
  const seg = segments.find((s) => start >= s.start && start < s.end) ?? segments[segments.length - 1];
  return { start, end, segmentId: seg?.id ?? "s0", page: seg?.page ?? null };
}

/** Assessed ranges for a document under the per-document limit, in chunks of `chunk` characters. */
export function chunkRanges(charCount: number, maxChars: number, chunk = 20_000): { start: number; end: number }[] {
  const limit = Math.min(charCount, maxChars);
  const out: { start: number; end: number }[] = [];
  for (let s = 0; s < limit; s += chunk) out.push({ start: s, end: Math.min(limit, s + chunk) });
  return out;
}

// ---------------------------------------------------------------- extraction validation

/**
 * Repairs the one structural slip the model makes with long answers: returning a list field as a
 * JSON-encoded string instead of a list (observed with the live model on 2026-10-18, where every
 * extraction of a real brief was refused). Only that exact case is repaired, and only when the
 * string parses to a list; anything else is left as it is for validation to refuse. No content is
 * invented or defaulted.
 */
export function normaliseToolAnswer(raw: unknown, listKey: string): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const obj = { ...(raw as Record<string, unknown>) };
  const v = obj[listKey];
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed)) obj[listKey] = parsed;
    } catch {
      /* left as a string: validation refuses it and says so */
    }
  }
  return obj;
}

/** Names what an unusable answer contained (field types only, never content), so the failure shown to the researcher and kept in the task record is diagnosable. */
export function describeShape(raw: unknown, keys: string[]): string {
  if (raw === null || typeof raw !== "object") return `received ${raw === null ? "nothing" : typeof raw}`;
  const r = raw as Record<string, unknown>;
  const kind = (v: unknown) => (v === undefined ? "missing" : Array.isArray(v) ? "list" : v === null ? "null" : typeof v);
  return keys.map((k) => `${k}: ${kind(r[k])}`).join(", ");
}

export type ExtractedFactInput = { topic: unknown; phase: unknown; selection?: unknown; statement: unknown; exact_quote: unknown };

/** Validates one extraction answer: enums, sizes and quotes. Unverifiable quotes are dropped and counted. */
export function validateExtraction(
  raw: unknown,
  ctx: { text: string; range: { start: number; end: number }; segments: Segment[]; sourceId: string; sourceVersionId: string },
): { facts: Omit<DocumentedFact, "factId">[]; dropped: number; nothingFound: boolean } {
  const r = normaliseToolAnswer(raw, "facts") as { facts?: unknown; nothing_found?: unknown } | null;
  // A non-empty fact list answers the question "was anything found?" by itself; only an empty list
  // needs the explicit flag, so a missing flag is never taken as "nothing found".
  if (r && Array.isArray(r.facts) && r.facts.length > 0 && r.nothing_found === undefined) r.nothing_found = false;
  if (!r || !Array.isArray(r.facts) || typeof r.nothing_found !== "boolean") throw new Error(`extraction answer is not in the required shape (${describeShape(r, ["facts", "nothing_found"])})`);
  if (r.facts.length === 0 && !r.nothing_found) throw new Error("extraction returned no facts without saying nothing was found");
  if (r.facts.length > 120) throw new Error("extraction returned more facts than allowed");
  const facts: Omit<DocumentedFact, "factId">[] = [];
  let dropped = 0;
  for (const f of r.facts as ExtractedFactInput[]) {
    const topic = String(f.topic);
    const phase = String(f.phase);
    const selection = String(f.selection ?? "unstated");
    if (!(FACT_TOPICS as readonly string[]).includes(topic) || !(PHASES as readonly string[]).includes(phase) || !(SELECTION_KINDS as readonly string[]).includes(selection)) {
      dropped++;
      continue;
    }
    if (typeof f.exact_quote !== "string" || typeof f.statement !== "string" || f.exact_quote.length > 1200 || f.statement.length > 600) {
      dropped++;
      continue;
    }
    const locator = locateQuote(ctx.text, f.exact_quote, ctx.range, ctx.segments);
    if (!locator) {
      dropped++;
      continue;
    }
    facts.push({
      sourceId: ctx.sourceId,
      sourceVersionId: ctx.sourceVersionId,
      topic: topic as DocumentedFact["topic"],
      phase: phase as DocumentedFact["phase"],
      selection: selection as DocumentedFact["selection"],
      statement: f.statement.trim(),
      exactQuote: ctx.text.slice(locator.start, locator.end),
      locator,
    });
  }
  return { facts, dropped, nothingFound: r.nothing_found as boolean };
}

// ---------------------------------------------------------------- observation identity

/**
 * The logical key of an observation: criterion, decision/objective target and the LOGICAL sources
 * it rests on (or "absence" plus the assessed roles). Never wording or order. A regenerated
 * judgement on the same key is a new version of the same observation; its acceptance does not carry
 * over (acceptance belongs to a version).
 */
export function observationKey(criterionId: string, decisionTexts: string[], objectiveTexts: string[], sourceIds: string[], absenceRoles: string[] | null): string {
  const target = { d: [...decisionTexts].map(squash).sort(), o: [...objectiveTexts].map(squash).sort() };
  const anchor = absenceRoles ? { absence: [...absenceRoles].sort() } : { sources: [...new Set(sourceIds)].sort() };
  return `${criterionId}:${sha256(canonicalJson({ target, anchor })).slice(0, 24)}`;
}

// ---------------------------------------------------------------- assessment validation

// A specific sample size or count prescribed as advice. Guarded deterministically because the
// brief forbids universal sample-size prescriptions; a prescription needs a stated method.
const NUMERIC_PRESCRIPTION = /\b(at least|minimum of|increase (?:the )?sample to|sample of|n\s*[=≥>]\s*)\s*\d{2,}|\b\d{2,}\s+(?:more\s+)?(?:respondents|participants|interviews|completes)\b/i;

export type RawObservation = {
  criterion_id?: unknown;
  fact_ids?: unknown;
  decision_refs?: unknown;
  objective_refs?: unknown;
  clarification_refs?: unknown;
  documentation?: unknown;
  methodology?: unknown;
  decision_fitness?: unknown;
  reasoning?: unknown;
  uncertainty?: unknown;
  implication?: unknown;
  improvement?: unknown;
  reference_passages?: unknown;
  clarification_questions?: unknown;
  basis?: unknown;
  score?: unknown;
  score_reason?: unknown;
};

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const strList = (v: unknown, max: number, n: number) => (Array.isArray(v) ? v.filter((x) => typeof x === "string").map((x) => (x as string).trim().slice(0, max)).filter(Boolean).slice(0, n) : []);
const intList = (v: unknown, below: number) => (Array.isArray(v) ? [...new Set(v.filter((x) => Number.isInteger(x) && (x as number) >= 0 && (x as number) < below) as number[])] : []);

/**
 * Validates one generated observation against the frozen manifest and the task's allowed criteria
 * and passages. Throws on anything that would make it unverifiable (unknown criterion, unknown fact,
 * bad enum): the task then fails and is retried. Applies the deterministic guards, recording each in
 * validationNotes:
 *   - absence of documentation can only yield methodology "cannot_assess", never "concern";
 *   - "not documented" needs complete coverage of the relevant sources, else the absence scope is
 *     "partial" ("not found in the assessed passages");
 *   - a cited reference passage must be allowed for the criterion and applicable to the cited facts
 *     (a probability-sample passage cannot support a claim about an opt-in sample);
 *   - a numerical prescription (sample sizes and the like) is withheld as needing a specialist.
 */
export function validateObservation(
  raw: RawObservation,
  ctx: {
    criteria: Criterion[];
    facts: DocumentedFact[];
    manifest: Pick<ReviewManifest, "decisions" | "objectives" | "clarifications" | "sources">;
    passages: ReferencePassage[];
    coverageComplete: boolean;
    briefPresent?: boolean;
  },
): ObservationPayload {
  const criterion = ctx.criteria.find((c) => c.criterionId === raw.criterion_id);
  if (!criterion) throw new Error(`observation names a criterion outside this task: ${String(raw.criterion_id)}`);
  const notes: string[] = [];
  const factIds = Array.isArray(raw.fact_ids) ? (raw.fact_ids as unknown[]).map(String) : [];
  const cited = factIds.map((id) => {
    const f = ctx.facts.find((x) => x.factId === id);
    if (!f) throw new Error(`observation cites an unknown fact ${id}`);
    return f;
  });
  let documentation = String(raw.documentation) as ObservationPayload["assessment"]["documentation"];
  let methodology = String(raw.methodology) as ObservationPayload["assessment"]["methodology"];
  if (!(DOCUMENTATION_STATES as readonly string[]).includes(documentation)) throw new Error(`invalid documentation state ${documentation}`);
  if (!(METHODOLOGY_STATES as readonly string[]).includes(methodology)) throw new Error(`invalid methodology state ${methodology}`);
  const basis = cited.length > 0 ? "documented_facts" : "absence_in_assessed_scope";
  if (basis === "documented_facts" && documentation === "not_documented") {
    documentation = "partial";
    notes.push("Facts were cited, so 'not documented' was recorded as 'partial'.");
  }
  if (basis === "absence_in_assessed_scope" && (documentation === "documented" || documentation === "partial" || documentation === "conflicting")) {
    throw new Error("observation claims documented content without citing any fact");
  }
  if ((documentation === "not_documented" || documentation === "unavailable") && methodology === "concern") {
    methodology = "cannot_assess";
    notes.push("Missing documentation is not evidence of a poor method: methodology recorded as 'cannot assess'.");
  }
  const decisionRefs = intList(raw.decision_refs, ctx.manifest.decisions.length);
  const objectiveRefs = intList(raw.objective_refs, ctx.manifest.objectives.length);
  const fitnessRaw = Array.isArray(raw.decision_fitness) ? (raw.decision_fitness as { decision_ref?: unknown; state?: unknown; reasoning?: unknown }[]) : [];
  const decisionFitness = fitnessRaw.slice(0, 10).map((d) => {
    const state = String(d.state);
    if (!(FITNESS_STATES as readonly string[]).includes(state)) throw new Error(`invalid decision fitness ${state}`);
    const ref = Number.isInteger(d.decision_ref) && (d.decision_ref as number) >= 0 && (d.decision_ref as number) < ctx.manifest.decisions.length ? (d.decision_ref as number) : null;
    return { decisionRef: ref, state: state as ObservationPayload["assessment"]["decisionFitness"][number]["state"], reasoning: str(d.reasoning, 1200) };
  });
  const clarificationRefs = strList(raw.clarification_refs, 64, 20).filter((id) => ctx.manifest.clarifications.some((c) => c.entryId === id));

  // References: allowed for this criterion AND applicable to what the cited facts say.
  const reqRefs = Array.isArray(raw.reference_passages) ? (raw.reference_passages as { reference_id?: unknown; passage_id?: unknown }[]) : [];
  const refs: ObservationPayload["methodologicalReferenceRefs"] = [];
  for (const r of reqRefs.slice(0, 6)) {
    const p = ctx.passages.find((x) => x.referenceId === r.reference_id && x.passageId === r.passage_id);
    if (!p) {
      notes.push(`Reference ${String(r.reference_id)}:${String(r.passage_id)} is not an approved passage for this criterion and was not used.`);
      continue;
    }
    if (p.referenceId === "REF-PRECISION" && cited.some((f) => f.selection === "non_probability" || f.selection === "purposive")) {
      notes.push(`Reference ${p.referenceId}:${p.passageId} applies to probability samples, but the cited material describes a non-probability selection; not used.`);
      continue;
    }
    refs.push({ referenceId: p.referenceId, version: p.version, passageId: p.passageId });
  }

  let improvement: ObservationPayload["improvement"] = null;
  let referenceSupportStatus: ObservationPayload["referenceSupportStatus"] = "not_applicable";
  const imp = raw.improvement as { current_action?: unknown; future_action?: unknown; timing?: unknown; rationale?: unknown; constraints?: unknown; unresolved_questions?: unknown } | null | undefined;
  if (imp && (str(imp.current_action, 1500) || str(imp.future_action, 1500))) {
    const timing = String(imp.timing);
    if (!(PRIORITY_TIMINGS as readonly string[]).includes(timing)) throw new Error(`invalid improvement timing ${timing}`);
    improvement = {
      currentAction: str(imp.current_action, 1500) || null,
      futureAction: str(imp.future_action, 1500) || null,
      timing: timing as PriorityTiming,
      rationale: str(imp.rationale, 1500),
      constraints: strList(imp.constraints, 400, 8),
      unresolvedQuestions: strList(imp.unresolved_questions, 400, 8),
    };
    referenceSupportStatus = refs.length > 0 ? "reference_supported" : "insufficient_reference_support";
    const text = `${improvement.currentAction ?? ""} ${improvement.futureAction ?? ""}`;
    if (NUMERIC_PRESCRIPTION.test(text)) {
      referenceSupportStatus = "specialist_assessment_required";
      improvement = { ...improvement, currentAction: improvement.currentAction && NUMERIC_PRESCRIPTION.test(improvement.currentAction) ? null : improvement.currentAction, futureAction: improvement.futureAction && NUMERIC_PRESCRIPTION.test(improvement.futureAction) ? null : improvement.futureAction };
      notes.push("A numerical prescription (such as a sample size) was withheld: it needs a stated method, purpose and assumptions, so it is marked for specialist assessment.");
      if (!improvement.currentAction && !improvement.futureAction) improvement.unresolvedQuestions = [...improvement.unresolvedQuestions, "What precision or purpose should a specialist size the next study for?"];
    }
  }

  // Score: the model proposes one of 0/1/3/5; code keeps it consistent with what was documented.
  //   - nothing documented means Absent (0); unreadable or unassessed material is not rated (null);
  //   - something documented is never Absent (a present but poor item is Weak);
  //   - the brief's objectives need at least three cited objectives to score above Weak.
  let score: CriterionScore | null = (CRITERION_SCORES as readonly number[]).includes(raw.score as number) ? (raw.score as CriterionScore) : null;
  if (documentation === "unavailable" || documentation === "not_assessed") score = null;
  else if (documentation === "not_documented") {
    if (score !== 0) notes.push("Nothing on this was documented, so it is scored Absent.");
    score = 0;
  } else if (score === null) {
    throw new Error(`observation for ${criterion.criterionId} has no valid score`);
  } else if (score === 0) {
    score = 1;
    notes.push("Something on this is documented, so it is scored Weak rather than Absent.");
  }
  if (criterion.criterionId === "RQ-BRIEF-OBJECTIVES" && score !== null && score > 1) {
    const objectives = new Set(cited.filter((f) => f.topic === "objective").map((f) => f.exactQuote));
    if (objectives.size < 3) {
      score = 1;
      notes.push(`Only ${objectives.size} objective(s) were cited from the brief; at least three are needed to score above Weak.`);
    }
  }
  if (score !== null && score < 5 && !improvement) notes.push("No improvement suggestion was given for a criterion that is not Strong; add one in your wording or ask for clarification.");
  const comparison = (criterion as { comparison?: string }).comparison === "brief_if_present" ? (ctx.briefPresent ? "compared_with_brief" : "standalone") : null;

  const relevantRoles = new Set(criterion.applicability.roles);
  const coverageRelevant = relevantRoles.size === 0 || ctx.manifest.sources.some((s) => s.roles.some((r) => relevantRoles.has(r)));
  return {
    criterionId: criterion.criterionId,
    criterionVersion: criterion.version,
    category: criterion.group,
    objectiveRefs,
    decisionRefs,
    provenance: "ai_judgement",
    rating: { score, label: score === null ? "Not rated" : SCORE_LABEL[score], reason: str(raw.score_reason, 1500) },
    comparison,
    basis,
    absenceScope: basis === "absence_in_assessed_scope" ? (ctx.coverageComplete && coverageRelevant ? "complete" : "partial") : null,
    statements: cited.map((f) => ({ factId: f.factId, sourceVersionId: f.sourceVersionId, exactQuote: f.exactQuote, phase: f.phase, locator: f.locator })),
    clarificationRefs,
    assessment: { documentation, methodology, decisionFitness, reasoning: str(raw.reasoning, 3000) },
    uncertainty: strList(raw.uncertainty, 500, 8),
    implication: str(raw.implication, 1500),
    improvement,
    methodologicalReferenceRefs: refs,
    referenceSupportStatus,
    clarificationQuestions: strList(raw.clarification_questions, 500, 6),
    validationNotes: notes,
  };
}

// ---------------------------------------------------------------- cost estimate

/** Estimated USD for a review, from character counts. An estimate shown before starting, not a cap. */
export function estimateReviewCost(totalChars: number, groups: number, extractCalls: number, prices = { input: 3, output: 15 }): number {
  const tokens = (chars: number) => Math.ceil(chars / 3.5);
  const extractIn = tokens(totalChars) + extractCalls * 1500;
  const extractOut = extractCalls * 3000;
  const assessIn = groups * (tokens(Math.min(totalChars, 60_000)) / 2 + 3000);
  const assessOut = groups * 3500;
  return Number((((extractIn + assessIn) / 1e6) * prices.input + ((extractOut + assessOut) / 1e6) * prices.output).toFixed(4));
}
