import { describe, expect, it } from "vitest";
import { AMBIGUOUS_CODE_CONFIDENCE, matchItems } from "../instrumentMatch";
import { isEligible, parseRouting } from "../routingParse";

describe("parseRouting", () => {
  it("reads simple equality and lists", () => {
    expect(parseRouting("ASK IF Q5 = 1")).toEqual({ combine: "all", clauses: [{ code: "Q5", values: ["1"], negate: false }] });
    expect(parseRouting("Ask if Q5 = 1 or 2")?.clauses[0].values).toEqual(["1", "2"]);
    expect(parseRouting("IF Q7 codes 1-3")?.clauses[0].values).toEqual(["1", "2", "3"]);
  });
  it("reads negation and combinations", () => {
    expect(parseRouting("Only if Q7 not 3")?.clauses[0].negate).toBe(true);
    const r = parseRouting("Ask if Q5 = 1 and Q6 = 2");
    expect(r?.combine).toBe("all");
    expect(r?.clauses.length).toBe(2);
    expect(parseRouting("Ask if Q5 = 1 or Q6 = 2")?.combine).toBe("any");
  });
  it("gives up on anything it cannot read", () => {
    expect(parseRouting("ASK ALL")).toBeNull();
    expect(parseRouting("Skip to Q10")).toBeNull();
    expect(parseRouting(null)).toBeNull();
  });
});

describe("parseRouting mixed AND/OR", () => {
  it("binds AND tighter than OR", () => {
    const r = parseRouting("Ask if Q5 = 1 and Q6 = 2 or Q7 = 3")!;
    expect(r.groups?.map((g) => g.map((c) => c.code))).toEqual([["Q5", "Q6"], ["Q7"]]);
    expect(isEligible(r, { Q5: "1", Q6: "2", Q7: "9" })).toBe(true);
    expect(isEligible(r, { Q5: "1", Q6: "9", Q7: "3" })).toBe(true);
    expect(isEligible(r, { Q5: "1", Q6: "9", Q7: "9" })).toBe(false);
    expect(isEligible(r, { Q5: "1", Q6: null, Q7: "9" })).toBeNull();
  });
});

describe("isEligible", () => {
  it("applies a clause to a gate answer", () => {
    const r = parseRouting("Ask if Q5 = 1 or 2")!;
    expect(isEligible(r, { Q5: "2" })).toBe(true);
    expect(isEligible(r, { Q5: "3" })).toBe(false);
    expect(isEligible(r, { Q5: null })).toBeNull();
  });
});

describe("matchItems", () => {
  const vars = [
    { name: "Q1", label: "Do you have a bank account" },
    { name: "Q10", label: "How often do you save" },
    { name: "Q12_1", label: "Q12 Which networks do you use: MTN" },
    { name: "Q12_2", label: "Q12 Which networks do you use: Vodacom" },
    { name: "B3a", label: "Main source of income in the household over the past year" },
  ];
  it("matches by code, not by prefix of a longer code", () => {
    const m = matchItems([{ id: "i1", code: "Q1", text: "Do you have a bank account?" }], vars);
    expect(m.map((x) => x.variable)).toEqual(["Q1"]);
    expect(m[0].method).toBe("code");
  });
  it("matches multi-response stems", () => {
    const m = matchItems([{ id: "i2", code: "Q12", text: "Which networks do you use?" }], vars);
    expect(m.map((x) => x.variable).sort()).toEqual(["Q12_1", "Q12_2"]);
    expect(m.every((x) => x.method === "stem")).toBe(true);
  });
  it("falls back to wording when there is no code", () => {
    const m = matchItems([{ id: "i3", code: null, text: "What was the main source of income in your household over the past year?" }], vars);
    expect(m[0]?.variable).toBe("B3a");
    expect(m[0]?.method).toBe("wording");
  });
  it("offers nothing when nothing fits", () => {
    expect(matchItems([{ id: "i4", code: "Z9", text: "Completely different subject matter entirely" }], vars)).toEqual([]);
  });
});

// IS-F06 (Codex import stress review, 27 October 2026): an item q1 with columns q1 and Q1 was offered
// both at confidence 1 and bulk-confirmed to both. The column written exactly as the code wins; when
// none is, every candidate is offered below "Confirm same-code matches" for the researcher to choose.
describe("several columns with the item's code once case and separators are set aside (IS-F06)", () => {
  const vars = (...names: string[]) => names.map((name) => ({ name, label: "" }));
  const offered = (code: string, names: string[]) =>
    matchItems([{ id: "i", code, text: "" }], vars(...names))
      .map((m) => [m.variable, m.confidence])
      .sort();

  it("the column written exactly as the code is the match, in either order", () => {
    expect(offered("q1", ["q1", "Q1"])).toEqual([["q1", 1]]);
    expect(offered("q1", ["Q1", "q1"])).toEqual([["q1", 1]]);
    expect(offered("Q1", ["q1", "Q1"])).toEqual([["Q1", 1]]);
    expect(offered("Q_1", ["Q.1", "Q_1"])).toEqual([["Q_1", 1]]);
    expect(offered("Q1", ["Q1", "Ｑ１"])).toEqual([["Q1", 1]]);
  });

  it("when no column is written as the code, each is offered below the confirm-all level", () => {
    for (const [code, names] of [["q1", ["Q_1", "Q.1"]], ["q1", ["Q1", "Ｑ１"]]] as const) {
      const got = offered(code, [...names]);
      expect(got.map(([v]) => v), code).toEqual([...names].sort());
      for (const [, c] of got) expect(c, code).toBe(AMBIGUOUS_CODE_CONFIDENCE);
      expect(AMBIGUOUS_CODE_CONFIDENCE).toBeLessThan(0.9);
    }
  });

  it("one column that differs only in case or separators is still a confident match; families are unchanged", () => {
    expect(offered("q1", ["Q1"])).toEqual([["Q1", 1]]);
    expect(offered("EN20.1", ["EN20_1"])).toEqual([["EN20_1", 1]]);
    expect(offered("Q1a", ["Q1_a"])).toEqual([["Q1_a", 1]]);
    expect(offered("MR", ["MR_1", "MR_2", "MR_3"]).map(([v]) => v)).toEqual(["MR_1", "MR_2", "MR_3"]);
  });
});
