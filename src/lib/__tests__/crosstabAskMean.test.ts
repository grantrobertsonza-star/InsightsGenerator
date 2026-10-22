// A plain-English request for a mean (Grant, 2026-10-22: "Give me the mean overall satisfaction
// score" built a frequency table whose summary said "Mean of..."). The plan schema now carries a
// per-row statistic, checked at the server boundary; a mean becomes a CrosstabGroup of kind "mean"
// placed above the answers, asking the engine to qualify codes that may not be a scale (the engine's
// side is checked in crosstabAskMeanEngine.test.ts); the plan's Check item states how the mean is
// worked out and the qualification; and the summary is written by code from what will be built,
// never by the model.
//
// Runs the actual planCrosstabFromText and validation. Mocked: the model (a scripted sequence of
// tool calls), the usage log, and the data-file reads (dictionary, categories, saved corrections).
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  submits: [] as Record<string, unknown>[],
  requests: [] as { messages: unknown[] }[],
  categories: {} as Record<string, string[]>,
  overrides: {} as Record<string, { type?: string }>,
  overridesFail: false,
}));

vi.mock("../anthropic", () => ({
  CLAUDE_MODEL: "test-model",
  anthropic: {
    messages: {
      create: vi.fn(async (req: { messages: unknown[] }) => {
        state.requests.push({ messages: JSON.parse(JSON.stringify(req.messages)) });
        const input = state.submits.shift() ?? {};
        return { content: [{ type: "tool_use", id: `call-${state.requests.length}`, name: "submit_plan", input }], usage: { input_tokens: 1, output_tokens: 1 } };
      }),
    },
  },
}));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn(async () => {}) }));
vi.mock("../crosstabs", () => ({
  loadVariableDictionary: vi.fn(async () => ({
    variables: [
      { name: "sat", label: "Overall satisfaction", numeric: true, nValid: 10, pctValid: 100, nDistinct: 6, labelled: true, weightLike: false },
      { name: "satw", label: "Satisfaction in words", numeric: true, nValid: 10, pctValid: 100, nDistinct: 5, labelled: true, weightLike: false },
      { name: "region", label: "Region", numeric: true, nValid: 10, pctValid: 100, nDistinct: 4, labelled: true, weightLike: false },
      { name: "age", label: "Age", numeric: true, nValid: 10, pctValid: 100, nDistinct: 60, labelled: false, weightLike: false },
      { name: "rating", label: "Rating", numeric: true, nValid: 10, pctValid: 100, nDistinct: 5, labelled: false, weightLike: false },
      { name: "city", label: "City", numeric: false, nValid: 10, pctValid: 100, nDistinct: 8, labelled: false, weightLike: false },
      { name: "gender", label: "Gender", numeric: true, nValid: 10, pctValid: 100, nDistinct: 2, labelled: true, weightLike: false },
      { name: "b1", label: "Brand A", numeric: true, nValid: 10, pctValid: 100, nDistinct: 2, labelled: true, weightLike: false },
      { name: "b2", label: "Brand B", numeric: true, nValid: 10, pctValid: 100, nDistinct: 2, labelled: true, weightLike: false },
    ],
    sets: [{ key: "brands", label: "Brands used", vars: ["b1", "b2"], kind: "multi" }],
  })),
  loadCategories: vi.fn(async (_t: string, _r: string, _d: string, name: string) => ({
    variable: name,
    label: name,
    categories: (state.categories[name] ?? []).map((label) => ({ label, n: 1 })),
  })),
}));
vi.mock("../variableOverrides", () => ({
  loadVariableOverrides: vi.fn(async () => {
    if (state.overridesFail) throw new Error("connection reset while reading corrections");
    return state.overrides;
  }),
}));

import { describePlan, meanGroupFor, planCrosstabFromText, tabulatedAsAverage, UNORDERED_MEAN_NOTE } from "../crosstabAsk";

const ask = (...submits: Record<string, unknown>[]) => {
  state.submits = submits;
  return planCrosstabFromText("t", "r", "d", "Give me the mean overall satisfaction score");
};
const plan = (rows: string[], statistics?: unknown, extra: Record<string, unknown> = {}) => ({ summary: "Mean of overall satisfaction.", rows, columns: [], filters: [], unclear: [], statistics, ...extra });

beforeEach(() => {
  state.submits = [];
  state.requests = [];
  state.overrides = {};
  state.overridesFail = false;
  state.categories = {
    sat: ["1", "2", "3", "4", "5", "Don't know"],
    satw: ["Very dissatisfied", "Dissatisfied", "Neutral", "Satisfied", "Very satisfied"],
    region: ["North", "South", "East", "West"],
    gender: ["Male", "Female"],
  };
});

describe("a mean request on a row", () => {
  it("Grant's repro: a mean row above the answers, and a summary that says so", async () => {
    const p = await ask(plan(["sat"], [{ row: "sat", statistic: "mean" }]));
    expect(p.rows).toEqual([{ key: "sat", label: "Overall satisfaction", vars: ["sat"], groups: [{ label: "Overall satisfaction", cats: [], kind: "mean", place: "above", qualifyCodes: true }] }]);
    expect(p.means).toEqual(["sat"]);
    expect(p.averageOnly).toEqual([]);
    expect(p.summary).toBe("A table of the mean and answers of Overall satisfaction (sat), for everyone, no column split.");
    const note = p.unclear.find((u) => u.startsWith("The mean of Overall satisfaction"));
    expect(note).toContain("numeric answer codes");
    expect(note).toContain("declared missing values and don't know, refused and not applicable answers are left out");
    expect(note).toContain("table's weight");
    expect(note).toContain(`If its answers are not an ordered scale (such as regions or brands), the mean row is labelled "${UNORDERED_MEAN_NOTE}"`);
  });

  it("the summary is the code's, not the model's: no statistic asked means no mean promised", async () => {
    const p = await ask(plan(["sat"]));
    expect(p.summary).toBe("A table of the answers of Overall satisfaction (sat), for everyone, no column split.");
    expect(p.summary).not.toMatch(/mean/i);
    expect(p.rows[0].groups).toBeUndefined();
    expect(p.means).toEqual([]);
  });

  it("categorical answers get the mean too, with the qualification asked of the engine", async () => {
    const p = await ask(plan(["satw", "region"], [{ row: "satw", statistic: "mean" }, { row: "region", statistic: "mean" }]));
    expect(p.rows.map((r) => r.groups?.[0])).toEqual([
      { label: "Satisfaction in words", cats: [], kind: "mean", place: "above", qualifyCodes: true },
      { label: "Region", cats: [], kind: "mean", place: "above", qualifyCodes: true },
    ]);
    expect(p.unclear.filter((u) => u.includes(UNORDERED_MEAN_NOTE))).toHaveLength(2);
    expect(p.summary).toBe("A table of the mean and answers of Satisfaction in words (satw); the mean and answers of Region (region), for everyone, no column split.");
  });

  it("a categorical type keeps the mean row; discrete or continuous means an average only", async () => {
    state.overrides = { sat: { type: "categorical" }, rating: { type: "discrete" } };
    const p = await ask(plan(["sat", "rating"], [{ row: "sat", statistic: "mean" }, { row: "rating", statistic: "mean" }]));
    expect(p.rows[0].groups?.[0]).toMatchObject({ kind: "mean", place: "above" });
    expect(p.rows[1].groups).toBeUndefined();
    expect(p.means).toEqual(["sat"]);
    expect(p.averageOnly).toEqual(["rating"]);
    expect(p.summary).toContain("the average of Rating (rating)");
    expect(p.unclear.some((u) => u.startsWith("Rating is shown as an average"))).toBe(true);
  });

  it("an unlabelled numeric with many values is already an average: no group, said plainly", async () => {
    const p = await ask(plan(["age"], [{ row: "age", statistic: "mean" }]));
    expect(p.rows[0].groups).toBeUndefined();
    expect(p.averageOnly).toEqual(["age"]);
    expect(p.summary).toBe("A table of the average of Age (age), for everyone, no column split.");
  });

  it("text answers and multiple-response sets keep their answers and say why there is no mean", async () => {
    const p = await ask(plan(["city", "brands"], [{ row: "city", statistic: "mean" }, { row: "brands", statistic: "mean" }]));
    expect(p.rows.every((r) => !r.groups)).toBe(true);
    expect(p.means).toEqual([]);
    expect(p.unclear).toContain("No mean for City: its answers are text, so there are no answer codes to average. The table shows its answers.");
    expect(p.unclear.some((u) => u.startsWith("No mean for Brands used: it is a set of questions"))).toBe(true);
    expect(p.summary).not.toMatch(/mean/i);
  });

  it("an unsupported statistic or a row outside the plan goes back to the model, and the corrected plan is used", async () => {
    const p = await ask(
      plan(["sat"], [{ row: "sat", statistic: "median" }, { row: "gender", statistic: "mean" }]),
      plan(["sat"], [{ row: "sat", statistic: "mean" }, { row: "sat", statistic: "mean" }]),
    );
    const feedback = JSON.stringify(state.requests[1].messages);
    expect(feedback).toContain('Statistic \\"median\\" for \\"sat\\" is not supported');
    expect(feedback).toContain('Statistic row \\"gender\\" is not one of the plan');
    // The repeated request is one mean row, not two.
    expect(p.rows[0].groups).toHaveLength(1);
    expect(p.unclear.filter((u) => u.startsWith("The mean of"))).toHaveLength(1);
  });

  it("columns and filters are named in the code-written summary", async () => {
    const p = await ask(plan(["sat"], [{ row: "sat", statistic: "mean" }], { columns: ["gender"], filters: [{ variable: "region", op: "in", values: ["North"] }] }));
    expect(p.summary).toBe("A table of the mean and answers of Overall satisfaction (sat), by Gender, for the people who meet 1 filter.");
  });

  it("a failed read of the saved corrections fails the request, never a guessed order", async () => {
    state.overridesFail = true;
    await expect(ask(plan(["sat"], [{ row: "sat", statistic: "mean" }]))).rejects.toThrow("connection reset");
  });
});

describe("the rules on their own", () => {
  const v = (labelled: boolean, numeric = true, nDistinct = 5) => ({ numeric, labelled, nDistinct });
  it("tabulatedAsAverage mirrors the engine's branch (25 distinct values)", () => {
    expect(tabulatedAsAverage(v(false, true, 25), undefined)).toBe(false);
    expect(tabulatedAsAverage(v(false, true, 26), undefined)).toBe(true);
    expect(tabulatedAsAverage(v(true, true, 40), undefined)).toBe(false);
    expect(tabulatedAsAverage(v(false, true, 40), { type: "categorical" })).toBe(false);
    expect(tabulatedAsAverage(v(true, true, 5), { type: "continuous" })).toBe(true);
    expect(tabulatedAsAverage(v(true, false, 5), { type: "continuous" })).toBe(false);
  });
  it("meanGroupFor and describePlan", () => {
    expect(meanGroupFor("Q1")).toEqual({ label: "Q1", cats: [], kind: "mean", place: "above", qualifyCodes: true });
    expect(describePlan({ rows: [], columns: [{ name: "g", label: "Gender" }], filters: [], means: [], averageOnly: [] }, 2)).toBe(
      "A table of the columns on their own, by Gender, for the people who meet all 2 filters.",
    );
  });
});
