// Research Quality Review v1: the deterministic rules (applicability, quotes, validation guards,
// identity). Pure functions, real implementations, no mocks.
import { describe, expect, it } from "vitest";
import {
  buildSegments,
  locateQuote,
  observationKey,
  referencePassagesFor,
  selectCriteria,
  validateExtraction,
  validateObservation,
  CRITERIA,
} from "../researchQualityRules";
import type { DocumentedFact, ReviewManifest } from "../researchQualityTypes";

const byId = (sel: ReturnType<typeof selectCriteria>) => Object.fromEntries(sel.map((s) => [s.criterionId, s]));

describe("criterion applicability", () => {
  it("RQ01: a brief alone for a planned study assesses the brief; absent later documents are 'not yet available', not poor conduct", () => {
    const s = byId(selectCriteria("improve_planned", "unclear", ["brief"], 1));
    expect(s["RQ-BRIEF-DECISION"].status).toBe("selected");
    expect(s["RQ-BRIEF-BACKGROUND"].status).toBe("selected");
    expect(s["RQ-BRIEF-BUDGET"].status).toBe("selected");
    expect(s["RQ-PROP-SAMPLE-SIZE"].status).toBe("excluded");
    expect(s["RQ-PROP-SAMPLE-METHOD"].status).toBe("excluded");
    expect(s["RQ-SAMPLE-RECRUIT"].status).toBe("excluded");
    expect(s["RQ-SAMPLE-RECRUIT"].reason).toMatch(/no plan or methodology document yet/);
    expect(s["RQ-DESIGN-ALIGN"].reason).toMatch(/no plan/);
    expect(s["RQ-INSTR-COVERAGE"].status).toBe("excluded");
    expect(s["RQ-ALIGN-CONSISTENCY"].status).toBe("excluded");
  });
  it("RQ04: reviewing a documented study keeps design criteria even with no methodology document, so the gap is reported", () => {
    const s = byId(selectCriteria("review_documented", "quantitative", ["report"], 1));
    expect(s["RQ-SAMPLE-RECRUIT"].status).toBe("selected");
    expect(s["RQ-MEASURE-ANALYSIS"].status).toBe("selected");
  });
  it("RQ08: study type decides strand criteria; unclear leaves them unresolved, never silently dropped", () => {
    const q = byId(selectCriteria("review_documented", "qualitative", ["discussion_guide", "report"], 2));
    expect(q["RQ-QUAL-PROCESS"].status).toBe("selected");
    expect(q["RQ-MIXED-INTEGRATION"].status).toBe("excluded");
    const m = byId(selectCriteria("review_documented", "mixed", ["report"], 1));
    expect(m["RQ-QUAL-PROCESS"].status).toBe("selected");
    expect(m["RQ-MIXED-INTEGRATION"].status).toBe("selected");
    const u = byId(selectCriteria("review_documented", "unclear", ["report"], 1));
    expect(u["RQ-QUAL-PROCESS"].status).toBe("unresolved");
    expect(u["RQ-MIXED-INTEGRATION"].status).toBe("unresolved");
  });
  it("plan versus execution needs both a plan and an account of what was done, in review mode", () => {
    expect(byId(selectCriteria("review_documented", "quantitative", ["proposal", "fieldwork"], 2))["RQ-PLAN-EXECUTION"].status).toBe("selected");
    expect(byId(selectCriteria("improve_planned", "quantitative", ["proposal", "fieldwork"], 2))["RQ-PLAN-EXECUTION"].status).toBe("excluded");
  });
});

describe("text, segments and quotes", () => {
  const raw = "Brief\r\n\r\nWe will survey existing customers.   \nThe decision is whether to expand.\n\nTimeline: Q1.";
  it("paragraph segments without pages; real page segments with pages", () => {
    const { text, segments } = buildSegments(null, raw);
    expect(text).not.toMatch(/\r/);
    expect(segments.map((s) => s.kind)).toEqual(["paragraph", "paragraph", "paragraph"]);
    const paged = buildSegments([{ pageNumber: 3, text: "Page three text." }, { pageNumber: 4, text: "Page four." }], "");
    expect(paged.segments.map((s) => [s.id, s.page])).toEqual([["p3", 3], ["p4", 4]]);
  });
  it("finds an exact quote despite whitespace differences, and refuses an altered one", () => {
    const { text, segments } = buildSegments(null, raw);
    const loc = locateQuote(text, "We will survey   existing customers.", { start: 0, end: text.length }, segments);
    expect(loc && text.slice(loc.start, loc.end)).toBe("We will survey existing customers.");
    expect(loc?.segmentId).toBe("s2");
    expect(locateQuote(text, "We will survey all customers.", { start: 0, end: text.length }, segments)).toBeNull();
    // Outside the assessed range is not found either.
    expect(locateQuote(text, "Timeline: Q1.", { start: 0, end: 20 }, segments)).toBeNull();
  });
  it("extraction keeps only verified quotes, and an empty answer must say nothing was found", () => {
    const { text, segments } = buildSegments(null, raw);
    const ctx = { text, range: { start: 0, end: text.length }, segments, sourceId: "s", sourceVersionId: "v" };
    const r = validateExtraction(
      { nothing_found: false, facts: [
        { topic: "population", phase: "planned", selection: "unstated", statement: "Existing customers", exact_quote: "We will survey existing customers." },
        { topic: "population", phase: "planned", selection: "unstated", statement: "Invented", exact_quote: "We will survey the general public." },
        { topic: "not-a-topic", phase: "planned", statement: "x", exact_quote: "The decision is whether to expand." },
      ] },
      ctx,
    );
    expect(r.facts).toHaveLength(1);
    expect(r.dropped).toBe(2);
    expect(() => validateExtraction({ nothing_found: false, facts: [] }, ctx)).toThrow(/without saying nothing was found/);
    expect(() => validateExtraction({ facts: "x" }, ctx)).toThrow(/required shape/);
    expect(validateExtraction({ nothing_found: true, facts: [] }, ctx).nothingFound).toBe(true);
  });
});

const crit = (id: string) => CRITERIA.criteria.filter((c) => c.criterionId === id);
const fact = (over: Partial<DocumentedFact>): DocumentedFact => ({
  factId: "F1",
  sourceId: "src-1",
  sourceVersionId: "ver-1",
  topic: "recruitment",
  phase: "reported_executed",
  selection: "non_probability",
  statement: "Opt-in panel",
  exactQuote: "Respondents joined an opt-in online panel.",
  locator: { start: 0, end: 40, segmentId: "s1", page: null },
  ...over,
});
const manifest: Pick<ReviewManifest, "decisions" | "objectives" | "clarifications" | "sources"> = {
  decisions: [{ decisionId: null, text: "Estimate the share of all customers likely to leave" }],
  objectives: [],
  clarifications: [],
  sources: [{ sourceId: "src-1", sourceVersionId: "ver-1", documentId: "d", filename: "report.txt", roles: ["report"], canonicalSha256: "x", charCount: 100, assessedRanges: [{ start: 0, end: 100 }] }],
};

describe("observation validation guards", () => {
  const base = { criteria: crit("RQ-SAMPLE-RECRUIT"), facts: [fact({})], manifest, passages: [], coverageComplete: true };
  it("missing documentation can only be 'cannot assess', never a concern", () => {
    const o = validateObservation({ criterion_id: "RQ-SAMPLE-RECRUIT", fact_ids: [], documentation: "not_documented", methodology: "concern", decision_fitness: [], reasoning: "r", implication: "i" }, base);
    expect(o.assessment.methodology).toBe("cannot_assess");
    expect(o.basis).toBe("absence_in_assessed_scope");
    expect(o.absenceScope).toBe("complete");
    expect(o.validationNotes.join(" ")).toMatch(/not evidence of a poor method/);
  });
  it("absence over partial coverage is 'not found in the assessed passages'", () => {
    const o = validateObservation({ criterion_id: "RQ-SAMPLE-RECRUIT", fact_ids: [], documentation: "not_documented", methodology: "cannot_assess", decision_fitness: [], reasoning: "r", implication: "i" }, { ...base, coverageComplete: false });
    expect(o.absenceScope).toBe("partial");
  });
  it("refuses documented content without facts, unknown facts, criteria outside the task and bad enums", () => {
    expect(() => validateObservation({ criterion_id: "RQ-SAMPLE-RECRUIT", fact_ids: [], documentation: "documented", methodology: "concern", decision_fitness: [], reasoning: "", implication: "" }, base)).toThrow(/without citing/);
    expect(() => validateObservation({ criterion_id: "RQ-SAMPLE-RECRUIT", fact_ids: ["F9"], documentation: "documented", methodology: "concern", decision_fitness: [], reasoning: "", implication: "" }, base)).toThrow(/unknown fact/);
    expect(() => validateObservation({ criterion_id: "RQ-BRIEF-BUDGET", fact_ids: [], documentation: "partial", methodology: "concern", decision_fitness: [], reasoning: "", implication: "" }, base)).toThrow(/outside this task/);
    expect(() => validateObservation({ criterion_id: "RQ-SAMPLE-RECRUIT", fact_ids: ["F1"], documentation: "great", methodology: "concern", decision_fitness: [], reasoning: "", implication: "" }, base)).toThrow(/invalid documentation/);
  });
  it("withholds a numerical prescription as needing a specialist", () => {
    const o = validateObservation(
      { criterion_id: "RQ-SAMPLE-RECRUIT", fact_ids: ["F1"], score: 1, documentation: "documented", methodology: "concern", decision_fitness: [{ decision_ref: 0, state: "insufficient_basis", reasoning: "opt-in" }], reasoning: "r", implication: "i",
        improvement: { current_action: "Report the opt-in recruitment.", future_action: "Use a sample of at least 1000 respondents.", timing: "next_study", rationale: "x" } },
      base,
    );
    expect(o.referenceSupportStatus).toBe("specialist_assessment_required");
    expect(o.improvement?.futureAction).toBeNull();
    expect(o.improvement?.currentAction).toBe("Report the opt-in recruitment.");
    expect(o.assessment.decisionFitness[0]).toMatchObject({ decisionRef: 0, state: "insufficient_basis" });
  });
  it("an approved probability-precision passage cannot support a claim about an opt-in sample; an unlisted passage is not used", () => {
    process.env.RESEARCH_QUALITY_REFERENCE_CATALOGUE = "synthetic-test";
    try {
      const probFacts = [fact({ selection: "probability", factId: "F2" })];
      const passages = referencePassagesFor(["RQ-SAMPLE-RECRUIT"], "quantitative", [...probFacts, fact({})]);
      expect(passages.map((p) => `${p.referenceId}:${p.passageId}`)).toContain("REF-PRECISION:P1");
      const o = validateObservation(
        { criterion_id: "RQ-SAMPLE-RECRUIT", fact_ids: ["F1"], score: 1, documentation: "documented", methodology: "concern", decision_fitness: [], reasoning: "r", implication: "i",
          improvement: { current_action: "Do not present the panel result as representative.", timing: "before_decision", rationale: "x" },
          reference_passages: [{ reference_id: "REF-PRECISION", passage_id: "P1" }, { reference_id: "REF-INVENTED", passage_id: "Z" }] },
        { ...base, passages },
      );
      expect(o.methodologicalReferenceRefs).toEqual([]);
      expect(o.referenceSupportStatus).toBe("insufficient_reference_support");
      expect(o.validationNotes.join(" ")).toMatch(/probability samples/);
      expect(o.validationNotes.join(" ")).toMatch(/not an approved passage/);
      // Production catalogue: nothing approved, so nothing is ever offered.
      delete process.env.RESEARCH_QUALITY_REFERENCE_CATALOGUE;
      expect(referencePassagesFor(["RQ-SAMPLE-RECRUIT", "RQ-INFERENCE-SCOPE"], "quantitative", probFacts)).toEqual([]);
    } finally {
      delete process.env.RESEARCH_QUALITY_REFERENCE_CATALOGUE;
    }
  });
});

describe("brief and proposal rubric (RQC-2)", () => {
  it("proposal criteria compare with the brief when one is selected, and are assessed on their own otherwise", () => {
    const withBrief = byId(selectCriteria("improve_planned", "quantitative", ["brief", "proposal"], 2));
    expect(withBrief["RQ-PROP-RESTATEMENT"].reason).toMatch(/compared with the selected brief/);
    const alone = byId(selectCriteria("improve_planned", "quantitative", ["proposal"], 1));
    expect(alone["RQ-PROP-RESTATEMENT"].reason).toMatch(/assessed on its own/);
    expect(alone["RQ-BRIEF-OBJECTIVES"].status).toBe("excluded");
    // RQC-6: sampling is rated twice, size and precision, then method; the single Sample criterion is retired.
    expect(alone["RQ-PROP-SAMPLE"]).toBeUndefined();
    for (const id of ["RQ-PROP-LITERATURE", "RQ-PROP-METHOD", "RQ-PROP-DESIGN", "RQ-PROP-SAMPLE-SIZE", "RQ-PROP-SAMPLE-METHOD", "RQ-PROP-ANALYSIS", "RQ-PROP-PRODUCTS", "RQ-PROP-TIMELINE", "RQ-PROP-BUDGET", "RQ-PROP-OBJECTIVES-ADDED"]) expect(alone[id].status).toBe("selected");
    // A planned study's design is assessed under the proposal criteria, not twice.
    expect(withBrief["RQ-SAMPLE-RECRUIT"].status).toBe("excluded");
  });
  const objFact = (n: number) => fact({ factId: `O${n}`, topic: "objective", phase: "planned", selection: "unstated", exactQuote: `Objective number ${n} is to measure loyalty.` });
  const oc = (facts: DocumentedFact[]) => ({ criteria: crit("RQ-BRIEF-OBJECTIVES"), facts, manifest, passages: [], coverageComplete: true });
  it("scores each criterion on its own, consistently with what was documented", () => {
    const absent = validateObservation({ criterion_id: "RQ-BRIEF-OBJECTIVES", fact_ids: [], score: 3, documentation: "not_documented", methodology: "cannot_assess", decision_fitness: [], reasoning: "", implication: "", improvement: { current_action: "Add three objectives", timing: "before_fieldwork", rationale: "" } }, oc([]));
    expect(absent.rating).toMatchObject({ score: 0, label: "Absent" });
    const present0 = validateObservation({ criterion_id: "RQ-BRIEF-OBJECTIVES", fact_ids: ["O1"], score: 0, documentation: "partial", methodology: "concern", decision_fitness: [], reasoning: "", implication: "", improvement: { current_action: "Add more", timing: "before_fieldwork", rationale: "" } }, oc([objFact(1)]));
    expect(present0.rating.score).toBe(1);
    expect(() => validateObservation({ criterion_id: "RQ-BRIEF-OBJECTIVES", fact_ids: ["O1"], score: 4, documentation: "documented", methodology: "concern", decision_fitness: [], reasoning: "", implication: "" }, oc([objFact(1)]))).toThrow(/no valid score/);
  });
  it("needs at least three cited objectives to score the brief's objectives above Weak", () => {
    const two = validateObservation({ criterion_id: "RQ-BRIEF-OBJECTIVES", fact_ids: ["O1", "O2"], score: 5, documentation: "documented", methodology: "documented_strength", decision_fitness: [], reasoning: "", implication: "" }, oc([objFact(1), objFact(2)]));
    expect(two.rating.score).toBe(1);
    expect(two.validationNotes.join(" ")).toMatch(/at least three/);
    expect(two.validationNotes.join(" ")).toMatch(/No improvement suggestion/);
    const three = validateObservation({ criterion_id: "RQ-BRIEF-OBJECTIVES", fact_ids: ["O1", "O2", "O3"], score: 5, documentation: "documented", methodology: "documented_strength", decision_fitness: [], reasoning: "", implication: "" }, oc([objFact(1), objFact(2), objFact(3)]));
    expect(three.rating).toMatchObject({ score: 5, label: "Strong" });
  });
  it("records whether a comparative proposal criterion had a brief to compare with", () => {
    const ctx = (briefPresent: boolean) => ({ criteria: crit("RQ-PROP-TIMELINE"), facts: [], manifest, passages: [], coverageComplete: true, briefPresent });
    const raw = { criterion_id: "RQ-PROP-TIMELINE", fact_ids: [], score: 0, documentation: "not_documented", methodology: "cannot_assess", decision_fitness: [], reasoning: "", implication: "", improvement: { current_action: "Add dated milestones", timing: "before_fieldwork", rationale: "" } };
    expect(validateObservation(raw, ctx(true)).comparison).toBe("compared_with_brief");
    expect(validateObservation(raw, ctx(false)).comparison).toBe("standalone");
  });
});

describe("observation identity", () => {
  it("depends on criterion, target and logical sources, not on order or wording", () => {
    const a = observationKey("RQ-X", ["Decide  A"], [], ["s2", "s1"], null);
    expect(observationKey("RQ-X", ["Decide A"], [], ["s1", "s2", "s1"], null)).toBe(a);
    expect(observationKey("RQ-X", ["Decide B"], [], ["s1", "s2"], null)).not.toBe(a);
    expect(observationKey("RQ-X", ["Decide A"], [], [], ["report"])).not.toBe(a);
  });
});
