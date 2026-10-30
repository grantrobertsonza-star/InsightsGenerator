import { describe, expect, it } from "vitest";
import { buildLabelOverlay, enrichDictionary, resolveLabels } from "../labelOverlay";

const yn = [{ code: "1", label: "Yes" }, { code: "2", label: "No" }];

describe("buildLabelOverlay", () => {
  it("gives a single-variable item its wording and answer labels", () => {
    const o = buildLabelOverlay([{ itemId: "a", variable: "Q5", code: "Q5", text: "Do you have a bank account?", options: yn }]);
    expect(o.variableLabels.Q5).toBe("Q5. Do you have a bank account?");
    expect(o.valueLabels.Q5).toEqual({ "1": "Yes", "2": "No" });
  });
  it("gives a multiple-response item a tooltip only", () => {
    const o = buildLabelOverlay([
      { itemId: "m", variable: "Q12_1", code: "Q12", text: "Which networks?", options: yn },
      { itemId: "m", variable: "Q12_2", code: "Q12", text: "Which networks?", options: yn },
    ]);
    expect(o.variableLabels.Q12_1).toBeUndefined();
    expect(o.valueLabels.Q12_1).toBeUndefined();
    expect(o.questions.Q12_1).toBe("Q12. Which networks?");
  });
});

describe("enrichDictionary", () => {
  const dict = {
    nCases: 10,
    variables: [
      { name: "Q5", label: "Q5", numeric: true, nValid: 10, pctValid: 100, nDistinct: 2, labelled: false, weightLike: false },
      { name: "Q6", label: "Has own label", numeric: true, nValid: 10, pctValid: 100, nDistinct: 2, labelled: true, weightLike: false },
    ],
  };
  it("only replaces a label that is just the variable name", () => {
    const o = buildLabelOverlay([
      { itemId: "a", variable: "Q5", code: "Q5", text: "Bank account?", options: yn },
      { itemId: "b", variable: "Q6", code: "Q6", text: "Another wording", options: [] },
    ]);
    const d = enrichDictionary(dict, o);
    expect(d.variables[0].label).toBe("Q5. Bank account?");
    expect(d.variables[0].labelled).toBe(true);
    expect(d.variables[1].label).toBe("Has own label");
    expect(d.variables[1].question).toBe("Q6. Another wording");
  });
});

// LBL-01: a codebook and a questionnaire linked to the same variable. Labels follow the codebook
// whatever order the links come in; question wording follows the questionnaire; a disagreement in
// answer labels is kept as a conflict rather than resolved silently.
describe("buildLabelOverlay with a codebook and a questionnaire", () => {
  const cb = { documentId: "cb", instrumentType: "codebook" };
  const qn = { documentId: "qn", instrumentType: "questionnaire" };
  const fromCodebook = { itemId: "c", variable: "Q5", code: "Q5", text: "Bank account", options: [{ code: "1", label: "Yes" }, { code: "2", label: "No" }, { code: "9", label: "Refused" }], source: cb };
  const fromQuestionnaire = { itemId: "q", variable: "Q5", code: "Q5", text: "Do you have a bank account?", options: [{ code: "1", label: "Yes" }, { code: "2", label: "No" }], source: qn };

  for (const [name, order] of [["questionnaire first", [fromQuestionnaire, fromCodebook]], ["codebook first", [fromCodebook, fromQuestionnaire]]] as const) {
    it(`applies the codebook's labels and the questionnaire's wording (${name})`, () => {
      const o = buildLabelOverlay([...order]);
      expect(o.variableLabels.Q5).toBe("Q5. Bank account");
      expect(o.valueLabels.Q5).toEqual({ "1": "Yes", "2": "No", "9": "Refused" });
      expect(o.questions.Q5).toBe("Q5. Do you have a bank account?");
      expect(o.conflicts).toEqual([{ variable: "Q5", applied: { ...cb, labels: { "1": "Yes", "2": "No", "9": "Refused" } }, other: { ...qn, labels: { "1": "Yes", "2": "No" } } }]);
    });
  }

  it("records no conflict when the two agree apart from case and spacing", () => {
    const o = buildLabelOverlay([fromQuestionnaire, { ...fromCodebook, options: [{ code: "1", label: "yes " }, { code: "2", label: "NO" }] }]);
    expect(o.valueLabels.Q5).toEqual({ "1": "yes ", "2": "NO" });
    expect(o.conflicts).toBeUndefined();
  });

  it("keeps the questionnaire's labels where the codebook gives none", () => {
    const o = buildLabelOverlay([{ ...fromCodebook, options: [] }, fromQuestionnaire]);
    expect(o.variableLabels.Q5).toBe("Q5. Bank account");
    expect(o.valueLabels.Q5).toEqual({ "1": "Yes", "2": "No" });
    expect(o.conflicts).toBeUndefined();
  });

  it("ranks a link with no recorded type after typed sources and never reports it as a conflict", () => {
    const o = buildLabelOverlay([{ ...fromQuestionnaire, itemId: "u", source: undefined, options: [{ code: "1", label: "Ja" }, { code: "2", label: "Nee" }] }, fromQuestionnaire]);
    expect(o.valueLabels.Q5).toEqual({ "1": "Yes", "2": "No" });
    expect(o.conflicts).toBeUndefined();
  });
});

// B36-F07 (Codex): a codebook giving one code was dropped entirely, so the questionnaire's
// different label for that code was used with no conflict shown.
describe("resolveLabels with a single-code source (B36-F07)", () => {
  const cb = { documentId: "cb", instrumentType: "codebook" };
  const qn = { documentId: "qn", instrumentType: "questionnaire" };
  const cbLink = { itemId: "c1", variable: "Q1", code: "Q1", text: "Attitude", options: [{ code: "1", label: "CB positive" }], source: cb };
  const qnLink = {
    itemId: "q1", variable: "Q1", code: "Q1", text: "How do you feel?",
    options: [{ code: "1", label: "QN negative" }, { code: "2", label: "QN positive" }], source: qn,
  };
  for (const [order, links] of [["codebook first", [cbLink, qnLink]], ["questionnaire first", [qnLink, cbLink]]] as const) {
    it(`keeps the codebook's label for its one code and shows the disagreement (${order})`, () => {
      const { overlay, sources } = resolveLabels([...links]);
      expect(overlay.valueLabels.Q1).toEqual({ "1": "CB positive", "2": "QN positive" });
      expect(overlay.conflicts).toHaveLength(1);
      expect(overlay.conflicts![0]).toMatchObject({ variable: "Q1", applied: { documentId: "cb" }, other: { documentId: "qn", labels: qnLink.options.reduce((m, o) => ({ ...m, [o.code]: o.label }), {}) } });
      expect(sources.Q1).toMatchObject({ valueLabels: qn, valueLabelsOverriddenBy: cb });
    });
  }
  it("does not record a conflict when the single code agrees", () => {
    const { overlay, sources } = resolveLabels([{ ...cbLink, options: [{ code: "1", label: "qn  NEGATIVE" }] }, qnLink]);
    expect(overlay.valueLabels.Q1).toEqual({ "1": "qn  NEGATIVE", "2": "QN positive" });
    expect(overlay.conflicts).toBeUndefined();
    expect(sources.Q1.valueLabelsOverriddenBy).toEqual(cb);
  });
  it("applies nothing and says so when every source labels only one code", () => {
    const { overlay, sources } = resolveLabels([cbLink, { ...qnLink, options: [{ code: "99", label: "Don't know" }] }]);
    expect(overlay.valueLabels.Q1).toBeUndefined();
    expect(sources.Q1.valueLabelsNotApplied).toEqual(cb);
    expect(sources.Q1.valueLabels).toBeUndefined();
  });
  it("lists a weaker single-code source's disagreement without applying it", () => {
    const full = { ...cbLink, options: [{ code: "1", label: "Agree" }, { code: "2", label: "Disagree" }] };
    const { overlay } = resolveLabels([full, { ...qnLink, options: [{ code: "1", label: "Disagree" }] }]);
    expect(overlay.valueLabels.Q1).toEqual({ "1": "Agree", "2": "Disagree" });
    expect(overlay.conflicts).toHaveLength(1);
    expect(overlay.conflicts![0]).toMatchObject({ applied: { documentId: "cb" }, other: { documentId: "qn" } });
  });
  it("does not flag a weaker single-code source that agrees on its code", () => {
    const full = { ...cbLink, options: [{ code: "1", label: "Agree" }, { code: "2", label: "Disagree" }] };
    expect(resolveLabels([full, { ...qnLink, options: [{ code: "2", label: "disagree" }] }]).overlay.conflicts).toBeUndefined();
  });
  it("still applies zero-code links' wording without answer labels", () => {
    const { overlay, sources } = resolveLabels([{ ...cbLink, options: [] }]);
    expect(overlay.variableLabels.Q1).toBe("Q1. Attitude");
    expect(overlay.valueLabels.Q1).toBeUndefined();
    expect(sources.Q1.valueLabelsNotApplied).toBeUndefined();
  });
});
