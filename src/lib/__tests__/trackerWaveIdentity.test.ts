// R5 waves: the pure rules of wave-on-wave change. Which wave is compared (comparisonTarget, compareChoiceFrom), the
// identity of a question and an answer across waves (questionDiffers, answerDiffers), a change from two shares
// (shareChange), and the test states the app decides before the engine is asked, and after it fails (attachTests;
// the engine itself is the mocked boundary here, its arithmetic is pinned in scripts/crosstab_selftest.py and
// trackerWaveChange.db.test.ts).
import { describe, expect, it, vi } from "vitest";

const engine = vi.hoisted(() => ({ fail: false, pairs: [] as unknown[] }));
vi.mock("../parseStatsFile", () => ({
  runShareChangeTests: async (pairs: { id: string }[]) => {
    engine.pairs = pairs;
    if (engine.fail) throw new Error("The statistics worker stopped. Try again.");
    return { level: 0.05, minBase: 30, minEffectiveBase: 30, results: pairs.map((p) => ({ id: p.id, tested: true, reason: null, method: "pooled_effective_base", z: 2.5, p: 0.0124, significant: true, direction: 1 })) };
  },
}));
vi.mock("../crosstabs", () => ({ loadDocumentFile: async () => ({ storage_path: "x", source_filename: "x.sav" }) }));
vi.mock("../waveFiles", () => ({ loadProjectWaves: async () => ({ included: [], excluded: [], basis: { kind: "fieldwork_date" } }) }));
vi.mock("../trackerWaveContext", () => ({ loadWaveContext: async () => ({}) }));

const { answerDiffers, questionDiffers } = await import("../trackerFigures");
const { attachTests, compareChoiceFrom, comparisonTarget, shareChange, waveListOf } = await import("../trackerWaveChange");

const wave = (n: number, date: string | null = `2026-0${n}`) => ({ documentId: `00000000-0000-4000-8000-00000000000${n}`, filename: `w${n}.sav`, wave: `Wave ${n}`, waveDate: date, uploadedAt: `2026-01-0${n}` });
const waves = { included: [wave(1), wave(2), wave(3)], excluded: [wave(9)], basis: { kind: "fieldwork_date" as const } };

describe("which wave is compared", () => {
  it("the previous included wave by default; an earlier wave when chosen; None; refusals with the reason", () => {
    expect(comparisonTarget(waves, wave(3).documentId, "previous")).toMatchObject({ status: "target", wave: { wave: "Wave 2" } });
    expect(comparisonTarget(waves, wave(3).documentId, { documentId: wave(1).documentId })).toMatchObject({ status: "target", wave: { wave: "Wave 1" } });
    expect(comparisonTarget(waves, wave(3).documentId, "none")).toEqual({ status: "off", reason: "Compare with: None, so no change is shown." });
    expect(comparisonTarget(waves, wave(1).documentId, "previous")).toEqual({ status: "none", reason: "This is the earliest wave of this project." });
    expect(comparisonTarget(waves, wave(2).documentId, { documentId: wave(3).documentId })).toMatchObject({ status: "none", reason: expect.stringMatching(/not earlier/) });
    expect(comparisonTarget(waves, wave(3).documentId, { documentId: wave(9).documentId })).toMatchObject({ status: "none", reason: expect.stringMatching(/not an included wave/) });
    expect(comparisonTarget(waves, wave(9).documentId, "previous")).toMatchObject({ status: "none", reason: expect.stringMatching(/not an included wave of this project/) });
  });

  it("the screen's choice is checked at the boundary: previous, none or a file id; anything else refused", () => {
    expect([compareChoiceFrom(undefined), compareChoiceFrom("previous"), compareChoiceFrom("none")]).toEqual(["previous", "previous", "none"]);
    expect(compareChoiceFrom(wave(1).documentId)).toEqual({ documentId: wave(1).documentId });
    expect([compareChoiceFrom("Wave 1"), compareChoiceFrom(3), compareChoiceFrom({ documentId: "x" })]).toEqual([null, null, null]);
  });

  it("the selector's list: included waves in their order, excluded named, undated waves said", () => {
    const l = waveListOf({ included: [wave(1), wave(2, null)], excluded: [wave(9)], basis: { kind: "upload", undated: ["Wave 2"] } }, wave(2).documentId);
    expect(l.included.map((w) => w.wave)).toEqual(["Wave 1", "Wave 2"]);
    expect(l.excluded.map((w) => w.wave)).toEqual(["Wave 9"]);
    expect(l.undated).toEqual(["Wave 2"]);
    expect(l.orderText).toMatch(/"Wave 2" has no fieldwork date/);
    expect(l.current).toBe(1);
  });
});

describe("identity across waves", () => {
  const v = (label: string, valueLabels?: Record<string, string>) => ({ label, valueLabels });
  it("a question is the same with the same variable, wording (case and spacing ignored) and answer codes", () => {
    expect(questionDiffers("wom_b01", v("Word of mouth BMW", { 1: "Mainly positive", 2: "Mainly negative" }), v("word of  mouth bmw ", { 1: "Mainly positive", 2: "Mainly negative" }))).toBeNull();
    expect(questionDiffers("wom_b01", v("Word of mouth BMW", { 1: "a", 2: "b", 6: "c" }), v("Word of mouth BMW", { 1: "a", 2: "b" }))).toBe(
      "The answer codes of wom_b01 changed between the waves (1, 2 then, 1, 2, 6 now), so it is not compared.",
    );
    expect(questionDiffers("relevant_c01", v("Replacing an unreliable car"), v("Replacing an old car"))).toMatch(/^The wording of relevant_c01 changed between the waves/);
    expect(questionDiffers("x", v("X"), undefined)).toBe("x is not in the compared wave's file.");
    // Labels changed but the codes are the same: still the same question; the answer rule then checks each code.
    expect(questionDiffers("age_band", v("Age group", { 1: "18-24", 2: "25-34" }), v("Age group", { 1: "18 to 24", 2: "25-34" }))).toBeNull();
  });
  it("an answer is the same when its code names the same answer; a renamed code is not compared", () => {
    expect(answerDiffers("2", { valueLabels: { 2: "25-34" } }, { valueLabels: { 2: "25-34" } })).toBeNull();
    expect(answerDiffers("1", { valueLabels: { 1: "18 to 24" } }, { valueLabels: { 1: "18-24" } })).toBe("Answer code 1 was 18-24 in the compared wave, so it is not compared.");
    expect(answerDiffers("1", {}, {})).toBeNull();
  });
});

describe("a change and its test", () => {
  const stat = { nEff: 800, designApplied: false, se: null, designDf: null };
  it("unrounded difference in points; withheld, missing and unknown sides give no change with the reason", () => {
    expect(shareChange({ share: 41.25, base: 1000, stat }, { share: 38.5, base: 1000, stat }, null).change).toEqual({ current: 41.25, previous: 38.5, changePp: 2.75 });
    expect(shareChange({ share: 41.25, base: 1000 }, { share: 38.5, base: 1000 }, "Brand code 10 was Haval in the compared wave, so it is not compared.")).toEqual({
      change: { current: 41.25, previous: null, changePp: null, reason: "Brand code 10 was Haval in the compared wave, so it is not compared." },
      job: null,
    });
    expect(shareChange({ share: 41.25, base: 1000 }, undefined, null).change.reason).toBe("Not in the compared wave.");
    expect(shareChange({ share: null, base: 8, reason: "Suppressed for a small base." }, { share: 3, base: 900 }, null).change).toMatchObject({ changePp: null, reason: "Not available in this wave: Suppressed for a small base." });
  });

  it("tests what can be tested; says why the rest is not; a failed engine request is 'failed', never 'not significant'", async () => {
    const jobs = [
      shareChange({ share: 41.25, base: 1000, stat }, { share: 38.5, base: 1000, stat }, null).job!,
      shareChange({ share: 41.25, base: 1000 }, { share: 38.5, base: 1000, stat }, null).job!,
      shareChange({ share: 41.25, base: 1000, stat: { ...stat, designApplied: true } }, { share: 38.5, base: 1000, stat: { ...stat, designApplied: true } }, null).job!,
      shareChange({ share: 41.25, base: 40, stat }, { share: 38.5, base: 40, stat }, null, "Fewer than 50 recent acquirers in one of the two waves: described only, not tested.").job!,
    ];
    engine.fail = false;
    const ok = await attachTests(jobs, { storagePath: "x", sourceFilename: "x.sav" });
    expect(ok).toEqual({ failed: null, designBased: false });
    expect(engine.pairs).toEqual([{ id: "0", previous: { pct: 38.5, n: 1000, nEff: 800, se: null, designDf: null }, current: { pct: 41.25, n: 1000, nEff: 800, se: null, designDf: null } }]);
    expect(jobs.map((j) => j.change.test)).toEqual([
      { status: "tested", z: 2.5, p: 0.0124, significant: true, direction: 1, method: "pooled_effective_base" },
      { status: "untested", reason: "The effective base of one of the two waves is not known, so the change is not tested." },
      { status: "untested", reason: "A survey design is applied, and no design-based variance is available for this figure, so the change is not tested." },
      { status: "untested", reason: "Fewer than 50 recent acquirers in one of the two waves: described only, not tested." },
    ]);
    engine.fail = true;
    const again = [shareChange({ share: 41.25, base: 1000, stat }, { share: 38.5, base: 1000, stat }, null).job!];
    const failed = await attachTests(again, { storagePath: "x", sourceFilename: "x.sav" });
    expect(failed.failed).toBe("The significance test could not be run: The statistics worker stopped. Try again.");
    expect(again[0].change).toMatchObject({ changePp: 2.75, test: { status: "failed" } });
  });
});
