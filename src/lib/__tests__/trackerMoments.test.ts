// Page 02 "Moments & needs" (Grant's design, 29 October 2026), pure parts:
//   - findCategoryMoments (trackerRoles.ts): the category relevance question is the yes/no list asked about no brand
//     whose options are the same moments as the brand recall grid; found in the pack fixtures with and without a
//     codebook, never by a variable name alone, "None of these" not a moment, two candidate lists ambiguous;
//   - momentsFromResult (trackerMoments.ts): ranking by the unrounded share, the top six with brand recall, cells by
//     brand code, and unknown parts as "not_measured" or "mapping_needed", never zeros.
// The expected moments are written from the fixtures' own labels (fixtures/tracker-roles, fixtures/tracker-raw).
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));
vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
import { findCategoryMoments, recogniseTracker, type BrandGrid, type CategoryMoments, type RoleVariable } from "../trackerRoles";
import { momentsFromResult, momentVariables } from "../trackerMoments";
import type { CrosstabResult } from "../parseStatsFile";

const fixture = (dir: string, name: string): RoleVariable[] => JSON.parse(readFileSync(path.join(process.cwd(), "fixtures", dir, `${name}.json`), "utf8"));
const BMW_MOMENTS = [
  "Replacing an unreliable car", "Reducing fuel and running costs", "Needing more space for a growing family", "Making the daily commute easier",
  "Taking long-distance family trips", "Feeling safer on the road", "Marking a career or life achievement", "Enjoying the driving experience",
  "Choosing lower-emission transport", "Getting technology that simplifies driving", "Staying within a fixed monthly budget", "Driving on rough roads or outdoor trips",
];

describe("findCategoryMoments: the relevance question beside the moments grid", () => {
  for (const [dir, name, group] of [["tracker-roles", "bmw_car", "category_situations"], ["tracker-raw", "bmw_car_spss_labels_only", "relevant"], ["tracker-raw", "bmw_car_workbook_wave1", "relevant"]] as const) {
    it(`BMW ${name}: relevant_c01..c12 (${group}), each linked to its cep_cXX moment; relevant_none is not a moment`, () => {
      const c = recogniseTracker(fixture(dir, name)).categoryMoments;
      expect(c.status).toBe("found");
      if (c.status !== "found") return;
      expect(c.group).toBe(group);
      expect(c.items.map((i) => i.variable)).toEqual(BMW_MOMENTS.map((_, i) => `relevant_c${String(i + 1).padStart(2, "0")}`));
      expect(c.items.map((i) => i.item)).toEqual(BMW_MOMENTS);
      expect(c.items.map((i) => i.gridGroup)).toEqual(BMW_MOMENTS.map((_, i) => `cep_c${String(i + 1).padStart(2, "0")}`));
      expect(c.items.some((i) => i.variable === "relevant_none")).toBe(false);
    });
  }
  it("coffee tracker without labels: Moment_* by the name's words, matched to BrandMoment_*_<moment>", () => {
    const c = recogniseTracker(fixture("tracker-raw", "coffee_brand_tracker_oct2025")).categoryMoments;
    expect(c.status === "found" && c.items.length).toBe(15);
    expect(c.status === "found" && c.items[0]).toEqual({ variable: "Moment_QuietTimeAlone", item: "Quiet Time Alone", gridGroup: "BrandMoment_*_QuietTimeAlone" });
  });
  it("coffee synthetic 03: \"None of the category moments\" is outside the moments, never ranked", () => {
    const c = recogniseTracker(fixture("tracker-raw", "coffee_synthetic_03_rotated")).categoryMoments;
    expect(c.status).toBe("found");
    if (c.status !== "found") return;
    expect(c.items).toHaveLength(10);
    expect(c.outside).toEqual(["moment_none"]);
  });
  it("the plain CSV with no labels and no grid: not found, with the reason (no guess from the names relevant_c01...)", () => {
    const c = recogniseTracker(fixture("tracker-raw", "bmw_car_csv_no_labels")).categoryMoments;
    expect(c.status).toBe("not_found");
  });

  const grid: BrandGrid = { kind: "moments", items: ["Commute", "Weekend trips", "Family space"].map((item, i) => ({ group: `cep_c${i + 1}`, item, byBrand: [{ code: "1", variable: `cep_c${i + 1}_b1` }] })) };
  const yesNo = (name: string, label: string, group: string): RoleVariable => ({ name, label, group, numeric: true, questionType: "multiple_response", valueLabels: { "0": "Not selected", "1": "Selected" } });
  it("boundary: a list named like moments but worded differently is not the relevance question (never by name alone)", () => {
    const vars = ["Media A", "Media B", "Media C"].map((l, i) => yesNo(`relevant_c${i + 1}`, l, "relevant"));
    expect(findCategoryMoments(vars, [grid]).status).toBe("not_found");
  });
  it("two lists with the same moments: ambiguous, neither used", () => {
    const a = ["Commute", "Weekend trips", "Family space"].map((l, i) => yesNo(`rel_${i}`, l, "rel"));
    const b = ["Commute", "Weekend trips", "Family space"].map((l, i) => yesNo(`last_${i}`, l, "last"));
    expect(findCategoryMoments([...a, ...b], [grid])).toMatchObject({ status: "ambiguous", candidates: ["rel", "last"] });
  });
  it("a label that repeats the variable's name first (\"relevant_c01. Commute\", a CSV with a linked codebook) is compared on its wording", () => {
    const vars = ["Commute", "Weekend trips", "Family space"].map((l, i) => yesNo(`relevant_c0${i + 1}`, `relevant_c0${i + 1}. ${l}`, "category_situations"));
    const c = findCategoryMoments(vars, [grid]);
    expect(c.status === "found" && c.items.map((i) => [i.variable, i.item, i.gridGroup])).toEqual([["relevant_c01", "Commute", "cep_c1"], ["relevant_c02", "Weekend trips", "cep_c2"], ["relevant_c03", "Family space", "cep_c3"]]);
  });
  it("wording that differs only in case and punctuation matches; fewer than three matches does not qualify", () => {
    const ok = ["commute.", "WEEKEND TRIPS", "Family-space"].map((l, i) => yesNo(`r${i}`, l, "r"));
    expect(findCategoryMoments(ok, [grid]).status).toBe("found");
    expect(findCategoryMoments(ok.slice(0, 2), [grid]).status).toBe("not_found");
  });
});

// A Cross tab result with one yes/no item per variable: share selecting, valid answers.
const result = (cells: Record<string, [number | null, number]>) =>
  ({
    questions: Object.entries(cells).map(([key, [share, base]]) => ({
      key,
      rows: [
        { label: "Base", isBase: true, count: [base], pct: [null] },
        { label: "Not selected", rawCode: "0", count: [0], pct: [share === null ? null : 100 - share], pctExact: [share === null ? null : 100 - share] },
        { label: "Selected", rawCode: "1", count: [0], pct: [share], pctExact: [share] },
      ],
    })),
  }) as unknown as CrosstabResult;

describe("momentsFromResult: ranking, top six with recall, unknown never zero", () => {
  const labels = { "0": "Not selected", "1": "Selected" };
  const n = 8;
  const moments: CategoryMoments = { status: "found", group: "rel", label: "M2", outside: [], items: Array.from({ length: n }, (_, i) => ({ variable: `rel_${i + 1}`, item: `Moment ${i + 1}`, gridGroup: i === 1 ? null : `cep_${i + 1}` })) };
  const grid: BrandGrid = { kind: "moments", items: Array.from({ length: n }, (_, i) => ({ group: `cep_${i + 1}`, item: `Moment ${i + 1}`, byBrand: [{ code: "1", variable: `cep_${i + 1}_b1` }, { code: "2", variable: `cep_${i + 1}_b2` }] })).filter((it) => it.group !== "cep_2") };
  const brands = [{ code: "1", label: "A" }, { code: "2", label: "B" }];
  const vars = new Map<string, RoleVariable>();
  for (const v of momentVariables(moments, grid, new Set(["1", "2"]))) vars.set(v, { name: v, label: v, numeric: true, valueLabels: labels });
  // Relevance: moment 2 highest (no recall question), then 8, 7, ..., with 3 and 4 tied (question order kept).
  const shares: Record<string, [number | null, number]> = { rel_1: [10, 100], rel_2: [90, 100], rel_3: [40, 100], rel_4: [40, 100], rel_5: [50, 100], rel_6: [60, 100], rel_7: [70, 100], rel_8: [80, 100] };
  for (const g of grid.items) for (const b of g.byBrand) shares[b.variable] = [b.code === "1" ? 12.5 : 0, 100];
  shares.cep_8_b2 = [null, 3];

  it("relevance highest first, ties in question order; the top six with recall, moments without recall said", () => {
    const { relevance, recall } = momentsFromResult(result(shares), moments, grid, brands, vars);
    expect(relevance.status === "ok" && relevance.moments.map((m) => m.variable)).toEqual(["rel_2", "rel_8", "rel_7", "rel_6", "rel_5", "rel_3", "rel_4", "rel_1"]);
    expect(recall.status).toBe("ok");
    if (recall.status !== "ok") return;
    expect(recall.rows.map((r) => r.variable)).toEqual(["rel_8", "rel_7", "rel_6", "rel_5", "rel_3", "rel_4"]);
    expect(recall.withoutRecall).toEqual(["Moment 2"]);
    expect(recall.rows[0].cells).toEqual([
      { code: "1", variable: "cep_8_b1", share: 12.5, base: 100 },
      { code: "2", variable: "cep_8_b2", share: null, base: 3, reason: "Suppressed for a small base." },
    ]);
    // Nobody linking brand 2 to a moment, where the selected code is known, is 0 of a stated base.
    expect(recall.rows[1].cells[1]).toEqual({ code: "2", variable: "cep_7_b2", share: 0, base: 100 });
  });
  it("a relevance figure that cannot be read is n/a with the reason and is never ranked as 0", () => {
    const v2 = new Map(vars);
    v2.set("rel_8", { name: "rel_8", label: "rel_8", numeric: true, valueLabels: { "0": "No", "1": "Not sure" } });
    const { relevance, recall } = momentsFromResult(result(shares), moments, grid, brands, v2);
    const m8 = relevance.status === "ok" ? relevance.moments.find((m) => m.variable === "rel_8") : null;
    expect(m8).toMatchObject({ share: null, reason: "Which answer means selected could not be told from its codes and labels." });
    expect(relevance.status === "ok" && relevance.moments.at(-1)?.variable).toBe("rel_8");
    expect(recall.status === "ok" && recall.rows.map((r) => r.variable).includes("rel_8")).toBe(false);
  });
  it("no relevance question: the relevance card is not measured and the recall card needs mapping, with reasons, no figures", () => {
    const { relevance, recall } = momentsFromResult(null, { status: "not_found", reason: "No list." }, grid, brands, vars);
    expect(relevance).toEqual({ status: "not_measured", reason: "No list." });
    expect(recall).toMatchObject({ status: "mapping_needed" });
    expect(momentVariables({ status: "not_found", reason: "" }, grid, new Set(["1"]))).toEqual([]);
  });
  it("two candidate lists: mapping needed on both cards", () => {
    const r = momentsFromResult(null, { status: "ambiguous", candidates: ["a", "b"], reason: "Two lists." }, grid, brands, vars);
    expect(r.relevance).toEqual({ status: "mapping_needed", reason: "Two lists." });
    expect(r.recall.status).toBe("mapping_needed");
  });
  it("no moments grid: recall not measured, relevance still shown", () => {
    const r = momentsFromResult(result(shares), moments, undefined, brands, vars);
    expect(r.relevance.status).toBe("ok");
    expect(r.recall.status).toBe("not_measured");
  });
});
