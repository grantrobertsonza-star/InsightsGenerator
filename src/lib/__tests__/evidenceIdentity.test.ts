// OBJ-REV-006: a reading records the identity of the categories it read (question key, raw answer
// code, banner variable and raw codes) beside their display labels, and records nothing when the
// table carried no identity. Pure reader; no database.
import { describe, expect, it } from "vitest";
import { readExpectation } from "../evidenceStance";
import type { CrosstabResult } from "../parseStatsFile";

const base = (n: number) => ({ n, w: n, nEff: n });
function table(withIdentity: boolean): CrosstabResult {
  const row = (label: string, code: string, pct: [number, number]) => ({
    label, ...(withIdentity ? { rawCode: code } : {}),
    count: [null, null], pct, rowPct: [null, null], p: [null, null], sig: [0, 0],
    base: [base(100), base(100)], total: { count: null, pct: (pct[0] + pct[1]) / 2, base: base(200) },
  });
  return {
    version: 2, weightVar: null, weightLabel: null,
    blocks: [{ var: "gender", label: "Gender" }],
    columns: ["Male", "Female"].map((name, i) => ({ block: 0, blockLabel: "Gender", name, n: 100, w: 100, nEff: 100, ...(withIdentity ? { var: "gender", rawCode: String(i + 1) } : {}) })),
    total: base(200),
    questions: [{ key: "purchase", label: "Purchase", kind: "single", rows: [row("Yes", "1", [60, 40]), row("No", "2", [40, 60])] }],
  } as unknown as CrosstabResult;
}

describe("evidence reading identity (OBJ-REV-006)", () => {
  it("a comparison records the answer's question key and raw code and each group's variable and raw code", () => {
    const r = readExpectation(table(true), { kind: "comparison", answer: "Yes", question: null, groupA: "Female", groupB: "Male", direction: "higher", measure: "percent" } as never)!;
    expect(r.estimate).toMatchObject({
      label: "Yes", groupA: "Female", groupB: "Male",
      answerIdentity: { question: "purchase", rawCode: "1" },
      groupAIdentity: { variable: "gender", rawCode: "2" },
      groupBIdentity: { variable: "gender", rawCode: "1" },
    });
  });

  it("a level records the answer identity", () => {
    const r = readExpectation(table(true), { kind: "level", answer: "No", question: null, direction: "above", threshold: 30, measure: "percent" } as never)!;
    expect(r.estimate.answerIdentity).toEqual({ question: "purchase", rawCode: "2" });
  });

  it("records no raw code or banner identity when the table carried none, rather than guessing from labels", () => {
    const r = readExpectation(table(false), { kind: "comparison", answer: "Yes", question: null, groupA: "Male", groupB: "Female", direction: "higher", measure: "percent" } as never)!;
    expect(r.estimate.answerIdentity).toEqual({ question: "purchase" });
    expect(r.estimate.groupAIdentity).toBeUndefined();
    expect(r.estimate.groupBIdentity).toBeUndefined();
  });
});
