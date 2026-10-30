// OBJ-REV-006 / OBJ-REV-005 (Codex review 2026-10-16): a share comparison must know WHICH answer it
// compares before the table is read. Codex's native case: "Does purchase differ between men and
// women?" was stored with a percent comparison but no answer and no question, so the correct
// Purchase x Gender table (Yes 60% / 40%, bases 100 / 100) read as "Could not find a matching row".
//
// Calls the ACTUAL evaluateEvidenceQuestion. Mocked boundaries only: the database client (it
// returns the question row and captures the stored result), the table planner and builder (they
// hand back the fixed table below), the saved set-up lookups and the model. The selector rule,
// the validation of the model's pick, the reading and the stored summary are the real code.
//   - unnamed answer: resolved from the table's own answers, validated, read, and the choice is
//     recorded in the summary; the model is shown every answer, not a pre-picked one
//   - the model declines ("none"): stored as unresolved with an actionable message, no guess
//   - an answer already named: no selector call at all (unchanged behaviour)
//   - preserved fail-closed cases: two questions sharing the named answer stay unresolved; a
//     declared average with no average row stays a measure mismatch
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CrosstabResult } from "../parseStatsFile";

const state = vi.hoisted(() => ({
  expectation: null as Record<string, unknown> | null,
  table: null as unknown,
  stored: [] as unknown[][],
  modelChoice: "none" as string,
  modelCalls: [] as { tool: string; content: string }[],
  question: "Does purchase differ between men and women?",
  supportsIf: "Men buy more than women",
}));

vi.mock("../db", () => {
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      if (/from objective_evidence where id = \$1 and run_id = \$2$/.test(sql.trim()) || /^select id, item_kind/.test(sql.trim())) {
        return {
          rows: [
            {
              id: "ev-1",
              item_kind: "objective",
              item_order: 0,
              objective_candidate_id: null,
              decision_candidate_id: null,
              item_text: "Understand who buys",
              question: state.question,
              request_text: "purchase by gender",
              supports_if: state.supportsIf,
              against_if: "Women buy more than men",
              expectation: state.expectation,
              source: "auto",
              excluded: false,
              question_revision: 1,
            },
          ],
        };
      }
      if (/for update/.test(sql)) return { rows: [{ question_revision: 1 }] };
      if (/savepoint/.test(sql)) return { rows: [] };
      if (/insert into objective_evidence_results/.test(sql)) {
        state.stored.push(params);
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };
  const run = async (_t: string, cb: (c: typeof client) => unknown) => cb(client);
  return { withTenant: run, withTenantRead: run, withTenantRepeatableRead: run };
});
vi.mock("../crosstabs", () => ({
  loadVariableDictionaryWithStatus: vi.fn(async () => ({
    ok: true,
    dictionary: { variables: [{ name: "gender", label: "Gender", nValid: 200, nDistinct: 2, pctValid: 100, weightLike: false, inSet: null }], sets: [] },
  })),
  loadVariableDictionary: vi.fn(),
  buildCrosstab: vi.fn(async () => ({ tableId: "table-1" })),
  loadCrosstab: vi.fn(async () => ({ result: state.table })),
}));
vi.mock("../dataSetup", () => ({
  loadDataSetupWithStatus: vi.fn(async () => ({
    ok: true,
    setup: { unit: "respondents", layout: "rows_are_cases", method: "survey", accepted: false, wave: null, design: null },
  })),
}));
vi.mock("../crosstabAsk", () => ({
  planCrosstabFromText: vi.fn(async () => ({ rows: [{ kind: "var", name: "purchase" }], columns: [{ name: "gender" }], filters: [], unclear: [] })),
}));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn() }));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));
vi.mock("../anthropic", () => ({
  CLAUDE_MODEL: "test-model",
  anthropic: {
    messages: {
      create: vi.fn(async (req: { tool_choice: { name: string }; messages: { content: string }[] }) => {
        state.modelCalls.push({ tool: req.tool_choice.name, content: req.messages[0].content });
        if (req.tool_choice.name === "choose_answer") {
          return { usage: {}, stop_reason: "tool_use", content: [{ type: "tool_use", name: "choose_answer", input: { choice: state.modelChoice } }] };
        }
        return { usage: {}, stop_reason: "tool_use", content: [{ type: "tool_use", name: "record_stance", input: { stance: "supports", summary: "judged" } }] };
      }),
    },
  },
}));

const base = (n: number) => ({ n, w: n, nEff: n });
function row(label: string, pct: number[], ns: number[]) {
  return {
    label,
    count: pct.map(() => null),
    pct,
    rowPct: pct.map(() => null),
    p: pct.map(() => null),
    sig: pct.map(() => 0),
    base: ns.map(base),
    total: { count: null, pct: (pct[0] + pct[1]) / 2, base: base(ns[0] + ns[1]) },
  };
}
function table(questions: { label: string; rows: ReturnType<typeof row>[] }[]): CrosstabResult {
  return {
    version: 2,
    weightVar: null,
    weightLabel: null,
    blocks: [{ var: "gender", label: "Gender" }],
    columns: ["Male", "Female"].map((name) => ({ block: 0, blockLabel: "Gender", name, n: 100, w: 100, nEff: 100 })),
    total: base(200),
    questions: questions.map((q, i) => ({ key: `q${i}`, label: q.label, kind: "single", rows: q.rows })),
  } as unknown as CrosstabResult;
}
const purchase = () => table([{ label: "Purchase", rows: [row("Yes", [60, 40], [100, 100]), row("No", [40, 60], [100, 100])] }]);
const comparison = (extra: Record<string, unknown> = {}) => ({
  kind: "comparison",
  answer: null,
  direction: "higher",
  groupA: "Male",
  groupB: "Female",
  measure: "percent",
  question: null,
  ...extra,
});
const stored = () => {
  const p = state.stored.at(-1)!;
  return { stance: p[6], basis: p[7], estimate: p[8] ? JSON.parse(String(p[8])) : null, summary: String(p[9] ?? ""), error: p[10] };
};

beforeEach(() => {
  state.question = "Does purchase differ between men and women?";
  state.supportsIf = "Men buy more than women";
  state.stored = [];
  state.modelCalls = [];
  state.modelChoice = "none";
  state.table = purchase();
  state.expectation = comparison();
});

const evaluate = async () => {
  const { evaluateEvidenceQuestion } = await import("../objectiveEvidence");
  return evaluateEvidenceQuestion("00000000-0000-4000-8000-000000000001", "run-1", { id: "doc-1", name: "survey.sav" }, "ev-1");
};

describe("share comparison response selector (actual evaluateEvidenceQuestion)", () => {
  it("Purchase by Gender with no answer named: resolves 'Yes' from the table's answers, reads the gap and records the choice", async () => {
    state.modelChoice = "1";
    expect(await evaluate()).toBe(true);
    const selector = state.modelCalls.find((c) => c.tool === "choose_answer")!;
    expect(selector.content).toContain("1. Purchase: Yes");
    expect(selector.content).toContain("2. Purchase: No");
    const r = stored();
    expect(r).toMatchObject({ stance: "supports", basis: "computed", error: null });
    expect(r.estimate).toMatchObject({ label: "Yes", groupA: "Male", groupB: "Female", diff: 20 });
    expect(r.summary).toMatch(/Male 60% vs Female 40%/);
    expect(r.summary).toContain('the share answering "Yes" to "Purchase" was matched to this table\'s answers');
    expect(state.modelCalls.some((c) => c.tool === "record_stance")).toBe(false);
  });

  it("the model declines: stored as unresolved with an actionable message, nothing assumed", async () => {
    state.modelChoice = "none";
    await evaluate();
    const r = stored();
    expect(r.stance).toBe("inconclusive");
    expect(r.summary).toMatch(/does not name which answer to compare/);
    expect(r.summary).toMatch(/Edit the question to name the answer/);
    expect(r.estimate.value).toBeNull();
    expect(state.modelCalls.some((c) => c.tool === "record_stance")).toBe(false);
  });

  it("an answer already named needs no selector call (unchanged behaviour)", async () => {
    state.expectation = comparison({ answer: "Yes" });
    await evaluate();
    expect(state.modelCalls).toEqual([]);
    expect(stored()).toMatchObject({ stance: "supports", basis: "computed" });
  });

  it("preserved: two questions sharing the named answer stay unresolved, with no selector call", async () => {
    state.table = table([
      { label: "Purchase", rows: [row("Yes", [60, 40], [100, 100]), row("No", [40, 60], [100, 100])] },
      { label: "Recommend", rows: [row("Yes", [20, 80], [100, 100]), row("No", [80, 20], [100, 100])] },
    ]);
    state.expectation = comparison({ answer: "Yes" });
    await evaluate();
    expect(state.modelCalls).toEqual([]);
    expect(stored().stance).toBe("inconclusive");
    expect(stored().summary).toMatch(/Could not find a matching row with answer "Yes"/);
  });

  it("preserved: a declared average with no average row is not given an answer to read", async () => {
    state.expectation = comparison({ measure: "mean" });
    await evaluate();
    expect(state.modelCalls).toEqual([]);
    expect(stored().stance).toBe("inconclusive");
  });

  // Codex review 2026-10-16 (gap 2): response membership is not intended meaning.
  const channels = () =>
    table([
      {
        label: "Purchase",
        rows: [row("Bought online", [60, 40], [100, 100]), row("Bought in store", [20, 40], [100, 100]), row("Did not buy", [20, 20], [100, 100])],
      },
    ]);

  it("Codex's channel case: a table-valid but arbitrary model choice is NOT computed; the researcher is asked to resolve it", async () => {
    state.table = channels();
    state.question = "Do men purchase more often than women?";
    state.supportsIf = "Men purchase more often than women";
    state.modelChoice = "1"; // "Bought online": exists in the table, but online alone changes the question
    await evaluate();
    const r = stored();
    expect(r.stance).toBe("inconclusive");
    expect(r.estimate.value).toBeNull();
    expect(r.summary).toMatch(/^Needs your resolution: .*does not say which of this table's answers \("Bought online", "Bought in store", "Did not buy"\) it compares/);
    expect(r.summary).toMatch(/no other reading was substituted/);
    expect(state.modelCalls.some((c) => c.tool === "record_stance")).toBe(false);
  });

  it("a choice the question's own words name, uniquely, is computed", async () => {
    state.table = channels();
    state.question = "Do men buy online more often than women?";
    state.supportsIf = "Men buy online more often";
    state.modelChoice = "1";
    await evaluate();
    expect(stored()).toMatchObject({ stance: "supports", basis: "computed" });
    expect(stored().summary).toContain('the share answering "Bought online"');
  });

  it("two exhaustive channels do not identify overall buying, but explicitly naming a channel does", async () => {
    state.table = table([{ label: "Purchase", rows: [row("Bought online", [60, 40], [100, 100]), row("Bought in store", [40, 60], [100, 100])] }]);
    state.question = "Do men purchase more often than women?";
    state.supportsIf = "Men purchase more often than women";
    state.modelChoice = "1";
    await evaluate();
    expect(stored()).toMatchObject({ stance: "inconclusive", estimate: { value: null } });
    expect(stored().summary).toMatch(/Needs your resolution/);
    state.question = "Do men buy online more often than women?";
    state.supportsIf = "Men buy online more often";
    await evaluate();
    expect(stored()).toMatchObject({ stance: "supports", basis: "computed" });
  });

  it("a binary question: the negative answer is not accepted for a question that does not ask about it", async () => {
    state.modelChoice = "2"; // "No"
    await evaluate();
    expect(stored().stance).toBe("inconclusive");
    expect(stored().summary).toMatch(/the matched answer "No" is the negative one/);
  });

  it("a binary question with a don't-know answer: the clear Yes is still computed", async () => {
    state.table = table([
      { label: "Purchase", rows: [row("Yes", [60, 40], [100, 100]), row("No", [35, 55], [100, 100]), row("Don't know", [5, 5], [100, 100])] },
    ]);
    state.modelChoice = "1";
    await evaluate();
    expect(stored()).toMatchObject({ stance: "supports", basis: "computed" });
  });
});
