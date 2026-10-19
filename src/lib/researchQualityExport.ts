// Research Quality Review v1: the review DOCX (brief section 8). Built only from the shared view
// model (researchQualityView), with no model call, so it says exactly what the screen says:
// assessed scope and versions, the three separate dimensions, project citations with locators,
// methodological citations with permitted excerpts, planned versus reported-executed statements,
// uncertainty, the improvement plan, clarifications and researcher decisions and wording. Stale,
// unknown and partial states are labelled in the text. Dismissed observations leave the
// improvement plan and are listed, with the dismissal, in an appendix.
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { safeFileStem } from "./docxReport";
import { ROLE_LABEL, type ObservationPayload } from "./researchQualityTypes";
import {
  DOC_LABEL,
  FITNESS_LABEL,
  METHOD_LABEL,
  SUPPORT_LABEL,
  documentationLabel,
  improvementsByTiming,
  overview,
  shownImplication,
  scorecard,
  comparisonLabel,
  CHECKLIST_STATUS_LABEL,
  checklistScoreText,
  criterionShortLabel,
} from "./researchQualityPresentation";
const DASHBOARD_BAND_LABEL: Record<string, string> = { strong: "Strong", workable: "Workable", weak: "Weak" };
import type { ObservationView, ResearchQualityView } from "./researchQualityView";

const p = (text: string, opts: { bold?: boolean; italics?: boolean; size?: number } = {}) => new Paragraph({ children: [new TextRun({ text, ...opts })] });
const h = (text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel]) => new Paragraph({ text, heading: level });
const bullet = (text: string) => new Paragraph({ text, bullet: { level: 0 } });

function locator(o: ObservationPayload["statements"][number], filename: string): string {
  const where = o.locator.page ? `page ${o.locator.page}` : `paragraph ${o.locator.segmentId.replace(/^s/, "")}`;
  return `${filename}, ${where}, characters ${o.locator.start}-${o.locator.end}`;
}

function qualifiers(o: ObservationView): string[] {
  const out: string[] = [];
  if (o.freshness === "requires_review") out.push(`REQUIRES REVIEW: ${o.freshnessReason}`);
  if (o.freshness === "could_not_check") out.push("FRESHNESS UNKNOWN: whether its sources changed could not be checked.");
  if (o.status === "awaiting_review") out.push(o.previous ? `UPDATE AWAITING REVIEW (an earlier version from review ${o.previous.reviewSequence} was ${o.previous.status.replace("_", " ")})` : "Awaiting researcher review");
  return out;
}

export async function buildResearchQualityDocx(view: ResearchQualityView, projectName: string | null): Promise<{ buffer: Buffer; filename: string }> {
  const r = view.review;
  if (!r) throw new Error("There is no review to export yet.");
  const sourceName = (versionId: string) => r.manifest.sources.find((s) => s.sourceVersionId === versionId)?.filename ?? "unknown source";
  const ov = overview(r.observations);
  const body: Paragraph[] = [];
  body.push(h(`Research quality review ${r.sequence}${projectName ? `: ${projectName}` : ""}`, HeadingLevel.TITLE));
  body.push(p(`State: ${r.state}${r.state !== "complete" ? " (not every part was assessed; see Scope)" : ""}. Created ${r.createdAt.slice(0, 16).replace("T", " ")} UTC by ${r.createdBy ?? "single user"}.`));
  body.push(p(`Mode: ${r.mode === "improve_planned" ? "improve a planned study" : "review a documented study"}. Study type: ${r.studyType}. Purpose: ${r.purpose || "not stated"}.`));
  body.push(p(`Criteria library ${r.criteriaRelease}; reference catalogue ${r.referencesRelease}${r.syntheticReferences ? " (SYNTHETIC TEST REFERENCES, NOT METHODOLOGICAL STANDARDS)" : ""}; model ${r.model}; prompts ${r.promptVersion}.`));
  body.push(p("These are AI judgements about documents, validated by code and reviewed by a researcher. Scores are a guide to where to look, not a certification or proof that work was carried out. An accepted observation means researcher agreement, not scientific verification.", { italics: true }));

  body.push(h("Scope", HeadingLevel.HEADING_1));
  for (const s of r.manifest.sources) {
    const fresh = r.sourceFreshness.find((f) => f.sourceId === s.sourceId);
    const read = s.assessedRanges.reduce((n, x) => n + (x.end - x.start), 0);
    body.push(bullet(`${s.filename} (${s.roles.map((x) => ROLE_LABEL[x]).join(", ")}): ${read < s.charCount ? `first ${read.toLocaleString("en-GB")} of ${s.charCount.toLocaleString("en-GB")} characters assessed (partial)` : "read in full"}. ${fresh ? fresh.detail : ""}`));
  }
  for (const c of r.manifest.criteria.filter((c) => c.status !== "selected")) body.push(bullet(`${c.criterionId} ${c.status}: ${c.reason}`));
  for (const t of r.coverage.tasks ?? []) if (t.status !== "succeeded") body.push(bullet(`Step ${t.key} ${t.status}${t.error ? `: ${t.error}` : ""}`));
  if (r.newClarifications > 0) body.push(p(`${r.newClarifications} researcher clarification(s) were added after this review and are not reflected in it.`, { bold: true }));

  body.push(h("Overview", HeadingLevel.HEADING_1));
  body.push(p(`${ov.strengths.length} documented strength(s), ${ov.concerns.length} concern(s), ${ov.gaps.length} documentation gap(s), ${ov.decisionImplications.length} with decision implications. ${ov.awaitingReview} awaiting review; ${ov.requiresReview} need review because a source changed or could not be checked.`));

  // The bird's-eye dashboard (RQC-3 brief dimensions): the same figures as the screen's Overview.
  if (r.dashboards.length > 0 || r.dashboardNote) body.push(h("Dashboard", HeadingLevel.HEADING_1));
  if (r.dashboardNote) body.push(p(r.dashboardNote));
  for (const d of r.dashboards) {
    body.push(h(`${d.label}: ${d.pct === null ? `no overall score (only ${d.ratedWeight} of ${d.totalWeight} weight rated)` : `${d.pct}% (${DASHBOARD_BAND_LABEL[d.band!]})`}`, HeadingLevel.HEADING_2));
    body.push(p(`Each dimension is rated Strong 5, Workable 3, Weak 1 or Absent 0. The overall figure is weighted points over the weighted maximum, across rated dimensions only (a category scores the average of its rated criteria); Strong is 80% or more, Workable 60% or more. ${d.basis}`, { italics: true }));
    for (const x of d.dimensions) {
      const score = x.score === null ? x.label : `${Number.isInteger(x.score) ? x.score : x.score.toFixed(1)}/5, ${x.label}`;
      if (x.categoryLabel === null) body.push(bullet(`${criterionShortLabel(x.dimensionId)}${x.weight > 1 ? ` (counts x${x.weight})` : ""}: ${score}`));
      else body.push(bullet(`${x.categoryLabel} (weight ${x.weight}%): ${score}. ${x.criteria.map((c) => `${criterionShortLabel(c.criterionId)} ${c.score === null ? c.label.toLowerCase() : `${c.score}/5`}`).join("; ")}`));
    }
  }

  // Part 1: the scored checklist (RQK), the same figures the screen shows, computed on the server.
  body.push(h("Scored checklist", HeadingLevel.HEADING_1));
  if (r.checklists.length === 0) body.push(p(r.checklistNote ?? "No checklist was scored in this review."));
  else
    body.push(
      p("Each document is checked against the elements good practice expects in that kind of document. Present scores 2, partial 1, absent 0; percentages count assessed elements only. Strong is 80% or more, Workable 60% or more. A guide to where to look, not a certification."),
    );
  for (const c of r.checklists) {
    body.push(h(`${c.filename}: ${c.label}, ${checklistScoreText(c.score, c.state)}`, HeadingLevel.HEADING_2));
    if (c.state === "failed" && c.error) body.push(p(`Not scored: ${c.error}`));
    if (!c.score) continue;
    body.push(p(`${c.score.assessed} of ${c.score.total} elements assessed. Basis: ${c.basis}`, { italics: true }));
    for (const sec of c.score.sections) body.push(bullet(`${sec.label}: ${sec.pct === null ? "not assessed" : `${sec.pct}%`} (${sec.assessed} of ${sec.total} assessed)`));
    for (const sec of c.sections)
      for (const e of sec.elements)
        body.push(bullet(`${sec.label}, ${e.label}${e.essential ? " (essential)" : ""}: ${CHECKLIST_STATUS_LABEL[e.status ?? "not_assessed"]}${e.notAssessedBecause ? ` (${e.notAssessedBecause})` : ""}${e.reason ? `. ${e.reason}` : ""}`));
  }

  body.push(h("Scorecard", HeadingLevel.HEADING_1));
  body.push(p("Each criterion is scored on its own: Strong 5, Workable 3, Weak 1, Absent 0. Only the dashboard above combines them, as a weighted percentage."));
  for (const g of scorecard(r.observations)) {
    body.push(h(g.label, HeadingLevel.HEADING_2));
    for (const row of g.rows) {
      const q = qualifiers(row.observation);
      body.push(bullet(`${row.observation.criterionId}: ${row.label}${row.score !== null ? ` (${row.score}/5)` : ""}${comparisonLabel(row.comparison) ? `, ${comparisonLabel(row.comparison)}` : ""}${q.length ? ` [${q.join("; ")}]` : ""}. Improvement: ${row.suggestion ?? (row.score === 5 ? "none needed" : "none given")}`));
    }
  }

  body.push(h("Observations", HeadingLevel.HEADING_1));
  for (const o of r.observations.filter((x) => x.status !== "dismissed")) {
    const a = o.payload.assessment;
    body.push(h(`${o.criterionId}: ${o.question}`, HeadingLevel.HEADING_2));
    for (const q of qualifiers(o)) body.push(p(q, { bold: true }));
    body.push(p(`Score: ${o.payload.rating?.label ?? "Not rated"}${o.payload.rating?.score != null ? ` (${o.payload.rating.score}/5)` : ""}${o.payload.rating?.reason ? `. ${o.payload.rating.reason}` : ""}${comparisonLabel(o.payload.comparison) ? ` (${comparisonLabel(o.payload.comparison)})` : ""}`));
    body.push(p(`Documentation: ${documentationLabel(o.payload)}. Methodology: ${METHOD_LABEL[a.methodology]}.`));
    for (const d of a.decisionFitness) body.push(bullet(`Decision fitness${d.decisionRef !== null ? ` for "${r.manifest.decisions[d.decisionRef]?.text}"` : ""}: ${FITNESS_LABEL[d.state]}. ${d.reasoning}`));
    body.push(p(`Implication${o.wording ? " (researcher wording)" : ""}: ${shownImplication(o)}`));
    if (o.wording) body.push(p(`Generated wording: ${o.payload.implication}`, { italics: true }));
    if (a.reasoning) body.push(p(`Reasoning (AI judgement): ${a.reasoning}`));
    for (const s of o.payload.statements) body.push(bullet(`${s.phase === "planned" ? "Planned" : s.phase === "reported_executed" ? "Reported as done" : "Phase not stated"}: "${s.exactQuote ?? "(text purged)"}" (${locator(s, sourceName(s.sourceVersionId))})`));
    if (o.payload.basis === "absence_in_assessed_scope") body.push(p(o.payload.absenceScope === "complete" ? "Basis: not found anywhere in the documents read in full." : "Basis: not found in the assessed passages (not every relevant document was read in full)."));
    for (const c of o.payload.clarificationRefs) {
      const cl = r.manifest.clarifications.find((x) => x.entryId === c);
      if (cl) body.push(bullet(`Relies on a researcher clarification (${cl.actorEmail ?? "single user"}, ${cl.at.slice(0, 10)}): "${cl.text}"`));
    }
    for (const u of o.payload.uncertainty) body.push(bullet(`Uncertainty: ${u}`));
    for (const ref of o.payload.methodologicalReferenceRefs) {
      const rp = r.referencePassages.find((x) => x.referenceId === ref.referenceId && x.passageId === ref.passageId);
      body.push(bullet(`Guidance ${ref.referenceId}@${ref.version}:${ref.passageId}${rp?.synthetic ? " (synthetic test reference)" : ""}: ${rp ? `${rp.title}. "${rp.text}"` : ""}`));
    }
    for (const n of o.payload.validationNotes) body.push(bullet(`Checked by code: ${n}`));
    body.push(p(`Researcher: ${o.status.replace("_", " ")}${o.decidedBy ? ` by ${o.decidedBy}` : ""}${o.decidedAt ? ` (${o.decidedAt.slice(0, 16)})` : ""}.`));
    for (const c of o.comments) body.push(bullet(`Comment (${c.by}, ${c.at.slice(0, 10)}): ${c.text}`));
  }

  body.push(h("Improvement plan", HeadingLevel.HEADING_1));
  // Part 2: recommendations. First the checklist's own recommendation for each missing or partial
  // element, then the assessment's improvements by timing.
  body.push(h("Missing or partial elements", HeadingLevel.HEADING_2));
  const gapDocs = r.checklists.filter((c) => c.gaps.length > 0);
  if (gapDocs.length === 0) body.push(p(r.checklists.some((c) => c.state === "scored") ? "None: every assessed element is present." : "No scored checklist in this review."));
  for (const c of gapDocs) for (const g of c.gaps) body.push(bullet(`${c.filename}, ${g.label} (${g.status}${g.essential ? ", essential" : ""}): ${g.recommendation}`));
  for (const g of improvementsByTiming(r.observations)) {
    body.push(h(g.label, HeadingLevel.HEADING_2));
    if (g.items.length === 0) body.push(p("None."));
    for (const o of g.items) {
      const imp = o.payload.improvement!;
      const q = qualifiers(o);
      body.push(bullet(`${o.criterionId}${q.length ? ` [${q.join("; ")}]` : ""}: ${[imp.currentAction && `Now: ${imp.currentAction}`, imp.futureAction && `Next study: ${imp.futureAction}`].filter(Boolean).join(" ")} ${imp.rationale ? `Why: ${imp.rationale}` : ""} ${SUPPORT_LABEL[o.payload.referenceSupportStatus] ? `(${SUPPORT_LABEL[o.payload.referenceSupportStatus]})` : ""}`));
      for (const u of imp.unresolvedQuestions) body.push(bullet(`Open question: ${u}`));
    }
  }

  body.push(h("Clarifications", HeadingLevel.HEADING_1));
  const questions = r.observations.filter((o) => o.status !== "dismissed").flatMap((o) => o.payload.clarificationQuestions.map((q) => `${o.criterionId}: ${q}`));
  if (questions.length === 0) body.push(p("No questions raised."));
  for (const q of questions) body.push(bullet(`Question: ${q}`));
  for (const c of view.clarifications) body.push(bullet(`Researcher-supplied (${c.by}, ${c.at.slice(0, 10)}${r.manifest.clarificationIds.includes(c.entryId) ? "" : ", after this review"}): ${c.text}`));

  const dismissed = r.observations.filter((o) => o.status === "dismissed");
  body.push(h("Appendix: dismissed observations", HeadingLevel.HEADING_1));
  if (dismissed.length === 0) body.push(p("None."));
  for (const o of dismissed) body.push(bullet(`${o.criterionId} dismissed by ${o.decidedBy ?? "single user"}${o.decidedAt ? ` (${o.decidedAt.slice(0, 16)})` : ""}: ${shownImplication(o)} [${DOC_LABEL[o.payload.assessment.documentation]}]`));

  const doc = new Document({ sections: [{ children: body }] });
  const buffer = await Packer.toBuffer(doc);
  return { buffer, filename: `${safeFileStem(projectName, "project")}-research-quality-review-${r.sequence}.docx` };
}
