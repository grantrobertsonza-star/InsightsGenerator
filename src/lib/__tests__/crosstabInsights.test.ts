// AI Insights on a crosstab (Grant, 2026-10-22: a 40-question starter table read as "No clear
// pattern emerged"). The table text carries every question whole, with bases, means and the table's
// own test results, up to a size limit, and says when it stopped; an empty or cut-off model answer is
// an error, never a "no pattern" reading. The model client is mocked; the table builder is real.
import { describe, expect, it, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({ response: null as unknown, requests: [] as { system: string; messages: { content: string }[] }[] }));
vi.mock("../anthropic", () => ({
  CLAUDE_MODEL: "test-model",
  anthropic: { messages: { create: vi.fn(async (req: never) => { state.requests.push(req); return state.response; }) } },
}));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn(async () => {}) }));

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
  it("an empty or cut-off answer is an error, not a 'no pattern' reading", async () => {
    state.response = tool({});
    await expect(summarizeCrosstabTable("t", "r", table(1))).rejects.toThrow("came back empty");
    state.response = tool({ headline: "  " }, "max_tokens");
    await expect(summarizeCrosstabTable("t", "r", table(1))).rejects.toThrow("cut off");
    // B4-F01: a cut-off answer that already has a headline and a card is still refused.
    state.response = tool({ headline: "A reports more", cards: [{ title: "Gap", body: "60% against 40%." }] }, "max_tokens");
    await expect(summarizeCrosstabTable("t", "r", table(1))).rejects.toThrow("The AI reading was cut off before it finished. Try again.");
    // A healthy read after a refusal succeeds.
    state.response = tool({ headline: "A reports more", cards: [{ title: "Gap", body: "60% against 40%." }] });
    const again = await summarizeCrosstabTable("t", "r", table(1));
    expect(again).toMatchObject({ headline: "A reports more", partial: null });
    expect(again.cards).toHaveLength(1);
  });
});
