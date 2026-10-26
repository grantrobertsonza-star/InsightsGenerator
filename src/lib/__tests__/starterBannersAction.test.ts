// StarterTabs with the researcher's columns to split by (Grant, 2026-10-22): the server action
// checks the chosen banners against the file before building anything, builds one draft table per
// chosen banner with the other questions as rows, and without a choice builds from the recognised
// ones (here Segment, a customer grouping). Runs the actual buildStarterTablesAction and planner;
// mocked: the dictionary read and the table build (the engine and database boundary), Next's helpers.
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ builds: [] as { columnVars: string[]; rowItems: { key: string }[]; starter?: boolean }[] }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("../verifyAfterGenerate", () => ({ verifyAfterGenerate: vi.fn() }));
vi.mock("../anthropic", () => ({ anthropic: {}, CLAUDE_MODEL: "test-model" }));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));
vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("../crosstabs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../crosstabs")>();
  const v = (name: string, nDistinct: number, extra: Record<string, unknown> = {}) => ({ name, label: name, numeric: true, nValid: 1000, pctValid: 100, nDistinct, labelled: true, weightLike: false, ...extra });
  return {
    ...actual,
    loadVariableDictionary: vi.fn(async () => ({
      nCases: 1000,
      variables: [v("Wave", 1), v("Segment", 3), v("Transferred", 2), v("WaitTimeVsExpectation", 5), v("Rating_0to10", 11)],
      sets: [],
    })),
    buildCrosstab: vi.fn(async (_t: string, _r: string, _d: string, request: { columnVars: string[]; rowItems: { key: string }[]; starter?: boolean }) => {
      state.builds.push(request);
      return { tableId: `t${state.builds.length}`, questions: request.rowItems.length, skipped: [] };
    }),
  };
});

const { buildStarterTablesAction } = await import("../crosstabActions");

beforeEach(() => {
  state.builds = [];
});

describe("buildStarterTablesAction with chosen banners", () => {
  it("without a choice, builds from the recognised grouping (Segment)", async () => {
    const r = await buildStarterTablesAction("run-1", "doc-1");
    expect(r).toMatchObject({ ok: true, tables: 1, banners: ["Segment"] });
    expect(state.builds.map((b) => b.columnVars)).toEqual([["Segment"]]);
    expect(state.builds[0].starter).toBe(true);
    expect(state.builds[0].rowItems.map((i) => i.key)).toEqual(["Transferred", "WaitTimeVsExpectation", "Rating_0to10"]);
  });

  it("builds one table per chosen banner, with the other questions as rows", async () => {
    const r = await buildStarterTablesAction("run-1", "doc-1", undefined, ["Transferred", "Segment"]);
    expect(r).toMatchObject({ ok: true, tables: 2, banners: ["Transferred", "Segment"] });
    expect(state.builds.map((b) => b.columnVars)).toEqual([["Transferred"], ["Segment"]]);
    // Rating_0to10 (11 answers) is a question here, not a column to split by (at most 10 answers).
    for (const b of state.builds) expect(b.rowItems.map((i) => i.key)).toEqual(["WaitTimeVsExpectation", "Rating_0to10"]);
  });

  it("refuses a choice that does not fit the file, and builds nothing", async () => {
    for (const [banners, message] of [
      [["Rating_0to10"], /Not a column to split by.*Rating_0to10/],
      [["Wave"], /Not a column to split by/],
      [["Nope"], /Nope/],
      [[], /at least one/],
      [["Segment", "Segment"], /twice/],
      ["Segment", /not understood/],
      [[1, 2], /not understood/],
    ] as [unknown, RegExp][]) {
      const r = await buildStarterTablesAction("run-1", "doc-1", undefined, banners);
      expect(r.ok, JSON.stringify(banners)).toBe(false);
      if (!r.ok) expect(r.error).toMatch(message);
    }
    expect(state.builds).toEqual([]);
  });
});
