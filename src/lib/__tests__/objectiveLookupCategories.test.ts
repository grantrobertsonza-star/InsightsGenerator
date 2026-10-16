// OBJ-REV-006 (golden-thread repair). Generic contract:
//   1. A string variable whose answers repeat within a small set (e.g. Gender "Male"/"Female",
//      Purchase "Yes"/"No") is a category and reachable by evidence lookup; free text and weights
//      are not (isStringCategory / isLookupEligible).
//   2. The actual planCrosstabFromText finds such variables through its search tool and accepts a
//      plan that uses them. Mocked boundaries: the model (scripted tool calls) and the dictionary
//      and category loaders (crosstabs.ts).
//   3. Fail-closed is preserved: with two questions sharing a "Yes" answer (80% and 20%) and no
//      question named, the reading is unresolved, never whichever row comes first; a named
//      question that is absent is unresolved too.
// Reproduction this generalises: an unambiguous purchase-by-gender objective could not reach the
// Gender and Purchase columns because both were strings without value labels.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CrosstabResult, VariableDictionary, VariableInfo } from "../parseStatsFile";

const v = (name: string, over: Partial<VariableInfo>): VariableInfo => ({
  name,
  label: name,
  numeric: false,
  nValid: 200,
  pctValid: 100,
  nDistinct: 2,
  labelled: false,
  weightLike: false,
  text: true,
  ...over,
});
const DICT = {
  version: 7,
  sets: [],
  variables: [
    v("Gender", {}),
    v("Purchase", { label: "Purchased in the last month" }),
    v("Region", { nDistinct: 9 }),
    v("Comments", { label: "Any other comments about gender or purchase", nDistinct: 180 }),
    v("weight", { numeric: true, weightLike: true, text: false, nDistinct: 40 }),
  ],
} as unknown as VariableDictionary;

const state = vi.hoisted(() => ({ turn: 0, toolResults: [] as string[] }));
vi.mock("../crosstabs", () => ({
  loadVariableDictionary: vi.fn(async () => DICT),
  loadCategories: vi.fn(async (_t: string, _r: string, _d: string, name: string) => ({
    label: name,
    categories: name === "Gender" ? [{ label: "Male" }, { label: "Female" }] : [{ label: "Yes" }, { label: "No" }],
  })),
}));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn() }));
vi.mock("../anthropic", () => ({
  CLAUDE_MODEL: "test-model",
  anthropic: {
    messages: {
      create: vi.fn(async (req: { messages: { role: string; content: unknown }[] }) => {
        const last = req.messages[req.messages.length - 1];
        if (Array.isArray(last.content)) {
          for (const b of last.content as { type: string; content?: unknown }[]) {
            if (b.type === "tool_result") state.toolResults.push(String(b.content));
          }
        }
        state.turn++;
        const call =
          state.turn === 1
            ? { name: "search_variables", input: { query: "purchase gender" } }
            : { name: "submit_plan", input: { summary: "Purchase by gender", rows: ["Purchase"], columns: ["Gender"], filters: [], unclear: [] } };
        return { usage: {}, content: [{ type: "tool_use", id: `t${state.turn}`, ...call }] };
      }),
    },
  },
}));

beforeEach(() => {
  state.turn = 0;
  state.toolResults = [];
});

describe("isStringCategory / isLookupEligible", () => {
  it("treats a short list of repeated string answers as a category, and free text, weights and numbers as not", async () => {
    const { isStringCategory, isLookupEligible } = await import("../variableKinds");
    expect(isStringCategory(v("Gender", {}))).toBe(true);
    expect(isStringCategory(v("Region", { nDistinct: 10 }))).toBe(true); // at the existing category limit
    expect(isStringCategory(v("Many", { nDistinct: 11 }))).toBe(false); // above it
    expect(isStringCategory(v("Comments", { nDistinct: 180 }))).toBe(false);
    expect(isStringCategory(v("Sparse", { nDistinct: 6, nValid: 8 }))).toBe(false); // answers barely repeat
    expect(isStringCategory(v("Constant", { nDistinct: 1 }))).toBe(false);
    expect(isStringCategory(v("Labelled", { labelled: true, text: false }))).toBe(false); // already categorical by labels
    expect(isLookupEligible(v("Labelled", { labelled: true, text: false }))).toBe(true);
    expect(isLookupEligible(v("weight", { numeric: true, weightLike: true, text: false }))).toBe(false);
    expect(isLookupEligible(v("Comments", { nDistinct: 180 }))).toBe(false);
  });
});

describe("planCrosstabFromText reaches string categories (actual planner)", () => {
  it("search offers Gender and Purchase as categorical, not free-text Comments, and the plan using them is accepted", async () => {
    const { planCrosstabFromText } = await import("../crosstabAsk");
    const plan = await planCrosstabFromText("t", "r", "d", "Purchase by gender");
    const search = state.toolResults[0];
    expect(search).toContain("variable Gender: Gender [categorical, 2 answers]");
    expect(search).toContain("variable Purchase: Purchased in the last month [categorical, 2 answers]");
    expect(search).not.toContain("Comments");
    expect(plan.rows.map((r) => r.key)).toEqual(["Purchase"]);
    expect(plan.columns.map((c) => c.name)).toEqual(["Gender"]);
    expect(plan.unclear).toEqual([]);
  });
});

describe("fail-closed is preserved", () => {
  const base = (n: number) => ({ n, w: n, nEff: n });
  const row = (label: string, pct: number) => ({
    label,
    count: [null],
    pct: [pct],
    rowPct: [null],
    p: [null],
    sig: [0],
    base: [base(200)],
    total: { count: null, pct, base: base(200) },
  });
  const twoQuestions = {
    version: 2,
    weightVar: null,
    weightLabel: null,
    blocks: [],
    columns: [{ block: 0, blockLabel: "Total", name: "Total", n: 200, w: 200, nEff: 200 }],
    total: base(200),
    questions: [
      { key: "q1", label: "Owns a car", kind: "single", rows: [row("Yes", 80), row("No", 20)] },
      { key: "q2", label: "Owns a boat", kind: "single", rows: [row("Yes", 20), row("No", 80)] },
    ],
  } as unknown as CrosstabResult;

  it("two questions sharing 'Yes' (80% and 20%) with no question named: unresolved, not the first row", async () => {
    const { readLevel } = await import("../evidenceStance");
    const r = readLevel(twoQuestions, { kind: "level", answer: "Yes", direction: "above", threshold: 50, question: null })!;
    expect(r.stance).toBe("inconclusive");
    expect(r.estimate.value).toBeNull();
  });

  it("the named question resolves; a named question that is absent stays unresolved", async () => {
    const { readLevel } = await import("../evidenceStance");
    expect(readLevel(twoQuestions, { kind: "level", answer: "Yes", direction: "above", threshold: 50, question: "Owns a car" })!.estimate.value).toBe(80);
    const missing = readLevel(twoQuestions, { kind: "level", answer: "Yes", direction: "above", threshold: 50, question: "Owns a plane" })!;
    expect(missing.stance).toBe("inconclusive");
    expect(missing.estimate.value).toBeNull();
  });
});
