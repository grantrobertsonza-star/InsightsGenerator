// Batch 61: the stability figures and the method contract, against values written out by hand.
//   STAB-F04  headlineCodeAgreement keeps the ten-turn minimum: all small, mixed, exactly ten, nine
//   Grant 28 October 2026: pairwise per-code agreement beside kappa (Codex's worked example)
//   STAB-F01  codingHasGap: complete, failed, incomplete
//   STAB-F03  compareMethod / baselineState: unchanged, changed model, older prompt, codebook and turn
//             changes, missing original, missing migration, incomplete original; model alias disclosure
//   STAB-F02  changesSinceBaseline counts additions and removals against the original
import { describe, expect, it } from "vitest";
import { codePairwiseAgreement, codeKappas, codeStability, headlineCodeAgreement } from "../qualAudit";
import {
  baselineRefusal,
  baselineState,
  changesSinceBaseline,
  codebookFingerprint,
  codingHasGap,
  compareMethod,
  modelIsPinned,
  segmentationFingerprint,
  type BaselineCode,
  type BaselineSegment,
  type ModelBaseline,
} from "../codingBaseline";

describe("STAB-F04 headline minimum support", () => {
  it("all themes below ten turns: no headline, nothing relaxed", () => {
    const h = headlineCodeAgreement([
      { used: 1, consistent: 1 },
      { used: 9, consistent: 9 },
      { used: 0, consistent: 0 },
    ]);
    expect(h).toEqual({ value: null, eligible: 0, belowMinimum: 2 });
  });
  it("mixed: only eligible themes are averaged, equally weighted", () => {
    // (6/10 + 15/20) / 2 = 0.675; the one-turn theme at 100% is left out.
    const h = headlineCodeAgreement([
      { used: 10, consistent: 6 },
      { used: 20, consistent: 15 },
      { used: 1, consistent: 1 },
    ]);
    expect(h.value).toBeCloseTo(0.675, 12);
    expect(h.eligible).toBe(2);
    expect(h.belowMinimum).toBe(1);
  });
  it("exactly ten turns is eligible, nine is not", () => {
    expect(headlineCodeAgreement([{ used: 10, consistent: 7 }]).value).toBeCloseTo(0.7, 12);
    expect(headlineCodeAgreement([{ used: 9, consistent: 7 }]).value).toBeNull();
  });
});

describe("pairwise agreement per theme (lead figure)", () => {
  it("Codex's example: 100 turns, three runs, ten turns each, six shared: pairwise 92%, kappa 0.556, all-runs 6/18", () => {
    const sets = [
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
      [0, 1, 2, 3, 4, 5, 10, 11, 12, 13],
      [0, 1, 2, 3, 4, 5, 14, 15, 16, 17],
    ];
    const turns = Array.from({ length: 100 }, (_, t) => sets.map((s) => (s.includes(t) ? [1] : [])));
    // Each pair: 6 both yes, 4 + 4 one yes only, 86 both no: (6 + 86) / 100 = 0.92 for every pair.
    expect(codePairwiseAgreement(turns, 1)).toEqual([{ code: 1, agreement: 0.92, comparisons: 300 }]);
    // Kappa per pair: po 0.92, pe 0.1*0.1 + 0.9*0.9 = 0.82, (0.92 - 0.82) / 0.18 = 5/9.
    expect(codeKappas(turns, 1)[0].kappa).toBeCloseTo(5 / 9, 12);
    const maps = sets.map((s) => new Map(s.map((t) => [t, [1]])));
    const strict = codeStability(maps[0], maps.slice(1), Array.from({ length: 100 }, (_, i) => i), 1)[0];
    expect(strict.consistent / strict.usedTurns).toBeCloseTo(6 / 18, 12);
  });
  it("two runs, four turns, one disagreement: 3 of 4; a code no run gave agrees on every turn", () => {
    const turns = [[[1], [1]], [[1], []], [[], []], [[1, 2], [1]]];
    expect(codePairwiseAgreement(turns, 3)).toEqual([
      { code: 1, agreement: 0.75, comparisons: 4 },
      { code: 2, agreement: 0.75, comparisons: 4 },
      { code: 3, agreement: 1, comparisons: 4 },
    ]);
  });
  it("no turns: unavailable, never 0 or 100%", () => {
    expect(codePairwiseAgreement([], 1)).toEqual([{ code: 1, agreement: null, comparisons: 0 }]);
  });
});

describe("STAB-F01 one completeness rule", () => {
  it("complete only with no failed and no incomplete batch", () => {
    expect(codingHasGap({ failedBatches: 0, incompleteBatches: 0 })).toBe(false);
    expect(codingHasGap({ failedBatches: 1, incompleteBatches: 0 })).toBe(true);
    expect(codingHasGap({ failedBatches: 0, incompleteBatches: 1 })).toBe(true);
  });
});

describe("STAB-F03 same method", () => {
  const codes: BaselineCode[] = [
    { id: "c1", name: "Waiting", definition: "Waits", inclusion: "", exclusion: null },
    { id: "c2", name: "Payment", definition: "Pays", inclusion: "Failed payment", exclusion: "" },
  ];
  const segments: BaselineSegment[] = [
    { id: "s1", index: 1, role: "participant", text: "I waited." },
    { id: "s0", index: 0, role: "moderator", text: "How was it?" },
  ];
  const baseline: ModelBaseline = {
    id: "b",
    model: "claude-sonnet-5",
    promptHash: "p1",
    codebookFingerprint: codebookFingerprint(codes),
    segmentationFingerprint: segmentationFingerprint(segments),
    totalBatches: 1,
    failedBatches: 0,
    incompleteBatches: 0,
    decisions: { s1: ["c1"] },
    createdAt: "2026-10-28",
  };
  const current = { model: "claude-sonnet-5", promptHash: "p1", codes, segments };

  it("unchanged when every part matches (null and empty criteria read the same; turn order of input does not matter)", () => {
    expect(compareMethod(baseline, { ...current, codes: codes.map((c) => ({ ...c, exclusion: c.exclusion ?? "" })), segments: [...segments].reverse() })).toEqual({ state: "unchanged", changes: [] });
    expect(baselineState(true, baseline, current)).toEqual({ state: "ready" });
    expect(baselineRefusal({ state: "ready" })).toBeNull();
  });
  it("changed model, older prompt, edited, added and removed themes, and changed turns are each named", () => {
    const c = compareMethod(baseline, {
      model: "claude-haiku-5",
      promptHash: "p0",
      codes: [{ ...codes[0], definition: "Waits long" }, { id: "c3", name: "Staff", definition: "Staff", inclusion: null, exclusion: null }],
      segments: [{ ...segments[0], text: "I waited a lot." }, segments[1]],
    });
    expect(c.state).toBe("changed");
    expect(c.changes).toEqual([
      "the model changed (the original coding used claude-sonnet-5; a new run would use claude-haiku-5)",
      "the coding instructions or the way turns are prepared for coding changed in an app update",
      "theme added since: Staff",
      "theme removed since: Payment",
      "definition or criteria changed for: Waiting",
      "the transcript's turns changed",
    ]);
    expect(baselineRefusal(baselineState(true, baseline, { ...current, model: "x" }))).toMatch(/would not use the same method/);
  });
  it("a role change counts as a changed turn", () => {
    expect(compareMethod(baseline, { ...current, segments: [{ ...segments[0], role: "moderator" }, segments[1]] }).changes).toEqual([
      "the transcript's turns changed",
    ]);
  });
  it("missing migration, missing original and an incomplete original are distinct, and never ready", () => {
    expect(baselineState(false, baseline, current)).toEqual({ state: "migration_missing" });
    expect(baselineState(true, null, current)).toEqual({ state: "unknown" });
    expect(baselineState(true, { ...baseline, incompleteBatches: 1, totalBatches: 3 }, current)).toEqual({
      state: "incomplete",
      failedBatches: 0,
      incompleteBatches: 1,
      totalBatches: 3,
    });
    expect(baselineRefusal({ state: "migration_missing" })).toMatch(/migration 0128/);
    expect(baselineRefusal({ state: "unknown" })).toMatch(/unknown/);
  });
  it("a model alias is not a fixed release; a dated id is", () => {
    expect(modelIsPinned("claude-sonnet-5")).toBe(false);
    expect(modelIsPinned("claude-sonnet-4-5-20250929")).toBe(true);
  });
  it("STAB-F02: changes since the original count additions and removals per turn, over this codebook's codes", () => {
    const now = new Map([
      ["s1", ["c2", "other-book-code"]],
      ["s2", ["c1"]],
    ]);
    expect(changesSinceBaseline(baseline, now, ["s1", "s2", "s3"], ["c1", "c2"])).toEqual({ added: 2, removed: 1, turns: 2 });
    expect(changesSinceBaseline(baseline, new Map([["s1", ["c1"]]]), ["s1"], ["c1", "c2"])).toEqual({ added: 0, removed: 0, turns: 0 });
  });
});
