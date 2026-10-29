// Codex's R1/D3a review (29 October 2026), rule-level repairs, each through the owning function:
//   D3A-F01 a box counts the codes its stated scale fixes (boxCodesFor + shareOfCodes), never the top answers present;
//   D3A-F02 an explicit "No" (or a non-answer) is never turned into "selected" (selectedCode);
//   D3A-F03 a change compares the same stage, variable and brand code, the code naming the same brand (changesAgainst).
import { describe, expect, it, vi } from "vitest";

// The owners live beside server code; nothing here reaches storage, the database or the model.
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));
vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
import { selectedCode, changesAgainst, type StageFigures } from "../trackerFigures";
import { boxCodesFor } from "../trackerCsmFigures";
import { shareOfCodes } from "../csmMetrics";
import { scaleTop } from "../trackerRoles";
import type { ChartSeries } from "../chartActions";

const series = (shares: Record<string, number>): ChartSeries => ({ name: "All", n: 100, bars: Object.entries(shares).map(([code, share]) => ({ label: code, pct: share, share, rawCode: code })) });

describe("D3A-F01: the box counts the stated codes", () => {
  const nine = Object.fromEntries([0, 1, 2, 3, 4, 5, 6, 7, 10].map((c) => [String(c), 100 / 9]));
  it("sparse 0 to 10 data without 8 and 9: only 10 counts (11.11%), not the top two present (22.22%)", () => {
    const box = boxCodesFor("switch", scaleTop({ name: "switch_0to10", label: "switch_0to10", numeric: true }))!;
    expect(box).toEqual({ codes: [8, 9, 10], text: "8 to 10" });
    expect(shareOfCodes(series(nine), box.codes).exact).toBeCloseTo(100 / 9, 10);
  });
  it("missing 8, missing 9, missing 10 each count as 0; a fully declared zero-count category changes nothing", () => {
    const base = { "0": 40, "8": 20, "9": 20, "10": 20 };
    expect(shareOfCodes(series({ "0": 60, "9": 20, "10": 20 }), [8, 9, 10]).exact).toBeCloseTo(40, 10);
    expect(shareOfCodes(series({ "0": 60, "8": 20, "10": 20 }), [8, 9, 10]).exact).toBeCloseTo(40, 10);
    expect(shareOfCodes(series({ "0": 60, "8": 20, "9": 20 }), [8, 9, 10]).exact).toBeCloseTo(40, 10);
    expect(shareOfCodes(series({ ...base, "5": 0 }), [8, 9, 10]).exact).toBeCloseTo(60, 10);
  });
  it("the scale comes from the answer list (non-answer codes 98, 99 left out), else the wording or name; never the data", () => {
    expect(scaleTop({ name: "q", label: "Switch", numeric: true, valueLabels: { "1": "Very unlikely", "5": "Very likely", "99": "Do not know" } })).toBe(5);
    expect(boxCodesFor("stay", 5)).toEqual({ codes: [4, 5], text: "top two" });
    expect(boxCodesFor("switch", 5)).toEqual({ codes: [4, 5], text: "top two" });
    expect(scaleTop({ name: "chg", label: "How likely to switch", numeric: true })).toBeNull();
    expect(boxCodesFor("switch", null)).toBeNull();
  });
  it("a suppressed bar makes the box unavailable, not 0", () => {
    const s = series({ "8": 10, "10": 20 });
    s.bars[0].share = null;
    expect(shareOfCodes(s, [8, 9, 10]).exact).toBeNull();
  });
});

describe("D3A-F02: an explicit No is never selected", () => {
  it("partial labels {0: Not applicable, 1: No}: not available", () => {
    expect(selectedCode({ valueLabels: { "0": "Not applicable", "1": "No" } }, ["0", "1"])).toBeNull();
  });
  it("all-negative labels and a lone label on 1: not available", () => {
    expect(selectedCode({ valueLabels: { "0": "No", "1": "Not sure" } }, ["0", "1"])).toBeNull();
    expect(selectedCode({ valueLabels: { "1": "No" } }, ["0", "1"])).toBeNull();
  });
  it("reversed coding {0: Yes, 1: No} selects 0; Yes absent from the data still selects its code", () => {
    expect(selectedCode({ valueLabels: { "0": "Yes", "1": "No" } }, ["0", "1"])).toBe("0");
    expect(selectedCode({ valueLabels: { "0": "No", "1": "Yes" } }, ["0"])).toBe("1");
  });
  it("only 0 labelled as the opposite of selected: 1 is selected; unlabelled 0/1: 1", () => {
    expect(selectedCode({ valueLabels: { "0": "Not selected" } }, ["0", "1"])).toBe("1");
    expect(selectedCode({}, ["0", "1"])).toBe("1");
    expect(selectedCode({}, ["1", "2"])).toBeNull();
  });
});

describe("D3A-F03: change only for the same stage, variable and brand", () => {
  const fig = (byBrand: { code: string; variable: string; share: number }[]): StageFigures[] => [{ stage: "awareness", group: "aware", label: "Aware", byBrand: byBrand.map((b) => ({ ...b, base: 100 })) }];
  it("the same variable with another brand code is not compared (was +20)", () => {
    const c = changesAgainst(fig([{ code: "2", variable: "Q1_1", share: 60 }]), fig([{ code: "1", variable: "Q1_1", share: 40 }]));
    expect(c[0]).toMatchObject({ changePp: null, reason: "Not asked about this brand in the previous wave." });
  });
  it("same variable and code: compared", () => {
    expect(changesAgainst(fig([{ code: "1", variable: "Q1_1", share: 60 }]), fig([{ code: "1", variable: "Q1_1", share: 40 }]))[0].changePp).toBeCloseTo(20, 10);
  });
  it("a code reused for another brand is not compared; a brand missing from the previous list says so", () => {
    const cur = fig([{ code: "1", variable: "Q1_1", share: 60 }]);
    const prev = fig([{ code: "1", variable: "Q1_1", share: 40 }]);
    expect(changesAgainst(cur, prev, { current: [{ code: "1", label: "Toyota" }], previous: [{ code: "1", label: "Kia" }] })[0]).toMatchObject({ changePp: null, reason: "Brand code 1 was Kia in the previous wave, so it is not compared." });
    expect(changesAgainst(cur, prev, { current: [{ code: "1", label: "Toyota" }], previous: [] })[0]).toMatchObject({ changePp: null, reason: "Brand code 1 is not in the previous wave's brand list." });
    expect(changesAgainst(cur, prev, { current: [{ code: "1", label: "Toyota" }], previous: [{ code: "1", label: " toyota " }] })[0].changePp).toBeCloseTo(20, 10);
  });
});
