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
