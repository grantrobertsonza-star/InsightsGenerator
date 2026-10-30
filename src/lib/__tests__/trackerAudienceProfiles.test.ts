// The Audience and Media pages' R5 additions (Grant, 30 October 2026), pure parts:
//   - findGender, findIncome, profileQuestionsOf (trackerRoles.ts): by the question's own wording and answer list, never
//     by a variable name alone; asked once; two candidates ambiguous; the BMW, banking, insurance and telecoms packs
//     (codebook form and SPSS labels only), a file wording gender and income differently (labelled and CSV-codebook
//     forms), and a file without income (not found, nothing invented);
//   - the saved profile list (trackerDashboard.ts): defaults, add, hide, reorder, replaced default, a saved question a
//     wave lacks (kept, "not in this wave's file"), and what the server refuses;
//   - the Media page's index, sort and headline (trackerAudienceFigures.ts) and the reading of the engine's tests
//     (trackerAudience.mediaTests).
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));
vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
import { findGender, findIncome, profileQuestionsOf, recogniseTracker, type RoleVariable } from "../trackerRoles";
import { choiceProblems, DEFAULT_PROFILES, normaliseChoices, resolveDashboard, resolveProfiles, type ProfileChoice } from "../trackerDashboard";
import { mediaHeadline, mediaIndex, sortMediaRows, type MediaRow } from "../trackerAudienceFigures";
import { mediaTests, setKeyOf } from "../trackerAudience";
import type { CrosstabResult } from "../parseStatsFile";

const fixture = (dir: string, name: string): RoleVariable[] => JSON.parse(readFileSync(path.join(process.cwd(), "fixtures", dir, `${name}.json`), "utf8"));
const v = (name: string, label: string, valueLabels?: Record<string, string>, extra: Partial<RoleVariable> = {}): RoleVariable => ({ name, label, numeric: true, ...(valueLabels ? { valueLabels } : {}), ...extra });
const BMW = fixture("tracker-roles", "bmw_car");
/** The BMW pack with gender and income asked in other words: as an SPSS file labels them, and as a CSV reads a
 * codebook (question number, type, the label led by the variable name). */
const REWORDED_GENDER = { "1": "Male", "2": "Female", "3": "Other", "4": "Refused" };
const REWORDED_INCOME = { "1": "R0 - R14 999", "2": "R15 000 to R29 999", "3": "R30 000 to R49 999", "4": "R50 000 to R79 999", "5": "R80 000+", "99": "Refused" };
function reworded(form: "labelled" | "codebook"): RoleVariable[] {
  return BMW.map((x) => {
    const meta = form === "codebook" ? { questionId: x.name === "gender" ? "D1" : "D4", questionType: "categorical" as const } : { questionId: null, questionType: null };
    if (x.name === "gender") return { ...x, ...meta, label: form === "codebook" ? "gender. Sex of respondent" : "Sex of respondent", valueLabels: REWORDED_GENDER };
    if (x.name === "income") return { ...x, ...meta, label: form === "codebook" ? "income: Total household earnings per month" : "Total household earnings per month", valueLabels: REWORDED_INCOME };
    return x;
  });
}

describe("findGender, findIncome and profileQuestionsOf", () => {
  it("the BMW pack (codebook and SPSS labels only) and the banking, insurance and telecoms packs: gender and income found by wording and answers", () => {
    for (const [dir, name] of [["tracker-roles", "bmw_car"], ["tracker-raw", "bmw_car_spss_labels_only"], ["tracker-roles", "banking_brand"], ["tracker-roles", "insurance_brand"], ["tracker-roles", "telecoms_brand"]]) {
      const r = recogniseTracker(fixture(dir, name));
      expect(r.gender, name).toEqual({ status: "found", variable: "gender", label: "Gender" });
      expect(r.income, name).toEqual({ status: "found", variable: "income", label: "Monthly household income before tax" });
      const offered = r.profileQuestions.map((q) => q.variable);
      expect(offered, name).toEqual(expect.arrayContaining(["age_band", "gender", "income", "province", "settlement", "life_stage"]));
      // Never the file's wave marker, a brand question, a per-brand (funnel) question, a grid cell or a media option.
      expect(offered.some((x) => x === "wave" || x === "topmind" || /^(aware|consider|bought12|media)_/.test(x) || x.startsWith("assoc")), name).toBe(false);
    }
    expect(recogniseTracker(BMW).profileQuestions.find((q) => q.variable === "province")).toEqual({ variable: "province", label: "Province" });
  });
  it("other wording, labelled and CSV-codebook forms: Sex of respondent (Male, Female) and household earnings bands", () => {
    for (const form of ["labelled", "codebook"] as const) {
      const r = recogniseTracker(reworded(form));
      expect(r.gender, form).toEqual({ status: "found", variable: "gender", label: "Sex of respondent" });
      expect(r.income, form).toEqual({ status: "found", variable: "income", label: "Total household earnings per month" });
    }
    expect(findGender([v("q2", "What is your gender?", { "1": "Man", "2": "Woman", "3": "Non-binary", "8": "Prefer to self-describe", "9": "Prefer not to say" })])).toMatchObject({ status: "found", variable: "q2" });
    expect(findIncome([v("q9", "Personal monthly income", { "0": "No income", "1": "Under $1,000", "2": "$1,000-$2,999", "3": "$3,000 or more", "9": "Don't know" })])).toMatchObject({ status: "found", variable: "q9" });
  });
  it("a file without income: not found with the reason; nothing invented", () => {
    const r = recogniseTracker(BMW.filter((x) => x.name !== "income"));
    expect(r.income).toEqual({ status: "not_found", reason: expect.stringMatching(/No question asked once whose wording names income/) });
    expect(r.gender.status).toBe("found");
    expect(resolveProfiles(r, new Set(BMW.map((x) => x.name)), undefined).map((p) => p.status)).toEqual(["ok", "ok", "not_found"]);
  });
  it("never by the variable name alone, never answers without the wording, never wording without the answers; two are ambiguous", () => {
    expect(findGender([v("gender", "gender", { "1": "Male", "2": "Female" })])).toMatchObject({ status: "not_found" });
    expect(findGender([v("q1", "Preferred salesperson", { "1": "Male", "2": "Female", "3": "No preference" })])).toMatchObject({ status: "not_found" });
    expect(findGender([v("q1", "Gender of the vehicle's main driver", { "1": "Spouse", "2": "Me", "3": "Child" })])).toMatchObject({ status: "not_found" });
    expect(findGender([v("q1", "Gender", { "1": "Male", "2": "Female" }), v("q2", "Sex", { "1": "Male", "2": "Female" })])).toMatchObject({ status: "ambiguous", candidates: ["q1", "q2"] });
    expect(findIncome([v("income", "income", { "1": "R0-R4999", "2": "R5000+" })])).toMatchObject({ status: "not_found" });
    expect(findIncome([v("q5", "Satisfaction with your income", { "1": "Very satisfied", "2": "Satisfied", "3": "Dissatisfied" })])).toMatchObject({ status: "not_found" });
    expect(findIncome([v("q6", "Price paid for the vehicle", { "1": "Under R200,000", "2": "R200,000-R399,999", "3": "R400,000 or more" })])).toMatchObject({ status: "not_found" });
    // A yes/no option is never a profile question; a question without its own wording is never offered.
    expect(profileQuestionsOf([v("m1", "YouTube", { "0": "No", "1": "Yes" }), v("x1", "x1", { "1": "A", "2": "B" }), v("q7", "Region", { "1": "North", "2": "South" })])).toEqual([{ variable: "q7", label: "Region" }]);
  });
});

describe("the saved profile list", () => {
  const rec = recogniseTracker(BMW);
  const names = new Set(BMW.map((x) => x.name));
  const shown = (list: ProfileChoice[] | undefined, vars = names) => resolveProfiles(rec, vars, list).map((p) => (p.status === "ok" ? `${p.variable}:${p.source}` : p.status === "not_in_file" ? `${p.variable}:missing` : `${p.role}:${p.status}`));

  it("defaults: age, gender and income as recognised, suggested", () => {
    expect(shown(undefined)).toEqual(["age_band:suggested", "gender:suggested", "income:suggested"]);
    expect(resolveDashboard(rec, names, "weight", {}).audienceProfilesSource).toBe("suggested");
  });
  it("add, hide and reorder: the list as saved, in its order; a replaced default keeps its slot", () => {
    const added: ProfileChoice[] = [...DEFAULT_PROFILES, { role: null, variable: "province", label: "Province" }];
    expect(shown(added)).toEqual(["age_band:suggested", "gender:suggested", "income:suggested", "province:chosen"]);
    const hiddenAndMoved: ProfileChoice[] = [added[3], added[0], added[2]];
    expect(shown(hiddenAndMoved)).toEqual(["province:chosen", "age_band:suggested", "income:suggested"]);
    const replaced: ProfileChoice[] = [DEFAULT_PROFILES[0], { role: "gender", variable: "life_stage", label: "Household life stage" }, DEFAULT_PROFILES[2]];
    expect(resolveProfiles(rec, names, replaced)[1]).toEqual({ status: "ok", role: "gender", variable: "life_stage", label: "Household life stage", source: "chosen" });
    for (const list of [added, hiddenAndMoved, replaced]) expect(choiceProblems({ audienceProfiles: list }, rec, names, "weight")).toEqual([]);
  });
  it("a saved question this wave's file lacks: shown as not in this wave's file, kept on a resave, never dropped", () => {
    const list: ProfileChoice[] = [...DEFAULT_PROFILES, { role: null, variable: "province", label: "Province" }];
    const without = new Set([...names].filter((n) => n !== "province"));
    const recWithout = recogniseTracker(BMW.filter((x) => x.name !== "province"));
    expect(resolveProfiles(recWithout, without, list)[3]).toEqual({ status: "not_in_file", role: null, variable: "province", label: "Province", source: "chosen" });
    // Resaved unchanged from a wave without it: accepted; newly chosen there: refused.
    expect(choiceProblems({ audienceProfiles: list }, recWithout, without, "weight", { audienceProfiles: list })).toEqual([]);
    expect(choiceProblems({ audienceProfiles: list }, recWithout, without, "weight", {})).toEqual(["province is not a single-choice question asked once in this file, so it cannot be a profile question."]);
  });
  it("refused on the server: a question that is not a profile question, a question twice, a default twice, a default's question added again, too many", () => {
    expect(choiceProblems({ audienceProfiles: [{ role: null, variable: "bought12_b08", label: "x" }] }, rec, names, "weight")).toEqual([expect.stringMatching(/bought12_b08 is not a single-choice question asked once/)]);
    expect(choiceProblems({ audienceProfiles: [{ role: null, variable: "province", label: null }, { role: null, variable: "province", label: null }] }, rec, names, "weight")).toEqual(["province is listed twice as a profile question."]);
    expect(choiceProblems({ audienceProfiles: [DEFAULT_PROFILES[0], DEFAULT_PROFILES[0]] }, rec, names, "weight")).toEqual(["The age profile is listed twice."]);
    expect(choiceProblems({ audienceProfiles: [DEFAULT_PROFILES[1], { role: null, variable: "gender", label: null }] }, rec, names, "weight")).toEqual(["gender is already shown as the gender profile."]);
    const many = rec.profileQuestions.map((q) => ({ role: null, variable: q.variable, label: q.label }));
    expect(choiceProblems({ audienceProfiles: [...many, ...many.map((m) => ({ ...m, variable: `${m.variable}_x` }))] }, rec, names, "weight")[0]).toMatch(/At most 24 profile questions/);
  });
  it("as stored: malformed entries left out; not a list is the defaults", () => {
    expect(normaliseChoices({ audienceProfiles: [{ role: "age" }, { role: "height", variable: "x" }, { role: null }, "x", { variable: "province", label: 3 }] }).audienceProfiles).toEqual([
      { role: "age", variable: null, label: null },
      { role: null, variable: "province", label: null },
    ]);
    expect(normaliseChoices({ audienceProfiles: "age" }).audienceProfiles).toBeUndefined();
  });
});

const row = (key: string, f: number | null, c: number | null, test: MediaRow["test"] = { status: "no_difference" }): MediaRow => ({ key, label: key, focal: { share: f, base: 100 }, comparison: { share: c, base: 1000 }, test });

describe("Media page: index, sort and headline", () => {
  it("index = focal / comparison x 100; withheld for a small base, a comparison of 0% or an unknown share", () => {
    expect(mediaIndex(row("a", 60, 40), "ok", "ok").index).toBeCloseTo(150, 10);
    expect(mediaIndex(row("a", 60, 40), "small", "ok")).toEqual({ index: null, reason: "Withheld: a base below 50." });
    expect(mediaIndex(row("a", 60, 40), "ok", "very_small").index).toBeNull();
    expect(mediaIndex(row("a", 10, 0), "ok", "ok")).toEqual({ index: null, reason: "Withheld: the comparison share is 0%." });
    expect(mediaIndex(row("a", null, 40), "ok", "ok").index).toBeNull();
  });
  it("sort by the focal share (default) or by the difference; unknown last; ties keep the list's order", () => {
    const rows = [row("a", 50, 10), row("b", 70, 80), row("c", null, 30), row("d", 50, 60)];
    expect(sortMediaRows(rows, "focal").map((r) => r.key)).toEqual(["b", "a", "d", "c"]);
    expect(sortMediaRows(rows, "difference").map((r) => r.key)).toEqual(["a", "b", "d", "c"]);
  });
  it("headline: only differences the test passed, largest first; none passed says so; small bases or no test: no headline", () => {
    const rows = [row("Radio", 30, 40, { status: "lower" }), row("Instagram", 83.3, 66.4, { status: "higher" }), row("X", 60, 50, { status: "no_difference" }), row("AI", 39, 34, { status: "higher" })];
    expect(mediaHeadline(rows, "BMW recent acquirers", "all eligible category respondents", "ok", "ok", true)).toEqual({
      text: "BMW recent acquirers are more likely to use Instagram (83.3% vs 66.4%) and AI (39.0% vs 34.0%), and less likely to use Radio (30.0% vs 40.0%) than all eligible category respondents.",
      higher: ["Instagram", "AI"],
      lower: ["Radio"],
    });
    expect(mediaHeadline([row("X", 60, 50)], "A", "B", "ok", "ok", true)?.text).toBe("No clear differences in media use between A and B.");
    expect(mediaHeadline(rows, "A", "B", "small", "ok", true)).toBeNull();
    expect(mediaHeadline(rows, "A", "B", "ok", "ok", false)).toBeNull();
  });
});

describe("mediaTests: the engine's decisions read by column identity", () => {
  const vars = new Map([["m1", v("m1", "YouTube", { "0": "No", "1": "Yes" })], ["m2", v("m2", "Radio", { "0": "No", "1": "Yes" })], ["m3", v("m3", "TikTok", { "0": "No", "1": "Yes" })]]);
  const q = (key: string, p: (number | null)[], sig: number[], letters: string[], pct: number[]) => ({
    key,
    rows: [
      { label: "Base", isBase: true, count: [], pct: [], p: [], sig: [], base: [], total: { count: 0 } },
      { label: "No", rawCode: "0", count: [], pct: [], p: [null, null, null], sig: [0, 0, 0], letters: ["", "", ""], base: [], total: { count: 0 } },
      { label: "Yes", rawCode: "1", count: [], pct, pctExact: pct, p, sig, letters, base: [], total: { count: 0 } },
    ],
  });
  it("against all eligible: the focal column (variable and raw code) tested against the rest", () => {
    const result = {
      columns: [{ var: "bought12_b08", rawCode: "0", letter: "A" }, { var: "bought12_b08", rawCode: "1", letter: "B" }],
      questions: [q("m1", [0.001, 0.001], [-1, 1], ["", ""], [60, 80]), q("m2", [0.4, 0.4], [0, 0], ["", ""], [50, 52]), q("m3", [null, null], [0, 0], ["", ""], [10, 12])],
    } as unknown as CrosstabResult;
    const t = mediaTests(result, "category", { variable: "bought12_b08", code: "1" }, null, ["m1", "m2", "m3"], vars);
    expect([...t.values()].map((x) => x.status)).toEqual(["higher", "no_difference", "untested"]);
  });
  it("against another brand: the two members' columns by variable, the pair's letters; a pair either side of which is untestable is untested", () => {
    const result = {
      columns: [{ var: "bought12_b01", letter: "A" }, { var: "bought12_b02", letter: "B" }, { var: "bought12_b08", letter: "C" }],
      questions: [q("m1", [0.2, 0.3, 0.01], [0, 0, 1], ["", "", "A"], [40, 50, 70]), q("m2", [0.2, 0.3, 0.01], [0, 0, -1], ["C", "", ""], [60, 50, 30]), q("m3", [null, 0.3, 0.2], [0, 0, 0], ["", "", ""], [10, 12, 14])],
    } as unknown as CrosstabResult;
    const t = mediaTests(result, "brand", { variable: "bought12_b08", code: "1" }, { variable: "bought12_b01" }, ["m1", "m2", "m3"], vars);
    expect([...t.values()].map((x) => x.status)).toEqual(["higher", "lower", "untested"]);
    // A column that is not there (the set did not resolve to the brand's member): untested with the reason, never "no difference".
    expect(mediaTests(result, "brand", { variable: "bought12_b08", code: "1" }, { variable: "bought12_b09" }, ["m1"], vars).get("m1")).toEqual({ status: "untested", reason: "The groups were not found among the engine's columns." });
  });
  it("the engine's set key from the members' names", () => {
    expect(setKeyOf(["bought12_b01", "bought12_b08"])).toBe("bought12");
    expect(setKeyOf(["bought12_b01", "repeat_b08"])).toBeNull();
  });
});
