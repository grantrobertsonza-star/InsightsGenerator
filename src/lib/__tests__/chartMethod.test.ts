// IR-10 (Codex, 2026-10-20): runDistributionAction reports how it actually built the bars. Codex's
// case: 26 unlabelled numeric answer values corrected to categorical come back from the engine as a
// "single" question with 26 answer rows, which is one bar per value, although the old caption rule
// (unlabelled, more than 25 distinct values) called it bins. The engine (crosstabs) is the mocked
// boundary; the action's own choice of path is what is tested.
import { beforeEach, describe, expect, it, vi } from "vitest";

// SEC2: the action's entry check that the project is the signed-in tenant's (helpers/ownedRun.ts).
vi.mock("../runOwnership", async () => (await import("./helpers/ownedRun")).ownedRunModule());
vi.mock("../crosstabs", () => ({
  loadVariableDictionaryWithStatus: vi.fn(),
  buildCrosstab: vi.fn(),
  loadCrosstab: vi.fn(),
}));
vi.mock("../dataSetup", () => ({ loadDataSetupWithStatus: vi.fn() }));
vi.mock("../db", () => ({ withTenant: vi.fn(), withTenantRead: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());

import { runDistributionAction } from "../chartActions";
import { histogramNote } from "../chartKinds";
import { buildCrosstab, loadCrosstab, loadVariableDictionaryWithStatus } from "../crosstabs";
import { loadDataSetupWithStatus } from "../dataSetup";

const dict = {
  // Unlabelled, 26 distinct values: the old rule would have said "bins".
  variables: [
    { name: "score", label: "Score", nValid: 78, nDistinct: 26, pctValid: 100, weightLike: false, inSet: null, labelled: false },
    { name: "gender", label: "Gender", nValid: 78, nDistinct: 2, pctValid: 100, weightLike: false, inSet: null, labelled: true },
  ],
  sets: [],
} as never;

const answerRow = (code: number) => ({ label: String(code), rawCode: String(code), total: { pct: 100 / 26, base: { n: 78 } }, pct: [], base: [] });

describe("runDistributionAction reports the method it applied", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadVariableDictionaryWithStatus).mockResolvedValue({ ok: true, dictionary: dict } as never);
    vi.mocked(loadDataSetupWithStatus).mockResolvedValue({ ok: true, setup: { unit: "respondents", layout: "rows_are_cases", method: "survey", accepted: false, wave: null, design: null } } as never);
    vi.mocked(buildCrosstab).mockResolvedValue({ tableId: "t1" } as never);
  });

  it("a corrected categorical with 26 unlabelled values is one bar per value", async () => {
    const rows = Array.from({ length: 26 }, (_, i) => answerRow(i + 1));
    vi.mocked(loadCrosstab).mockResolvedValue({ result: { weightVar: null, questions: [{ kind: "single", rows: [{ label: "Base", isBase: true, total: { pct: null }, base: [78] }, ...rows] }] } } as never);
    const r = await runDistributionAction("00000000-0000-4000-8000-0000000000cc", "doc-1", "score", null, null);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.result.series[0].bars).toHaveLength(26);
    expect(r.result.method).toBe("values");
    expect(histogramNote(r.result.method)).toMatch(/One bar per answer value/);
  });

  it("a continuous question with no answer categories uses the engine's bins", async () => {
    vi.mocked(loadCrosstab).mockResolvedValue({
      result: { weightVar: null, questions: [{ kind: "numeric", rows: [], desc: { n: 78, hist: [{ lo: 0, hi: 9, pct: 40 }, { lo: 10, hi: 19, pct: 60 }] } }] },
    } as never);
    const r = await runDistributionAction("00000000-0000-4000-8000-0000000000cc", "doc-1", "score", null, null);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.result.method).toBe("bins");
    expect(histogramNote(r.result.method)).toMatch(/range of values/);
  });

  it("a grouped distribution is one bar per answer value in each series", async () => {
    const rows = [1, 2, 3].map((c) => ({ label: String(c), rawCode: String(c), total: { pct: 33.3, base: { n: 26 } }, pct: [33.3, 33.3], base: [{ n: 13 }, { n: 13 }] }));
    vi.mocked(loadCrosstab).mockResolvedValue({
      result: { weightVar: null, columns: [{ name: "Female", n: 13 }, { name: "Male", n: 13 }], questions: [{ kind: "single", rows }] },
    } as never);
    const r = await runDistributionAction("00000000-0000-4000-8000-0000000000cc", "doc-1", "score", null, "gender");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.result.grouped).toBe(true);
    expect(r.result.series.map((x) => x.bars.length)).toEqual([3, 3]);
    expect(r.result.method).toBe("values");
  });
});
