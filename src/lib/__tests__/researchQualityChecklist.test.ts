// The quantitative checklist (RQK-1): catalogue integrity, the code's acceptance of model statuses,
// and the arithmetic. Expected percentages are worked out by hand in each case, not by calling the
// scorer's own formula.
import { describe, expect, it } from "vitest";
import { CHECKLISTS, bandFor, checklistsForRoles, findChecklist, gapRecommendations, scoreChecklist, validateChecklistAnswer, type Checklist, type ElementResult } from "../researchQualityChecklist";
import { SOURCE_ROLES, type DocumentedFact } from "../researchQualityTypes";

const fact = (factId: string, topic: DocumentedFact["topic"] = "claim", sourceVersionId = "v-own"): DocumentedFact => ({
  factId,
  sourceId: "s",
  sourceVersionId,
  topic,
  phase: "planned",
  selection: "unstated",
  statement: factId,
  exactQuote: `quote ${factId}`,
  locator: { start: 0, end: 1, segmentId: "p1", page: null },
});
const brief = findChecklist("brief")!;
const proposal = findChecklist("proposal")!;
const ids = (c: Checklist) => c.sections.flatMap((s) => s.elements.map((e) => e.elementId));
const answer = (statuses: Record<string, [string, string[]]>) => ({ elements: Object.entries(statuses).map(([element_id, [status, fact_ids]]) => ({ element_id, status, fact_ids, reason: `${element_id} ${status}` })) });

describe("RQK-1 catalogue", () => {
  it("has unique element ids, complete wording and only known roles", () => {
    const all = CHECKLISTS.checklists.flatMap(ids);
    expect(new Set(all).size).toBe(all.length);
    for (const c of CHECKLISTS.checklists) {
      expect(c.roles.every((r) => (SOURCE_ROLES as readonly string[]).includes(r))).toBe(true);
      expect(c.basis.length).toBeGreaterThan(10);
      for (const s of c.sections) for (const e of s.elements) for (const k of ["label", "present", "partial", "recommendation"] as const) expect(e[k].length, `${e.elementId}.${k}`).toBeGreaterThan(5);
    }
    expect(CHECKLISTS.checklists.map((c) => c.checklistId)).toEqual(["brief", "proposal", "questionnaire", "methodology_report"]);
  });

  it("covers the founder's brief and proposal rubric", () => {
    expect(ids(brief)).toEqual(expect.arrayContaining(["BR-BACKGROUND", "BR-PROBLEM", "BR-OBJ-COUNT", "BR-METHOD", "BR-DEADLINE", "BR-BUDGET"]));
    expect(ids(proposal)).toEqual(expect.arrayContaining(["PR-LITERATURE", "PR-RESTATE-PROBLEM", "PR-RESTATE-OBJECTIVES", "PR-ADDED-OBJECTIVES", "PR-DESIGN", "PR-SAMPLE-SIZE", "PR-ANALYSIS", "PR-PRODUCTS", "PR-TIMELINE", "PR-BUDGET"]));
  });

  it("picks checklists by confirmed role, once each; a discussion guide gets none", () => {
    expect(checklistsForRoles(["brief"]).map((c) => c.checklistId)).toEqual(["brief"]);
    expect(checklistsForRoles(["report", "methodology"]).map((c) => c.checklistId)).toEqual(["methodology_report"]);
    expect(checklistsForRoles(["brief", "proposal"]).map((c) => c.checklistId)).toEqual(["brief", "proposal"]);
    expect(checklistsForRoles(["discussion_guide"])).toEqual([]);
  });
});

describe("accepting the model's statuses", () => {
  const own = [fact("F1"), fact("F2"), fact("F3", "objective"), fact("F4", "objective"), fact("F5", "objective")];
  const ctx = { ownFacts: own, briefFacts: [fact("F9", "claim", "v-brief")], fullyRead: true };

  it("accepts present, partial and absent when backed as required", () => {
    const r = validateChecklistAnswer(answer({ "BR-BACKGROUND": ["present", ["F1"]], "BR-PROBLEM": ["partial", ["F2"]], "BR-BUDGET": ["absent", []] }), brief, ctx);
    const by = Object.fromEntries(r.map((x) => [x.elementId, x]));
    expect(by["BR-BACKGROUND"]).toMatchObject({ status: "present", factIds: ["F1"], notAssessedBecause: null });
    expect(by["BR-PROBLEM"].status).toBe("partial");
    expect(by["BR-BUDGET"].status).toBe("absent");
    // Every element in the checklist gets a row; ones the model skipped are not assessed, never absent.
    expect(r.length).toBe(ids(brief).length);
    expect(by["BR-DEADLINE"]).toMatchObject({ status: "not_assessed", notAssessedBecause: "the model did not give a status for this element" });
  });

  it("refuses presence without this document's quoted fact, and absence that cites facts", () => {
    const r = validateChecklistAnswer(answer({ "BR-BACKGROUND": ["present", []], "BR-PROBLEM": ["present", ["F99"]], "BR-DECISION": ["present", ["F9"]], "BR-BUDGET": ["absent", ["F1"]], "BR-DEADLINE": ["unclear", ["F1"]] }), brief, ctx);
    const by = Object.fromEntries(r.map((x) => [x.elementId, x]));
    for (const id of ["BR-BACKGROUND", "BR-PROBLEM", "BR-DECISION"]) expect(by[id].status, id).toBe("not_assessed"); // none, unknown id, brief fact on a non-compare element
    expect(by["BR-BUDGET"].notAssessedBecause).toMatch(/absent while citing/);
    expect(by["BR-DEADLINE"].notAssessedBecause).toMatch(/not present, partial or absent/);
  });

  it("never scores absence in a document that was not fully read", () => {
    const r = validateChecklistAnswer(answer({ "BR-BUDGET": ["absent", []], "BR-BACKGROUND": ["present", ["F1"]] }), brief, { ...ctx, fullyRead: false });
    const by = Object.fromEntries(r.map((x) => [x.elementId, x]));
    expect(by["BR-BUDGET"]).toMatchObject({ status: "not_assessed", notAssessedBecause: expect.stringMatching(/not all of the document was read/) });
    expect(by["BR-BACKGROUND"].status).toBe("present"); // what was read and quoted still counts
  });

  it("counts objectives itself: fewer than three cited objective facts caps the element at partial", () => {
    const three = validateChecklistAnswer(answer({ "BR-OBJ-COUNT": ["present", ["F3", "F4", "F5"]] }), brief, ctx);
    expect(three.find((x) => x.elementId === "BR-OBJ-COUNT")!.status).toBe("present");
    const two = validateChecklistAnswer(answer({ "BR-OBJ-COUNT": ["present", ["F3", "F4", "F1"]] }), brief, ctx); // F1 is not an objective
    expect(two.find((x) => x.elementId === "BR-OBJ-COUNT")!.status).toBe("partial");
    const dup = validateChecklistAnswer(answer({ "BR-OBJ-COUNT": ["present", ["F3", "F3", "F3"]] }), brief, ctx);
    expect(dup.find((x) => x.elementId === "BR-OBJ-COUNT")!.status).toBe("partial");
  });

  it("lets compared elements cite the brief, but presence still needs the proposal's own text", () => {
    const pctx = { ownFacts: [fact("F1")], briefFacts: [fact("F9", "claim", "v-brief")], fullyRead: true };
    const r = validateChecklistAnswer(answer({ "PR-RESTATE-PROBLEM": ["present", ["F1", "F9"]], "PR-TIMELINE": ["present", ["F9"]] }), proposal, pctx);
    expect(r.find((x) => x.elementId === "PR-RESTATE-PROBLEM")).toMatchObject({ status: "present", factIds: ["F1", "F9"] });
    expect(r.find((x) => x.elementId === "PR-TIMELINE")!.status).toBe("not_assessed");
  });

  it("names the shape of an unusable answer", () => {
    expect(() => validateChecklistAnswer({ elements: "x" }, brief, ctx)).toThrow("the checklist answer is not in the required shape (elements: string)");
    expect(() => validateChecklistAnswer({}, brief, ctx)).toThrow("(elements: missing)");
  });
});

describe("scoring", () => {
  const res = (pairs: [string, ElementResult["status"]][]): ElementResult[] => pairs.map(([elementId, status]) => ({ elementId, status, factIds: [], reason: "", notAssessedBecause: null }));

  it("computes section and overall percentages from assessed elements only", () => {
    // Brief context section (4 elements): present, partial, absent, not assessed -> (2+1+0)/(3x2) = 50%.
    // Objectives section (3): present, present, present -> 6/6 = 100%.
    // Method (5): all absent -> 0/10 = 0%.
    // Logistics (3): present, partial, present -> 5/6 = 83%.
    // Overall: (3+6+0+5)/((3+3+5+3)x2) = 14/28 = 50%.
    const r = res([
      ["BR-BACKGROUND", "present"], ["BR-PROBLEM", "partial"], ["BR-DECISION", "absent"], ["BR-AUDIENCE", "not_assessed"],
      ["BR-OBJ-COUNT", "present"], ["BR-OBJ-QUALITY", "present"], ["BR-INFO-NEEDS", "present"],
      ["BR-POPULATION", "absent"], ["BR-SCOPE", "absent"], ["BR-METHOD", "absent"], ["BR-GROUPS", "absent"], ["BR-EXISTING", "absent"],
      ["BR-DELIVERABLES", "present"], ["BR-DEADLINE", "partial"], ["BR-BUDGET", "present"],
    ]);
    const s = scoreChecklist(brief, r);
    expect(s.sections.map((x) => [x.sectionId, x.pct, x.assessed, x.total])).toEqual([
      ["context", 50, 3, 4],
      ["objectives", 100, 3, 3],
      ["method", 0, 5, 5],
      ["logistics", 83, 3, 3],
    ]);
    expect(s).toMatchObject({ points: 14, possible: 28, pct: 50, band: "weak", assessed: 14, total: 15 });
    // Not an average of sections: (50+100+0+83)/4 would be 58.
  });

  it("uses the objective scorer's bands, at their edges", () => {
    expect([bandFor(100), bandFor(80), bandFor(79), bandFor(60), bandFor(59), bandFor(0)]).toEqual(["strong", "strong", "workable", "workable", "weak", "weak"]);
  });

  it("withholds the overall score when fewer than half the elements could be assessed", () => {
    const r = res([["BR-BACKGROUND", "present"], ["BR-PROBLEM", "present"], ["BR-DECISION", "present"], ["BR-AUDIENCE", "present"], ["BR-OBJ-COUNT", "present"], ["BR-OBJ-QUALITY", "present"], ["BR-INFO-NEEDS", "present"]]);
    const s = scoreChecklist(brief, r); // 7 of 15 assessed
    expect(s).toMatchObject({ pct: null, band: null, assessed: 7 });
    expect(s.sections.find((x) => x.sectionId === "method")).toMatchObject({ pct: null, band: null, assessed: 0 });
    const eight = scoreChecklist(brief, [...r, ...res([["BR-BUDGET", "absent"]])]); // 8 of 15: 14/16 = 88%
    expect(eight).toMatchObject({ pct: 88, band: "strong" });
  });

  it("recommends for partial and absent elements only, essential first", () => {
    const r = res([["BR-AUDIENCE", "absent"], ["BR-BUDGET", "absent"], ["BR-BACKGROUND", "present"], ["BR-SCOPE", "partial"], ["BR-DEADLINE", "not_assessed"]]);
    const g = gapRecommendations(brief, r);
    expect(g.map((x) => [x.elementId, x.status, x.essential])).toEqual([
      ["BR-BUDGET", "absent", true],
      ["BR-AUDIENCE", "absent", false],
      ["BR-SCOPE", "partial", false],
    ]);
    expect(g[0].recommendation).toMatch(/budget/i);
  });
});
