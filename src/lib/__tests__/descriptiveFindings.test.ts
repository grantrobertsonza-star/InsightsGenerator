import { describe, it, expect } from "vitest";
import { levelFindings, noDifferenceFindings } from "../descriptiveFindings";
import type { CrosstabResult, CrosstabRow } from "../parseStatsFile";

const base = { n: 400, w: 400, nEff: 400 };
function row(label: string, pct: number, extra: Partial<CrosstabRow> = {}): CrosstabRow {
  return {
    label,
    count: [null, null],
    pct: [pct, pct],
    rowPct: [null, null],
    p: [null, null],
    sig: [0, 0],
    base: [base, base],
    total: { count: null, pct, base },
    ...extra,
  } as CrosstabRow;
}
function table(questions: CrosstabResult["questions"], extra: Partial<CrosstabResult> = {}): CrosstabResult {
  return {
    version: 2,
    weightVar: null,
    weightLabel: null,
    overall: true,
    blocks: [{ var: "g", label: "Gender" }],
    columns: [
      { block: 0, blockLabel: "Gender", name: "Men", n: 200, w: 200, nEff: 200 },
      { block: 0, blockLabel: "Gender", name: "Women", n: 200, w: 200, nEff: 200 },
    ],
    total: base,
    questions,
    skipped: [],
    ...extra,
  } as CrosstabResult;
}

describe("levelFindings", () => {
  it("reads top two and bottom two box from a satisfaction scale, in either direction", () => {
    const asc = table([
      {
        key: "q1",
        label: "Overall satisfaction",
        kind: "single",
        rows: [row("Very satisfied", 30), row("Satisfied", 35), row("Neutral", 15), row("Dissatisfied", 12), row("Very dissatisfied", 8)],
      },
    ]);
    const [f] = levelFindings(asc);
    expect(f.stats.testType).toBe("top_two_box");
    expect(f.stats.value).toBe(65);
    expect(f.stats.bottomTwo).toBe(20);

    const desc = table([
      {
        key: "q1",
        label: "Overall satisfaction",
        kind: "single",
        rows: [row("Very dissatisfied", 8), row("Dissatisfied", 12), row("Neutral", 15), row("Satisfied", 35), row("Very satisfied", 30)],
      },
    ]);
    expect(levelFindings(desc)[0].stats.value).toBe(65);
  });

  it("a Not sure answer after the scale is a non-answer (the engine's rule), never a scale point (registry gap closed)", () => {
    const t = table([
      {
        key: "q1",
        label: "Overall satisfaction",
        kind: "single",
        rows: [row("Very satisfied", 30), row("Satisfied", 35), row("Neutral", 15), row("Dissatisfied", 12), row("Very dissatisfied", 8), row("Not sure", 10)],
      },
    ]);
    const [f] = levelFindings(t);
    expect(f.stats.testType).toBe("top_two_box");
    expect(f.stats.value).toBe(65);
    expect(f.stats.bottomTwo).toBe(20);
  });

  it("a don't-know naming its subject is an answer and can lead (Grant's decision 7)", () => {
    const t = table([{ key: "q2", label: "Brand used", kind: "single", rows: [row("Brand A", 20), row("Don't know which brand", 50), row("Don't know", 30)] }]);
    const f = levelFindings(t).find((x) => x.stats.question === "Brand used" || String(x.text ?? "").includes("Brand used"));
    expect(JSON.stringify(f ?? levelFindings(t))).toContain("Don't know which brand");
  });

  it("computes NPS from a 0 to 10 question", () => {
    // 0-6: 40% in all, 7-8: 20%, 9-10: 40%.
    const rows = Array.from({ length: 11 }, (_, k) => row(String(k), k >= 9 ? 20 : k >= 7 ? 10 : 40 / 7));
    const [f] = levelFindings(table([{ key: "q", label: "Likelihood to recommend", kind: "single", rows }]));
    expect(f.stats.testType).toBe("nps");
    expect(f.stats.promoters).toBe(40);
    expect(f.stats.detractors).toBe(40);
    expect(f.stats.value).toBe(0);
    expect((f.stats.lo as number) < 0 && (f.stats.hi as number) > 0).toBe(true);
  });

  it("skips a small base and never calls anything a difference", () => {
    const small = { n: 12, w: 12, nEff: 12 };
    const r = row("Yes", 50, { total: { count: null, pct: 50, base: small } });
    expect(levelFindings(table([{ key: "q", label: "Q", kind: "single", rows: [r, row("No", 50, { total: { count: null, pct: 50, base: small } })] }]))).toHaveLength(0);
    const f = levelFindings(table([{ key: "q", label: "Brand awareness", kind: "single", rows: [row("Aware", 70), row("Not aware", 30)] }]))[0];
    expect(/differ/i.test(f.text)).toBe(false);
    expect(f.patternType).toBe("level");
  });
});

describe("noDifferenceFindings", () => {
  it("keeps a clean no-difference result and skips a table with a significant cell", () => {
    const quiet = table(
      [{ key: "q", label: "Satisfaction", kind: "single", rows: [row("Yes", 60, { p: [0.4, 0.4] }), row("No", 40, { p: [0.4, 0.4] })] }],
      { overall: false },
    );
    const r = noDifferenceFindings(quiet);
    expect(r).toHaveLength(1);
    expect(r[0].patternType).toBe("no_difference");

    const loud = table(
      [{ key: "q", label: "Satisfaction", kind: "single", rows: [row("Yes", 60, { p: [0.01, 0.01], sig: [1, -1] }), row("No", 40, { p: [0.4, 0.4] })] }],
      { overall: false },
    );
    expect(noDifferenceFindings(loud)).toHaveLength(0);
  });
});
