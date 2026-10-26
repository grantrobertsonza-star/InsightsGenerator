import { describe, expect, it } from "vitest";
import { deriveGotoRouting } from "../gotoRouting";
import { isEligible, parseRouting } from "../routingParse";

const yn = [{ code: "1", label: "Yes" }, { code: "2", label: "No", goto: "Q10" }];

describe("deriveGotoRouting", () => {
  const items = [
    { code: "Q5", routing: null, options: yn },
    { code: "Q6", routing: null, options: [] },
    { code: "Q7", routing: parseRouting("Ask if Q4 = 1"), options: [] },
    { code: "Q10", routing: null, options: [] },
  ];
  it("skips the items a jump passes over, and not the target", () => {
    const r = deriveGotoRouting(items);
    expect(r[0]).toBeNull();
    expect(isEligible(r[1]!, { Q5: "1" })).toBe(true);
    expect(isEligible(r[1]!, { Q5: "2" })).toBe(false);
    expect(r[3]).toBeNull();
  });
  it("adds to an explicit rule instead of replacing it", () => {
    const r = deriveGotoRouting(items)[2]!;
    expect(isEligible(r, { Q4: "1", Q5: "1" })).toBe(true);
    expect(isEligible(r, { Q4: "1", Q5: "2" })).toBe(false);
    expect(isEligible(r, { Q4: "2", Q5: "1" })).toBe(false);
  });
  it("treats END as skipping everything after", () => {
    const r = deriveGotoRouting([
      { code: "S1", routing: null, options: [{ code: "2", label: "No", goto: "END" }] },
      { code: "Q1", routing: null, options: [] },
    ]);
    expect(isEligible(r[1]!, { S1: "2" })).toBe(false);
  });
});
