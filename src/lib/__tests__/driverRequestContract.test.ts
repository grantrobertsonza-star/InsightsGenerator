// GT1000-F02 (Codex, 2026-10-21): the driver actions took a TypeScript DriverRequest on trust. A
// bootstrap of "disabled" became NaN, skipped the resampling and returned success with no intervals
// and no warning; an "ordinal" outcome ran the logistic branch and was described as a number. One
// runtime contract (driverRequest.ts) now refuses such requests at the server boundary, before any
// file read, calculation or write, and the engine itself refuses them too and says when it drew
// fewer resamples than asked. The action tests reach the actual server actions; only the file
// boundary (storage and the statistics reader) is mocked, to show it is never reached.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { driverAnalysis } from "../driverAnalysis";
import { DEFAULT_BOOTSTRAP, MAX_BOOTSTRAP, MIN_BOOTSTRAP, parseDriverRequest } from "../driverRequest";

const reads = vi.hoisted(() => ({ file: 0, stats: 0 }));
// SEC2: the action's entry check that the project is the signed-in tenant's (helpers/ownedRun.ts).
vi.mock("../runOwnership", async () => (await import("./helpers/ownedRun")).ownedRunModule());
vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("../verifyAfterGenerate", () => ({ verifyAfterGenerate: vi.fn(async () => {}) }));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));
vi.mock("../parseStatsFile", () => ({ runStatsTool: vi.fn(async () => { reads.stats++; throw new Error("synthetic: the statistics reader must not be reached"); }) }));
vi.mock("../crosstabs", async (orig) => ({
  ...(await orig<typeof import("../crosstabs")>()),
  loadDocumentFile: vi.fn(async () => { reads.file++; throw new Error("synthetic: the data file must not be read"); }),
  overlayFor: vi.fn(async () => null),
}));
vi.mock("../dataSetup", async (orig) => ({ ...(await orig<typeof import("../dataSetup")>()), loadDataSetupWithStatus: vi.fn(async () => ({ ok: false, error: "synthetic" })) }));
vi.mock("../variableOverrides", async (orig) => ({ ...(await orig<typeof import("../variableOverrides")>()), loadVariableOverrides: vi.fn(async () => ({})) }));

const valid = { outcome: "Y", outcomeType: "continuous", topBoxMin: null, predictors: ["X1", "X2"], weightVar: null, statedImportance: {}, groupVar: null };

describe("parseDriverRequest: the one runtime contract (GT1000-F02)", () => {
  it("accepts a well-formed request and returns it unchanged, defaulting nothing it was not given", () => {
    const r = parseDriverRequest(valid);
    expect(r).toEqual({ ok: true, request: valid });
    expect(parseDriverRequest({ ...valid, bootstrap: 0 }).ok).toBe(true);
    expect(parseDriverRequest({ ...valid, bootstrap: MIN_BOOTSTRAP }).ok).toBe(true);
    expect(parseDriverRequest({ ...valid, bootstrap: MAX_BOOTSTRAP }).ok).toBe(true);
    expect(parseDriverRequest({ ...valid, outcomeType: "binary", topBoxMin: 4, weightVar: "W", groupVar: "G", statedImportance: { X1: "IMP1" } }).ok).toBe(true);
  });

  it.each([
    ["a bootstrap of \"disabled\"", { ...valid, bootstrap: "disabled" }, /whole number/],
    ["a NaN bootstrap", { ...valid, bootstrap: Number.NaN }, /whole number/],
    ["a fractional bootstrap", { ...valid, bootstrap: 20.5 }, /whole number/],
    ["a negative bootstrap", { ...valid, bootstrap: -1 }, /0 \(no ranges\) or from 20 to 300/],
    ["a bootstrap too small to give ranges", { ...valid, bootstrap: 5 }, /0 \(no ranges\) or from 20 to 300/],
    ["a bootstrap above the cap", { ...valid, bootstrap: 301 }, /0 \(no ranges\) or from 20 to 300/],
    ["an unsupported outcome type", { ...valid, outcomeType: "ordinal" }, /"continuous" or "binary"/],
    ["a missing outcome", { ...valid, outcome: "" }, /outcome variable/],
    ["one predictor", { ...valid, predictors: ["X1"] }, /at least two/],
    ["a predictor twice", { ...valid, predictors: ["X1", "X1"] }, /twice/],
    ["the outcome as a predictor", { ...valid, predictors: ["Y", "X1"] }, /outcome cannot also be a predictor/],
    ["a non-string predictor", { ...valid, predictors: ["X1", 7] }, /list of variable names/],
    ["a top box on a continuous outcome", { ...valid, topBoxMin: 4 }, /binary outcome/],
    ["a non-finite top box", { ...valid, outcomeType: "binary", topBoxMin: Number.POSITIVE_INFINITY }, /must be a number/],
    ["the weight as a predictor", { ...valid, weightVar: "X1" }, /weight cannot also be/],
    ["the group as a predictor", { ...valid, groupVar: "X2" }, /group variable cannot also be/],
    ["stated importance for a non-predictor", { ...valid, statedImportance: { X9: "IMP" } }, /not a predictor/],
    ["not an object", "Y by X1, X2", /not a request/],
  ])("refuses %s", (_label, raw, message) => {
    const r = parseDriverRequest(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(message);
  });
});

/** 120 deterministic cases; Y depends on X1 strongly and X2 a little. */
function sample(binary = false) {
  let seed = 11;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const x = Array.from({ length: 120 }, () => [Math.round(rand() * 10), Math.round(rand() * 10)]);
  const y = x.map(([a, b]) => 2 + 0.6 * a + 0.2 * b + rand() * 2);
  return { x, y: binary ? y.map((v) => (v > 6 ? 1 : 0)) : y, names: ["X1", "X2"] };
}

describe("driverAnalysis: the method described is the method that ran (GT1000-F02)", () => {
  it("refuses an unsupported outcome type and a non-integer bootstrap instead of returning a report", () => {
    const s = sample();
    expect(driverAnalysis({ ...s, outcome: "ordinal" as never })).toEqual({ error: expect.stringMatching(/Unsupported outcome type/) });
    expect(driverAnalysis({ ...s, outcome: "continuous", bootstrap: Number.NaN })).toEqual({ error: expect.stringMatching(/whole number/) });
    expect(driverAnalysis({ ...s, outcome: "continuous", bootstrap: "disabled" as never })).toEqual({ error: expect.stringMatching(/whole number/) });
  });

  it("a bootstrap of 0 gives no intervals and says so; a healthy bootstrap gives intervals; the figures are the same", () => {
    const s = sample();
    const none = driverAnalysis({ ...s, outcome: "continuous", bootstrap: 0, seed: 1 });
    const some = driverAnalysis({ ...s, outcome: "continuous", bootstrap: 20, seed: 1 });
    if ("error" in none || "error" in some) throw new Error("unexpected engine refusal");
    expect(none.rows.every((r) => r.shareLow === null && r.shareHigh === null)).toBe(true);
    expect(none.warnings.join(" ")).toMatch(/No bootstrap ranges were drawn/);
    expect(some.rows.every((r) => r.shareLow !== null && r.shareHigh !== null)).toBe(true);
    expect(some.warnings.join(" ")).not.toMatch(/bootstrap/i);
    expect(none.fit.rSquared).toBe(some.fit.rSquared);
    expect(none.rows.map((r) => r.share)).toEqual(some.rows.map((r) => r.share));
  });

  it("a binary exact split capped below the requested resamples says how many it drew", () => {
    const s = sample(true);
    const r = driverAnalysis({ ...s, outcome: "binary", seed: 1 });
    if ("error" in r) throw new Error(r.error);
    expect(r.method).toBe("shapley");
    expect(DEFAULT_BOOTSTRAP).toBeGreaterThan(60);
    expect(r.warnings.join(" ")).toMatch(/use 60 resamples/);
    expect(r.warnings.join(" ")).toMatch(/binary outcome split exactly/);
  });

  // M-R1000-01: called directly, the engine accepts what the server policy refuses (1 to 19, above
  // 300) and says what it drew; a continuous cap is not explained as a binary one.
  it("called directly, 19 resamples run with no ranges and 301 are drawn at 300, each said truthfully", () => {
    const s = sample();
    const few = driverAnalysis({ ...s, outcome: "continuous", bootstrap: 19, seed: 1 });
    const many = driverAnalysis({ ...s, outcome: "continuous", bootstrap: 301, seed: 1 });
    if ("error" in few || "error" in many) throw new Error("unexpected engine refusal");
    expect(few.rows.every((r) => r.shareLow === null)).toBe(true);
    expect(few.warnings.join(" ")).toMatch(/Only 19 bootstrap resamples/);
    expect(many.rows.every((r) => r.shareLow !== null)).toBe(true);
    expect(many.warnings.join(" ")).toMatch(/use 300 resamples, the most drawn here/);
    expect(many.warnings.join(" ")).not.toMatch(/binary/);
  });
});

describe("driver actions refuse a malformed request before any read or write of the project's data (GT1000-F02)", () => {
  beforeEach(() => {
    reads.file = 0;
    reads.stats = 0;
  });

  it.each([
    ["bootstrap \"disabled\"", { ...valid, bootstrap: "disabled" }],
    ["outcome type \"ordinal\"", { ...valid, outcomeType: "ordinal" }],
    ["bootstrap 5", { ...valid, bootstrap: 5 }],
  ])("run: %s is refused with the reason and nothing is read", async (_label, request) => {
    const { runDriverAnalysisAction } = await import("../driverActions");
    const r = await runDriverAnalysisAction("00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002", request as never);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/This driver analysis request cannot be run/);
    expect(reads.file).toBe(0);
    expect(reads.stats).toBe(0);
  });

  it("save: a result whose request is malformed is refused before anything of the project is read or written (the entry ownership check aside)", async () => {
    const { saveDriverAnalysisAction } = await import("../driverActions");
    const s = sample();
    const result = driverAnalysis({ ...s, outcome: "continuous", bootstrap: 20, seed: 1 });
    const r = await saveDriverAnalysisAction("00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002", "Bad", {
      request: { ...valid, outcomeType: "ordinal" },
      outcomeLabel: "Y",
      outcomeNote: "",
      casesInFile: 120,
      weighted: false,
      skipped: [],
      result,
      performance: [],
    } as never);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/This driver analysis request cannot be run/);
  });
});
