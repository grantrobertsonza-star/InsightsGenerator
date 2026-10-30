// R5 segment (Grant, 30 October 2026: "we need a filter up here, so the user can filter on a segment (age, gender,
// etc.)"): the one owner that turns a tracker dashboard's segment into the Cross tab engine's filter, so every page
// and card of the brand dashboard computes its figures, bases (raw, weighted, effective), suppression and any test on
// the respondents in the segment. The contract is claude/d2-design-2026-10-29.md, "R5 Segment".
//   - A segment is one or more profile questions (single-choice questions asked once that demographicKindOf in
//     starterTables.ts recognises: gender, age, province, settlement, income, life stage and the others listed there;
//     never a question the tracker reads as a brand measure, brand list, category role or CSM role), and for each
//     question one or more of its answers by raw code. Within a question the answers are alternatives (OR); across
//     questions every condition must hold (AND).
//   - Identity is the variable name and the raw answer codes; labels are only shown. The engine selects respondents
//     by the code's own text form (filter op "codes", api/parse-stats-file.py), never by a label.
//   - A respondent with no answer to a segment question (blank or declared missing) has none of its codes, so is
//     outside the segment.
//   - Across waves (loadBrandOverview): the segment is applied in each wave compared. When the compared wave lacks a
//     segment question or a chosen code, or a code names another answer there (codeNamesDiffer, the brand funnel's
//     identity rule), that wave is not compared, with the reason; it is never compared unsegmented.
//   - A segment that cannot be applied to the open file is refused with the reason (never dropped, which would show
//     every respondent under a segment's name). A segment nobody is in is refused with the reason too; a small one
//     gets the engine's own small-base suppression on each figure.
import { computeCrosstab } from "./crosstabs";
import type { CrosstabFilter, CrosstabRequest, CrosstabResult } from "./parseStatsFile";
import { demographicKindOf } from "./starterTables";
import { codeNamesDiffer } from "./trackerFigures";
import type { RoleVariable, TrackerRecognition } from "./trackerRoles";

/** At most this many questions and answers per question: a segment is a few profile conditions, not a query. */
export const MAX_SEGMENT_QUESTIONS = 4;
export const MAX_SEGMENT_CODES = 30;

/** A segment as chosen: profile questions by variable name, each with its answers by raw code. */
export type Segment = { questions: { variable: string; codes: string[] }[] };

/** A profile question a segment can use: its answers by code, with labels for display. */
export type SegmentQuestion = { variable: string; label: string; answers: { code: string; label: string }[] };

/** A segment checked against one file: each question with the chosen answers (code and the file's label). */
export type AppliedSegment = { questions: { variable: string; label: string; answers: { code: string; label: string }[] }[]; text: string };

/**
 * What a page's figures were computed on, for the screen and for anything that records provenance from the dashboard
 * (findings, AI insights, slides): the segment's questions and codes, its text, the engine filters sent, and the
 * segment's base in this file (unweighted n, weighted total and Kish effective base when weighted; null when no
 * table was computed). Null on a page computed on all eligible respondents.
 */
export type SegmentReading = AppliedSegment & { filters: CrosstabFilter[]; n: number | null; weighted: number | null; effectiveBase: number | null };

/** The segment as sent by a screen, checked at the server boundary. Null or no question: no segment. */
export function parseSegment(raw: unknown): { ok: true; segment: Segment | null } | { ok: false; error: string } {
  const bad = { ok: false as const, error: "The segment was not understood. Choose it again." };
  if (raw === null || raw === undefined) return { ok: true, segment: null };
  if (typeof raw !== "object" || Array.isArray(raw)) return bad;
  const qs = (raw as { questions?: unknown }).questions;
  if (!Array.isArray(qs)) return bad;
  if (qs.length === 0) return { ok: true, segment: null };
  if (qs.length > MAX_SEGMENT_QUESTIONS) return { ok: false, error: `A segment can use at most ${MAX_SEGMENT_QUESTIONS} questions.` };
  const questions: Segment["questions"] = [];
  for (const q of qs) {
    if (!q || typeof q !== "object") return bad;
    const { variable, codes } = q as { variable?: unknown; codes?: unknown };
    if (typeof variable !== "string" || variable.length === 0 || variable.length > 200) return bad;
    if (!Array.isArray(codes) || codes.length === 0 || codes.length > MAX_SEGMENT_CODES || !codes.every((c) => typeof c === "string" && c.length > 0 && c.length <= 50)) return bad;
    if (questions.some((x) => x.variable === variable)) return bad;
    questions.push({ variable, codes: [...new Set(codes as string[])] });
  }
  return { ok: true, segment: { questions } };
}

/** The variables the tracker reads in a role of its own (brand measures and lists, grids, category and CSM roles). */
function trackerRoleVariables(rec: TrackerRecognition): Set<string> {
  const out = new Set<string>(rec.frame?.questions ?? []);
  for (const m of rec.measures) {
    for (const b of m.byBrand) out.add(b.variable);
    for (const v of m.outside) out.add(v);
  }
  for (const g of rec.grids) for (const it of g.items) for (const b of it.byBrand) out.add(b.variable);
  if (rec.categoryMoments.status === "found") for (const it of rec.categoryMoments.items) out.add(it.variable);
  if (rec.advertisingRecall.status === "found") for (const b of rec.advertisingRecall.byBrand) out.add(b.variable);
  if (rec.mediaUse.status === "found") for (const o of rec.mediaUse.options) out.add(o.variable);
  for (const f of [rec.decisionStyle, rec.acquisitionChannel]) if (f.status === "found") out.add(f.variable);
  const { drivers, ...singles } = rec.csm;
  for (const v of [...drivers, ...Object.values(singles)]) if (typeof v === "string") out.add(v);
  return out;
}

const codeOrder = (a: string, b: string) => Number(a) - Number(b) || a.localeCompare(b);

/**
 * The profile questions of one file a segment can use, in the recognition's order (gender, age, ...), then file
 * order: a single-choice question asked once (not in a question set or a brand grid, not text, not a weight), with
 * an answer list of 2 to 15 answers, that demographicKindOf recognises, and that the tracker does not read in a role
 * of its own. The age groups question of page 05 is a profile question and is included. Pure.
 */
export function segmentQuestionsOf(variables: RoleVariable[], rec: TrackerRecognition): SegmentQuestion[] {
  const roles = trackerRoleVariables(rec);
  const found: { q: SegmentQuestion; kind: number; at: number }[] = [];
  variables.forEach((v, at) => {
    const labels = v.valueLabels ?? {};
    const codes = Object.keys(labels);
    if (codes.length < 2 || codes.length > 15) return;
    if (v.weightLike || v.text || v.group || roles.has(v.name)) return;
    if (v.questionType === "multiple_response" || v.questionType === "continuous" || v.questionType === "text") return;
    const kind = demographicKindOf(v.name, v.label);
    if (kind < 0) return;
    found.push({ q: { variable: v.name, label: v.label || v.name, answers: codes.sort(codeOrder).map((code) => ({ code, label: labels[code] })) }, kind, at });
  });
  return found.sort((a, b) => a.kind - b.kind || a.at - b.at).map((f) => f.q);
}

/** The segment's short description: each question's chosen answers joined by "or", questions joined by "; ". */
export function segmentText(questions: AppliedSegment["questions"]): string {
  return questions.map((q) => q.answers.map((a) => a.label).join(" or ")).join("; ");
}

/**
 * A segment checked against one file's profile questions: every question must be one of them and every code one of
 * its answers. Null segment: null (all eligible respondents). Otherwise the reason it cannot be applied.
 */
export function resolveSegment(segment: Segment | null, eligible: SegmentQuestion[], variables: Pick<RoleVariable, "name" | "label">[] = []): { ok: true; applied: AppliedSegment | null } | { ok: false; reason: string } {
  if (!segment || segment.questions.length === 0) return { ok: true, applied: null };
  const questions: AppliedSegment["questions"] = [];
  for (const s of segment.questions) {
    const q = eligible.find((e) => e.variable === s.variable);
    if (!q) {
      const v = variables.find((x) => x.name === s.variable);
      return { ok: false, reason: v ? `${v.label || v.name} (${v.name}) is not a profile question with an answer list in this file, so it cannot define a segment.` : `The segment question ${s.variable} is not in this file.` };
    }
    const answers: { code: string; label: string }[] = [];
    for (const code of s.codes) {
      const a = q.answers.find((x) => x.code === code);
      if (!a) return { ok: false, reason: `Answer code ${code} is not in the answer list of ${q.label} (${q.variable}) in this file.` };
      answers.push(a);
    }
    questions.push({ variable: q.variable, label: q.label, answers: answers.sort((a, b) => codeOrder(a.code, b.code)) });
  }
  return { ok: true, applied: { questions, text: segmentText(questions) } };
}

/** The segment for a page of the open file: checked against its profile questions; throws with the reason when it
 * cannot be applied (never dropped). */
export function applySegment(segment: Segment | null, variables: RoleVariable[], rec: TrackerRecognition): AppliedSegment | null {
  const r = resolveSegment(segment, segmentQuestionsOf(variables, rec), variables);
  if (!r.ok) throw new Error(`The segment cannot be applied to this file: ${r.reason} Change or clear the segment.`);
  return r.applied;
}

/** A segment checked against a file (labels attached) or as chosen (codes only): either names the same respondents. */
type SegmentCodes = Segment | AppliedSegment;
const codesOf = (q: SegmentCodes["questions"][number]): string[] => ("codes" in q ? q.codes : q.answers.map((a) => a.code));

/** The segment by codes only, the shape the distribution, NPS and driver tools take (R5 CSM segment). */
export function segmentOf(applied: AppliedSegment): Segment {
  return { questions: applied.questions.map((q) => ({ variable: q.variable, codes: q.answers.map((a) => a.code) })) };
}

/**
 * The engine filters of a segment: one raw-code filter per question (OR within its codes); filters AND together. The
 * only place a segment becomes engine filters: tracker page loaders (withSegment / computeInSegment) and the
 * distribution, NPS and driver tools (R5 CSM segment) all take their filters from here.
 */
export function segmentFilters(segment: SegmentCodes | null): CrosstabFilter[] {
  return (segment?.questions ?? []).map((q) => ({ variable: q.variable, op: "codes", codes: codesOf(q) }));
}

/** A Cross tab request restricted to the segment: the request's own filters, then the segment's. Every tracker page
 * loader and the distribution and NPS tools send their requests through this, so none builds a segment filter of its
 * own. */
export function withSegment(request: CrosstabRequest, segment: SegmentCodes | null): CrosstabRequest {
  if (!segment || segment.questions.length === 0) return request;
  return { ...request, filters: [...(request.filters ?? []), ...segmentFilters(segment)] };
}

/**
 * A segment handed to the distribution, NPS or driver tool (R5 CSM segment), checked at the tool's boundary: the
 * segment's shape (parseSegment) and that every question is a variable of this file. Which questions may define a
 * segment (profile questions with an answer list holding each code) is the tracker loader's check (resolveSegment),
 * made before it calls a tool; the engine refuses a code nobody in the file gave ("No cases satisfy the filter").
 * Null or absent: no segment, the tool's behaviour unchanged.
 */
export function toolSegment(raw: unknown, variableNames: Iterable<string>): { ok: true; segment: Segment | null } | { ok: false; error: string } {
  const parsed = parseSegment(raw);
  if (!parsed.ok || !parsed.segment) return parsed;
  const names = new Set(variableNames);
  const missing = parsed.segment.questions.find((q) => !names.has(q.variable));
  if (missing) return { ok: false, error: `The segment question ${missing.variable} is not in this file.` };
  return parsed;
}

/** What a page was computed on, from a table computed with the segment (its total is the segment's base). */
export function segmentReading(applied: AppliedSegment | null, result: CrosstabResult | null, weighted: boolean): SegmentReading | null {
  if (!applied) return null;
  const t = result?.total ?? null;
  return { ...applied, filters: segmentFilters(applied), n: t ? t.n : null, weighted: t && weighted ? t.w : null, effectiveBase: t && weighted ? t.nEff : null };
}

/**
 * Whether the segment applied to this wave can be applied to a compared wave: every question must be one of that
 * wave's profile questions, and every chosen code must name the same answer in both waves' answer lists
 * (codeNamesDiffer, the identity rule of brand and company codes). Null when it can; otherwise the reason the
 * comparison is withheld.
 */
export function segmentAgainstWave(applied: AppliedSegment, other: SegmentQuestion[]): string | null {
  for (const q of applied.questions) {
    const o = other.find((x) => x.variable === q.variable);
    if (!o) return `The segment question ${q.label} (${q.variable}) is not a profile question with an answer list in that wave, so the segment cannot be applied there.`;
    for (const a of q.answers) {
      const differs = codeNamesDiffer(a.code, q.answers, o.answers, `${q.label} answer`, `answer list of ${q.label}`);
      if (differs) return `${differs} The segment cannot be applied to that wave.`;
    }
  }
  return null;
}

/** The reason a computation under a segment failed: a segment nobody in the file is in is said in words. */
export function segmentFailure(e: unknown, applied: AppliedSegment | null): string {
  const m = e instanceof Error ? e.message : String(e);
  if (applied && /No cases satisfy/.test(m)) return `No respondent in this file is in the segment ${applied.text} (n=0), so no figures can be shown. Change or clear the segment.`;
  return m;
}

/**
 * One dashboard Cross tab (computeCrosstab, nothing saved) restricted to the segment (withSegment). The way every
 * tracker page loader computes its figures. A segment nobody is in fails with that reason (segmentFailure); any other
 * failure is passed on unchanged.
 */
export async function computeInSegment(tenantId: string, runId: string, documentId: string, request: CrosstabRequest, applied: AppliedSegment | null) {
  try {
    return await computeCrosstab(tenantId, runId, documentId, withSegment(request, applied));
  } catch (e) {
    const reason = segmentFailure(e, applied);
    throw reason === (e instanceof Error ? e.message : String(e)) ? e : new Error(reason);
  }
}

/**
 * The segment's own base in one file, for a dashboard whose figures come from tools rather than one table (the CSM
 * dashboard, R5 CSM segment): one table of the segment's first question computed in the segment (computeInSegment),
 * whose total is every respondent in the segment (each has an answer to every segment question): unweighted n,
 * weighted total and Kish effective base with the dashboard's weight. Null without a segment.
 */
export async function segmentBase(tenantId: string, runId: string, documentId: string, applied: AppliedSegment | null, weightVar: string | null): Promise<SegmentReading | null> {
  if (!applied) return null;
  const q = applied.questions[0];
  const { result } = await computeInSegment(tenantId, runId, documentId, { columnVars: [], rowItems: [{ key: q.variable, label: q.label, vars: [q.variable] }], weightVar }, applied);
  return segmentReading(applied, result, weightVar !== null);
}
