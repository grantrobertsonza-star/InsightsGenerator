// The benchmark's omitted-effect measurement (e2e/ui/omitted-effect-measure.mjs).
//
// Codex 2026-10-18 (20977c8) found the earlier heuristic wrong in both directions: two correctly
// grounded computed findings (Male 70 and Female 50 in separate rows) were reported as not found,
// and repeated "Female only" text was reported as the male/female comparison. Both are reproduced
// here with findings shaped exactly like the engine's saved rows, plus reversed groups, wrong
// values, unrelated figures and a missing table.
import { describe, expect, it } from "vitest";
import { groupValuesInText, measureOmittedEffect } from "../../../e2e/ui/omitted-effect-measure.mjs";

const TARGET = {
  question: "Reasons",
  answer: "Convenience",
  banner: "Gender",
  groups: [
    { column: "Male", value: 70, words: ["male", "males", "men", "man"] },
    { column: "Female", value: 50, words: ["female", "females", "women", "woman"] },
  ],
  higher: "Male",
  tolerance: 0.5,
};

// Saved statistics as the engine writes them for a column-versus-rest test (copied in shape from a
// real run's findings rows; only the values vary between cases).
const columnFinding = (id: string, column: string, value: number, extra: Record<string, unknown> = {}) => ({
  id,
  origin: "generated",
  finding_text: `"Convenience" on Reasons is ${value > 60 ? "higher" : "lower"} for Gender "${column}" (${value}%) than overall (60%), unweighted, based on 100 cases.`,
  stated_stats: { n: 100, answer: "Convenience", column, question: "Reasons", testType: "column_proportion_vs_rest", totalValue: 60, columnValue: value, bannerVariable: "Gender", ...extra },
});
const overallShare = { id: "f-share", origin: "generated", finding_text: "60% of respondents chose \"Convenience\" on Reasons.", stated_stats: { answer: "Convenience", question: "Reasons", testType: "share", value: 60 } };
const correct = [overallShare, columnFinding("f-male", "Male", 70), columnFinding("f-female", "Female", 50)];
const insight = (text: string, findingIds: string[] = []) => ({ kind: "insight", id: `i-${text.length}`, text, findingIds });
const measure = (findings: unknown[], insights: ReturnType<typeof insight>[] = [], tables = ["Purchase", "Reasons"]) =>
  measureOmittedEffect({ findings: findings as never, insights, computedTables: tables }, TARGET);

describe("omitted-effect measurement", () => {
  it("finds the effect when each group has its own correctly valued computed finding (Codex's missed case)", () => {
    const r = measure(correct);
    expect(r.computed.classification).toBe("matches");
    expect(r.computed.groups.Male.map((g: { findingId: string }) => g.findingId)).toEqual(["f-male"]);
    expect(r.computed.groups.Female.map((g: { findingId: string }) => g.findingId)).toEqual(["f-female"]);
    expect(r.outcome).toBe("found in the computed findings; no insight states it");
  });

  it("does not count repeated female-only text as the comparison (Codex's false positive)", () => {
    const text = "Convenience among Female respondents is 50%. Convenience among Female respondents is 50%.";
    expect(groupValuesInText(text, TARGET)).toEqual({ Male: [], Female: [50, 50] });
    const r = measure(correct, [insight(text)]);
    expect(r.insightsStating).toEqual([]);
    expect(r.insightsRelatedButNotStating[0].classification).toBe("mentions one group only (not the comparison)");
    expect(r.outcome).toBe("found in the computed findings; no insight states it");
  });

  it("recognises a correct statement however the groups and figures are ordered", () => {
    for (const text of [
      "Convenience matters more to men (70%) than to women (50%).",
      "70% of men and 50% of women chose convenience as a reason.",
      "Convenience: women 50 per cent, men 70 per cent.",
      "Male respondents pick Convenience at 70%, female respondents at 50%.",
    ]) {
      const r = measure(correct, [insight(text, ["f-male"])]);
      expect(r.insightsStating.map((i: { text: string }) => i.text), text).toEqual([text]);
      expect(r.insightsStating[0].anchoredOnTargetFinding).toBe(true);
      expect(r.outcome).toBe("found in the computed findings and stated by an insight");
    }
  });

  it("refuses reversed groups, wrong values, unrelated figures and other answers", () => {
    const cases: [string, string][] = [
      ["Convenience matters more to women (70%) than to men (50%).", "names the groups with other values"],
      ["Convenience: 65% of men against 52% of women.", "names the groups with other values"],
      ["Convenience is chosen by 60% overall; men are 70% of the sample.", "does not state it"],
      ["Convenience is chosen by 60% overall, and by 70% of men.", "mentions one group only (not the comparison)"],
      ["Male respondents pick Convenience at 50%, female respondents at 70%.", "names the groups with other values"],
      ["Value is chosen by 70% of men and 50% of women.", "does not state it"],
      ["Convenience differs by gender.", "does not state it"],
    ];
    for (const [text, label] of cases) {
      const r = measure(correct, [insight(text)]);
      expect(r.insightsStating, text).toEqual([]);
      const all = [...r.insightsStating, ...r.insightsRelatedButNotStating];
      expect(all.length ? all[0].classification : "does not state it", text).toBe(label);
    }
  });

  it("matches computed findings on their statistics, not their wording", () => {
    // Reversed values in the saved statistics are a disagreement, whatever the sentence says.
    const reversed = [columnFinding("m", "Male", 50), columnFinding("f", "Female", 70)];
    expect(measure(reversed).outcome).toBe("computed findings disagree with the target (wrong values)");
    // One group only.
    expect(measure([columnFinding("m", "Male", 70)]).outcome).toBe("computed findings disagree with the target (one group only)");
    // Same values on another question or banner are not the target.
    const elsewhere = [columnFinding("m", "Male", 70, { question: "Purchase" }), columnFinding("f", "Female", 50, { bannerVariable: "Region" })];
    expect(measure(elsewhere).outcome).toBe("not found in the computed findings");
    // A report (stated) finding is never counted as computed evidence.
    expect(measure(correct.map((f) => ({ ...f, origin: "stated" }))).outcome).toBe("not found in the computed findings");
    // Wording that mentions the effect without the statistics does not count either.
    expect(measure([{ id: "t", origin: "generated", finding_text: "Convenience is 70% for men and 50% for women.", stated_stats: null }]).outcome).toBe("not found in the computed findings");
  });

  it("reports a missing target table as unmeasured, not as not found", () => {
    const r = measure(correct, [], ["Purchase", "Satisfaction"]);
    expect(r.tablePresent).toBe(false);
    expect(r.outcome).toBe("could not be measured: the Reasons by Gender table was not committed");
  });
});
