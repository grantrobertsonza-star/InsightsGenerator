// Page 05 "Audience & media" (Grant's design, 29 October 2026), pure parts:
//   - findAgeGroups and findMediaList (trackerRoles.ts): the age groups question by its wording and age-range answers,
//     the media list by its options' media wording; never by a variable name alone; two candidates are ambiguous;
//   - smallBaseLevel: the plan's rule, flagged below 50 and descriptive only below 30;
//   - acquirerParts: the acquisition question and the client's brand's variable, or why not (no question: not
//     measured; two, or no client's brand: mapping needed);
//   - ageRowsFromResults and mediaRowsFromResults: shares by raw code for both groups; a listed answer nobody in the
//     group gave is 0 of a known base, a suppressed or missing figure is n/a with the reason, never 0.
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));
vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
import { findAgeGroups, findMediaList, recogniseTracker, type RoleVariable } from "../trackerRoles";
import { resolveDashboard } from "../trackerDashboard";
import { acquirerParts, ageRowsFromResults, mediaRowsFromResults, smallBaseLevel } from "../trackerAudience";
import type { CrosstabResult } from "../parseStatsFile";

const fixture = (dir: string, name: string): RoleVariable[] => JSON.parse(readFileSync(path.join(process.cwd(), "fixtures", dir, `${name}.json`), "utf8"));
const v = (name: string, label: string, valueLabels?: Record<string, string>, extra: Partial<RoleVariable> = {}): RoleVariable => ({ name, label, numeric: true, ...(valueLabels ? { valueLabels } : {}), ...extra });
const AGES = { "1": "18-24", "2": "25-34", "3": "35-49", "4": "50+", "9": "Prefer not to say" };
const YN = { "0": "Not selected", "1": "Selected" };

describe("findAgeGroups and findMediaList", () => {
  it("BMW and the other brand packs (codebook, SPSS labels only): age_band and the twelve media options, media_none outside", () => {
    for (const [dir, name] of [["tracker-roles", "bmw_car"], ["tracker-raw", "bmw_car_spss_labels_only"], ["tracker-roles", "telecoms_brand"]]) {
      const r = recogniseTracker(fixture(dir, name));
      expect(r.ageGroups, name).toMatchObject({ status: "found", variable: "age_band", label: "Age group" });
      expect(r.mediaUse, name).toMatchObject({ status: "found", group: "media" });
      if (r.mediaUse.status !== "found") continue;
      expect(r.mediaUse.options.map((o) => o.variable)).toEqual(Array.from({ length: 12 }, (_, i) => `media_m${String(i + 1).padStart(2, "0")}`));
      expect(r.mediaUse.options[0].label).toBe("YouTube");
    }
  });
  it("age: answers must be age ranges (Prefer not to say may be among them); age in years without a list is not age groups", () => {
    expect(findAgeGroups([v("q1", "Age group", AGES)])).toMatchObject({ status: "found", variable: "q1" });
    expect(findAgeGroups([v("age", "Age in years")])).toMatchObject({ status: "not_found" });
    expect(findAgeGroups([v("q2", "Age of your main vehicle", { "1": "New", "2": "Used", "3": "Demo" })])).toMatchObject({ status: "not_found" });
  });
  it("two age groups questions: ambiguous; a variable named age_band without its own wording: not read", () => {
    expect(findAgeGroups([v("q1", "Age group", AGES), v("q2", "Age band of youngest child", AGES)])).toMatchObject({ status: "ambiguous", candidates: ["q1", "q2"] });
    expect(findAgeGroups([v("age_band", "age_band", AGES)])).toMatchObject({ status: "not_found" });
  });
  it("media: options named as media; None of these is outside; a list of other things (purchase journey) is not media", () => {
    const media = ["Television", "Radio", "YouTube", "Newspapers", "None of these"].map((l, i) => v(`p1_${i}`, l, YN, { group: "p1" }));
    const journey = ["Brand website", "Dealer visit", "Test drive", "Friends or family"].map((l, i) => v(`j_${i}`, l, YN, { group: "journey" }));
    const r = findMediaList([...media, ...journey]);
    expect(r).toMatchObject({ status: "found", group: "p1", outside: ["p1_4"] });
    expect(r.status === "found" && r.options.map((o) => o.label)).toEqual(["Television", "Radio", "YouTube", "Newspapers"]);
    expect(findMediaList(journey)).toMatchObject({ status: "not_found" });
  });
  it("two media lists: ambiguous; options known only by their names (Media_YouTube): not read", () => {
    const a = ["Television", "Radio", "YouTube"].map((l, i) => v(`a_${i}`, l, YN, { group: "a" }));
    const b = ["TikTok", "Instagram", "Podcasts"].map((l, i) => v(`b_${i}`, l, YN, { group: "b" }));
    expect(findMediaList([...a, ...b])).toMatchObject({ status: "ambiguous", candidates: ["a", "b"] });
    expect(findMediaList(["Media_YouTube", "Media_Radio", "Media_TikTok"].map((n) => v(n, n, YN, { group: "Media" })))).toMatchObject({ status: "not_found" });
  });
});

describe("smallBaseLevel: flagged below 50, descriptive only below 30", () => {
  it("boundaries", () => {
    expect([0, 13, 29, 30, 49, 50, 1000].map(smallBaseLevel)).toEqual(["very_small", "very_small", "very_small", "small", "small", "ok", "ok"]);
  });
});

describe("acquirerParts", () => {
  const vars = fixture("tracker-roles", "bmw_car");
  const rec = recogniseTracker(vars);
  const names = new Set(vars.map((x) => x.name));
  it("the client's brand's variable in the acquisition question", () => {
    const d = resolveDashboard(rec, names, "weight", { focalBrandCode: "8" });
    expect(acquirerParts(rec, d)).toMatchObject({ status: "ok", brand: { code: "8", label: "BMW" }, variable: "bought12_b08", label: "Past 12 month household acquisition" });
  });
  it("no client's brand: mapping needed; no acquisition question: not measured; two: mapping needed", () => {
    const d = resolveDashboard(rec, names, "weight", {});
    expect(acquirerParts(rec, { ...d, focalBrand: null })).toMatchObject({ status: "mapping_needed", reason: expect.stringMatching(/Choose your brand/) });
    const acq = d.stages.find((s) => s.stage === "acquisition")!.group;
    expect(acquirerParts(rec, resolveDashboard(rec, names, "weight", { focalBrandCode: "8", stages: { [acq]: null } }))).toMatchObject({ status: "not_measured" });
    const repeat = d.stages.find((s) => s.stage === "repeat")!.group;
    expect(acquirerParts(rec, resolveDashboard(rec, names, "weight", { focalBrandCode: "8", stages: { [repeat]: "acquisition" } }))).toMatchObject({ status: "mapping_needed" });
  });
});

// A Cross tab result (one column, the total) with single-choice or yes/no questions: per code [share, n], base.
function table(questions: Record<string, { base: number; answers: Record<string, number | null> }>): CrosstabResult {
  return {
    total: { n: 0, w: 0, nEff: 0 },
    columns: [],
    questions: Object.entries(questions).map(([key, q]) => ({
      key,
      rows: [
        { label: "Base", isBase: true, count: [q.base], pct: [null], total: { count: q.base } },
        ...Object.entries(q.answers).map(([code, share]) => ({ label: `a${code}`, rawCode: code, count: [0], nCell: [0], pct: [share], pctExact: [share], total: { count: 0, countExact: 0, pct: share, pctExact: share, nCell: 0 } })),
      ],
    })),
  } as unknown as CrosstabResult;
}

describe("ageRowsFromResults and mediaRowsFromResults", () => {
  it("every listed code for both groups; one nobody in the group gave is 0 of the known base; a suppressed one is n/a", () => {
    const rows = ageRowsFromResults(
      table({ age: { base: 100, answers: { "1": 20, "2": 30, "3": 40, "4": 10 } } }),
      table({ age: { base: 13, answers: { "2": 50, "3": null, "4": 50 } } }),
      "age",
      v("age", "Age group", AGES),
      null,
    );
    expect(rows.map((r) => [r.key, r.label, r.category.share, r.acquirers.share, r.acquirers.base])).toEqual([
      ["1", "18-24", 20, 0, 13],
      ["2", "25-34", 30, 50, 13],
      ["3", "35-49", 40, null, 13],
      ["4", "50+", 10, 50, 13],
      ["9", "Prefer not to say", 0, 0, 13],
    ]);
    expect(rows[2].acquirers.reason).toBe("Suppressed for a small base.");
  });
  it("no acquirers table: every acquirer figure n/a with the reason given, the category still read", () => {
    const rows = ageRowsFromResults(table({ age: { base: 100, answers: { "1": 100 } } }), null, "age", v("age", "Age group", { "1": "18-24" }), "No respondent in this file is a recent acquirer of BMW.");
    expect(rows[0]).toMatchObject({ category: { share: 100 }, acquirers: { share: null, reason: "No respondent in this file is a recent acquirer of BMW." } });
  });
  it("media ordered by the category's share, a figure that cannot be read last and never 0", () => {
    const list = { status: "found" as const, group: "media", label: "P1", outside: [], options: [{ variable: "m1", label: "Radio" }, { variable: "m2", label: "TV" }, { variable: "m3", label: "Odd" }] };
    const vars = new Map([["m1", v("m1", "Radio", YN)], ["m2", v("m2", "TV", YN)], ["m3", v("m3", "Odd", { "0": "No", "1": "Maybe" })]]);
    const rows = mediaRowsFromResults(
      table({ m1: { base: 100, answers: { "0": 60, "1": 40 } }, m2: { base: 100, answers: { "0": 20, "1": 80 } }, m3: { base: 100, answers: { "0": 10, "1": 90 } } }),
      table({ m1: { base: 13, answers: { "0": 100 } }, m2: { base: 13, answers: { "0": 50, "1": 50 } }, m3: { base: 13, answers: { "1": 100 } } }),
      list,
      vars,
      null,
    );
    expect(rows.map((r) => [r.label, r.category.share, r.acquirers.share])).toEqual([
      ["TV", 80, 50],
      ["Radio", 40, 0],
      ["Odd", null, null],
    ]);
  });
});
