import { describe, expect, it } from "vitest";
import { buildLabelOverlay, enrichDictionary } from "../labelOverlay";

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
