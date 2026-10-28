// AI Insights on a crosstab (Grant, 2026-10-22: a 40-question starter table read as "No clear
// pattern emerged"). The table text carries every question whole, with bases, means and the table's
// own test results, up to a size limit, and says when it stopped; an empty or cut-off model answer is
// an error, never a "no pattern" reading. The model client is mocked; the table builder is real.
import { describe, expect, it, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({ response: null as unknown, queue: [] as unknown[], requests: [] as { system: string; max_tokens: number; messages: { content: string }[] }[] }));
vi.mock("../anthropic", () => ({
  CLAUDE_MODEL: "test-model",
  anthropic: { messages: { create: vi.fn(async (req: never) => { state.requests.push(req); return state.queue.length ? state.queue.shift() : state.response; }) } },
}));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn(async () => {}) }));
const traced = vi.hoisted(() => ({ rows: [] as unknown[][] }));
vi.mock("../db", () => ({
  withTenant: async (_t: string, fn: (c: { query: (sql: string, p: unknown[]) => Promise<unknown> }) => unknown) =>
    fn({ query: async (_sql: string, p: unknown[]) => { traced.rows.push(p); return { rows: [] }; } }),
}));

import { insightTableText, summarizeCrosstabTable } from "../crosstabInsights";
import type { CrosstabResult } from "../parseStatsFile";

const row = (label: string, pct: number[], total: number, extra: Record<string, unknown> = {}) => ({ label, pct, total: { pct: total, count: 100 }, count: pct.map(() => 50), sig: pct.map(() => 0), ...extra });
const question = (i: number, pad = 0) => ({
  label: `Question ${i}${"x".repeat(pad)}`,
  rows: [
    row("Base", [0, 0], 0, { isBase: true, count: [50, 50], total: { pct: null, count: 100 } }),
    row("Yes", [60, 40], 50, { sig: [1, -1] }),
    row("No", [40, 60], 50),
    row("Mean score: Q", [7.2, 6.1], 6.6, { isMean: true }),
  ],
});
const table = (n: number, pad = 0) => ({ columns: [{ name: "Segment1" }, { name: "Segment2" }], questions: Array.from({ length: n }, (_, i) => question(i + 1, pad)), provenance: { correction: "fdr", weightVar: null } }) as unknown as CrosstabResult;

beforeEach(() => {
  state.requests = [];
  state.queue = [];
  traced.rows = [];
});

describe("insightTableText", () => {
  it("carries bases, means and the test flags with the correction applied", () => {
    const t = insightTableText(table(1));
    expect(t.text).toContain("after a false discovery rate correction");
    expect(t.text).toContain("Base: 50 | 50 | 100");
    expect(t.text).toContain("Yes: 60 (higher) | 40 (lower) | 50");
    expect(t.text).toContain("No: 40 | 60 | 50");
    expect(t.text).toContain("Mean score: Q [mean]: 7.2 | 6.1 | 6.6");
    expect(t).toMatchObject({ questionsShown: 1, questionsTotal: 1 });
  });
  it("a large table: whole questions up to the limit, never one cut part way, with the count", () => {
    const t = insightTableText(table(40, 800));
    expect(t.questionsTotal).toBe(40);
    expect(t.questionsShown).toBeGreaterThan(5);
    expect(t.questionsShown).toBeLessThan(40);
    expect(t.text.length).toBeLessThanOrEqual(30_000);
    // The last question included is complete (its last row is there).
    expect(t.text.trimEnd().endsWith("Mean score: Q [mean]: 7.2 | 6.1 | 6.6")).toBe(true);
    // A 40-question starter table of ordinary size fits whole.
    expect(insightTableText(table(40)).questionsShown).toBe(40);
  });
});

describe("insightTableText: whole-table tests and spread (batch 47)", () => {
  it("names each question's whole-table test with its verdict, and the average and spread of a coded question", () => {
    const t = table(1);
    const q = t.questions[0] as unknown as Record<string, unknown>;
    q.tableTests = [
      { block: 0, label: "Segment", chi2: 14.2, df: 2, p: 0.0008, nEff: 100, deff: null, cramersV: 0.27 },
      { block: 1, label: "Region", chi2: 1.1, df: 2, p: 0.58, nEff: 100, deff: null },
    ];
    q.desc = { n: 100, nEff: 100, mean: 6.62, sd: 2.18, variance: 4.75, sem: 0.22, min: 0, max: 10, range: 10, p25: 5, median: 7, p75: 8 };
    const text = insightTableText(t).text;
    expect(text).toContain("Whole-table test by Segment: chi-square p=<0.001, Cramer's V=0.27 (the answers differ across these columns at 95%)");
    expect(text).toContain("Whole-table test by Region: chi-square p=0.580 (no difference across these columns at 95%)");
    expect(text).toContain("Average answer code, all respondents: mean 6.6, standard deviation 2.2, n=100");
  });
  it("a question with no whole-table test or codes gets no such lines (nothing invented)", () => {
    const text = insightTableText(table(1)).text;
    expect(text).not.toContain("Whole-table test");
    expect(text).not.toContain("Average answer code");
  });
});

describe("summarizeCrosstabTable", () => {
  const tool = (input: unknown, stop = "tool_use") => ({ content: [{ type: "tool_use", id: "t", name: "record_insights", input }], stop_reason: stop, usage: { input_tokens: 1, output_tokens: 1 } });
  it("returns the reading, and says how much of the table it read", async () => {
    state.response = tool({ headline: "Segment1 says yes more often.", cards: [{ title: "Gap", body: "60% against 40%." }] });
    const r = await summarizeCrosstabTable("t", "r", table(40, 800));
    expect(r.headline).toBe("Segment1 says yes more often.");
    expect(r.cards).toHaveLength(1);
    expect(r.partial?.questionsTotal).toBe(40);
    expect(state.requests[0].messages[0].content).toMatch(/^Table \(the first \d+ of its 40 questions; the rest did not fit\):/);
    expect(state.requests[0].system).toContain("Call a difference significant only when it is marked");
  });
  it("batch 47: a headline with no cards is refused, and the next healthy read succeeds", async () => {
    state.response = tool({ headline: "No clear pattern.", cards: [] });
    await expect(summarizeCrosstabTable("t", "r", table(1))).rejects.toThrow("came back without any patterns described");
    state.response = tool({ headline: "No clear pattern.", cards: [{ title: "", body: "" }] });
    await expect(summarizeCrosstabTable("t", "r", table(1))).rejects.toThrow("came back without any patterns described");
    state.response = tool({ headline: "Segment1 says yes more often.", cards: [{ title: "Gap", body: "60% against 40%." }] });
    expect((await summarizeCrosstabTable("t", "r", table(1))).cards).toHaveLength(1);
    expect(state.requests.at(-1)!.system).toContain("Whole-table test");
  });
  it("batch 49: an empty first answer is retried once with more room, and the second healthy answer is the reading", async () => {
    state.queue = [tool({})];
    state.response = tool({ headline: "Segment1 says yes more often.", cards: [{ title: "Gap", body: "60% against 40%." }] });
    const r = await summarizeCrosstabTable("t", "r", table(1));
    expect(r.headline).toBe("Segment1 says yes more often.");
    expect(state.requests.map((q) => q.max_tokens)).toEqual([1500, 3000]);
  });
  it("batch 49: the error says what came back, and how much of the table was sent", async () => {
    state.response = { content: [{ type: "text", text: "I cannot" }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } };
    await expect(summarizeCrosstabTable("t", "r", table(1))).rejects.toThrow(
      /no reading was returned \(stop: end_turn; returned: text\).*It was sent 1 of the table's 1 questions, [\d,]+ characters\. Try again, or read a smaller table\./,
    );
  });
  it("batch 49: a reading wrapped in one field, or sent as JSON text, is read; the failure says the shape, never the text", async () => {
    const reading = { headline: "A reports more", cards: [{ title: "Gap", body: "60% against 40%." }] };
    state.response = tool({ reading });
    expect((await summarizeCrosstabTable("t", "r", table(1))).headline).toBe("A reports more");
    state.response = tool({ input: JSON.stringify(reading) });
    expect((await summarizeCrosstabTable("t", "r", table(1))).cards).toHaveLength(1);
    // Two fields, neither a headline: not guessed at. The error and the trace name the fields and types only.
    state.response = tool({ summary: "Segment A says yes more often, by 20 points", points: ["60% against 40%"] });
    await expect(summarizeCrosstabTable("t", "r", table(1))).rejects.toThrow("the reading had no headline (fields returned: summary (string), points (list))");
    const detail = traced.rows.map((r) => JSON.parse(String(r[2])));
    expect(detail).toEqual([
      { reason: "the reading had no headline (fields returned: summary (string), points (list))" },
      { reason: "the reading had no headline (fields returned: summary (string), points (list))" },
    ]);
    expect(JSON.stringify(detail)).not.toContain("20 points");
  });
  it("B49-F02: malformed cards and a missing reading are traced like a missing headline, by shape only", async () => {
    state.response = tool({ headline: "Segment A says yes more often, by 20 points", cards: { unexpected: true } });
    await expect(summarizeCrosstabTable("t", "r", table(1))).rejects.toThrow(
      "the reading came back without any patterns described (fields returned: headline (string), cards (object))",
    );
    expect(state.requests.map((q) => q.max_tokens)).toEqual([1500, 3000]);
    const cardsTrace = traced.rows.map((r) => JSON.parse(String(r[2])));
    expect(cardsTrace).toEqual([
      { reason: "the reading came back without any patterns described (fields returned: headline (string), cards (object))" },
      { reason: "the reading came back without any patterns described (fields returned: headline (string), cards (object))" },
    ]);
    expect(JSON.stringify(cardsTrace)).not.toContain("20 points");
    traced.rows.length = 0;
    state.response = { content: [{ type: "text", text: "I cannot read this table" }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } };
    await expect(summarizeCrosstabTable("t", "r", table(1))).rejects.toThrow(/no reading was returned/);
    const none = traced.rows.map((r) => JSON.parse(String(r[2])));
    expect(none).toEqual([{ reason: "no reading was returned (stop: end_turn; returned: text)" }, { reason: "no reading was returned (stop: end_turn; returned: text)" }]);
    expect(JSON.stringify(none)).not.toContain("cannot read");
  });
  it("batch 49: cards sent as JSON text are read as the list they are", async () => {
    state.response = tool({ headline: "A reports more", cards: JSON.stringify([{ title: "Gap", body: "60% against 40%." }]) });
    expect((await summarizeCrosstabTable("t", "r", table(1))).cards).toEqual([{ title: "Gap", stat: undefined, body: "60% against 40%." }]);
    expect(state.requests).toHaveLength(1);
  });
  it("an empty or cut-off answer is an error, not a 'no pattern' reading", async () => {
    // Batch 49: each failure is retried once, and the error names what came back both times.
    state.response = tool({});
    await expect(summarizeCrosstabTable("t", "r", table(1))).rejects.toThrow(/^The AI reading failed twice: the reading had no headline \(fields returned: none\) \(first try: the reading had no headline/);
    state.response = tool({ headline: "  " }, "max_tokens");
    await expect(summarizeCrosstabTable("t", "r", table(1))).rejects.toThrow("the answer was cut off at 3000 tokens (first try: the answer was cut off at 1500 tokens)");
    // B4-F01: a cut-off answer that already has a headline and a card is still refused.
    state.response = tool({ headline: "A reports more", cards: [{ title: "Gap", body: "60% against 40%." }] }, "max_tokens");
    await expect(summarizeCrosstabTable("t", "r", table(1))).rejects.toThrow(/cut off at 3000 tokens/);
    // A healthy read after a refusal succeeds.
    state.response = tool({ headline: "A reports more", cards: [{ title: "Gap", body: "60% against 40%." }] });
    const again = await summarizeCrosstabTable("t", "r", table(1));
    expect(again).toMatchObject({ headline: "A reports more", partial: null });
    expect(again.cards).toHaveLength(1);
  });
});
