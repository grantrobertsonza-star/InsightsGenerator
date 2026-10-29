// Page 03 "Brand associations" (Grant's design, 29 October 2026), pure parts (trackerAssociations.ts):
//   - associationParts: the associations grid and the awareness question the bases come from, recognised from the
//     BMW pack's dictionary; no grid is "not_measured"; awareness unmapped or claimed twice is "mapping_needed"
//     (never all respondents as the base);
//   - awareBasesFromResult: each brand's aware code and aware count read by code; awareness not asked, an aware
//     code that cannot be told or is not numeric gives no base, with the reason;
//   - associationCellsFromResult: cells by brand code from the brand's aware-only table; nobody aware, an attribute
//     not asked about the brand and an unreadable share are n/a with the reason, never 0.
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));
vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
import { recogniseTracker, type BrandGrid, type RoleVariable, type TrackerRecognition } from "../trackerRoles";
import { resolveDashboard } from "../trackerDashboard";
import { associationCellsFromResult, associationParts, awareBasesFromResult, type AwareBase } from "../trackerAssociations";
import type { CrosstabResult } from "../parseStatsFile";

const fixture = (dir: string, name: string): RoleVariable[] => JSON.parse(readFileSync(path.join(process.cwd(), "fixtures", dir, `${name}.json`), "utf8"));

describe("associationParts: the grid and the awareness question", () => {
  const vars = fixture("tracker-roles", "bmw_car");
  const rec = recogniseTracker(vars);
  const names = new Set(vars.map((v) => v.name));
  it("BMW pack: ten attributes, each asked about ten brands, based on the question mapped as awareness", () => {
    const p = associationParts(rec, resolveDashboard(rec, names, "weight", {}));
    expect(p.status).toBe("ok");
    if (p.status !== "ok") return;
    expect(p.grid.items).toHaveLength(10);
    expect(p.grid.items[0]).toMatchObject({ group: "attr_a01", item: "Reliable" });
    expect(p.awareness.byBrand.map((b) => b.variable)).toEqual(Array.from({ length: 10 }, (_, i) => `aware_b${String(i + 1).padStart(2, "0")}`));
  });
  it("awareness unmapped by the researcher: mapping needed, with the reason (the base cannot be defined)", () => {
    const awareGroup = resolveDashboard(rec, names, "weight", {}).stages.find((s) => s.stage === "awareness")!.group;
    const p = associationParts(rec, resolveDashboard(rec, names, "weight", { stages: { [awareGroup]: null } }));
    expect(p).toMatchObject({ status: "mapping_needed" });
    expect(p.status === "mapping_needed" && p.reason).toMatch(/No question is mapped as awareness/);
  });
  it("two questions claiming awareness: mapping needed until the researcher chooses", () => {
    const d = resolveDashboard(rec, names, "weight", {});
    const awareGroup = d.stages.find((s) => s.stage === "awareness")!.group;
    const other = d.stages.find((s) => s.stage === "consideration")!.group;
    const p = associationParts(rec, resolveDashboard(rec, names, "weight", { stages: { [awareGroup]: "awareness", [other]: "awareness" } }));
    expect(p).toMatchObject({ status: "mapping_needed" });
    expect(p.status === "mapping_needed" && p.reason).toMatch(/Two questions could be awareness/);
  });
  it("no associations grid: not measured; no brand list: not measured", () => {
    const noGrid: TrackerRecognition = { ...rec, grids: rec.grids.filter((g) => g.kind !== "associations") };
    expect(associationParts(noGrid, resolveDashboard(noGrid, names, "weight", {}))).toMatchObject({ status: "not_measured" });
    expect(associationParts(rec, { ...resolveDashboard(rec, names, "weight", {}), brands: [] })).toMatchObject({ status: "not_measured", reason: expect.stringMatching(/brand list/) });
  });
});

// A Cross tab result with one yes/no item per variable: share selecting, valid answers, unweighted selected count.
const result = (cells: Record<string, [number | null, number, number?]>, codes: [string, string] = ["0", "1"]) =>
  ({
    questions: Object.entries(cells).map(([key, [share, base, nSel]]) => ({
      key,
      rows: [
        { label: "Base", isBase: true, count: [base], pct: [null] },
        { label: "Not selected", rawCode: codes[0], count: [0], nCell: [base - (nSel ?? 0)], pct: [share === null ? null : 100 - share], pctExact: [share === null ? null : 100 - share] },
        { label: "Selected", rawCode: codes[1], count: [0], nCell: [nSel ?? 0], pct: [share], pctExact: [share] },
      ],
    })),
  }) as unknown as CrosstabResult;
const yesNo = (name: string, labels: Record<string, string> = { "0": "Not selected", "1": "Selected" }): RoleVariable => ({ name, label: name, numeric: true, valueLabels: labels });

describe("awareBasesFromResult: each brand's aware base by code", () => {
  const awareness = { group: "aware", label: "Aware", byBrand: [{ code: "1", variable: "aware_b1" }, { code: "2", variable: "aware_b2" }, { code: "3", variable: "aware_b3" }], outside: [], shape: "binary", stage: "awareness", stageReason: null } as TrackerRecognition["measures"][number];
  const brands = [{ code: "1" }, { code: "2" }, { code: "3" }, { code: "4" }];
  it("the selected code and the unweighted count aware; awareness not asked or unreadable gives no base, with the reason", () => {
    const vars = new Map([["aware_b1", yesNo("aware_b1")], ["aware_b2", yesNo("aware_b2", { "0": "No", "1": "Not sure" })], ["aware_b3", yesNo("aware_b3")]]);
    const bases = awareBasesFromResult(result({ aware_b1: [83.1, 1000, 831], aware_b2: [50, 1000, 500], aware_b3: [0, 1000, 0] }), awareness, brands, vars);
    expect(bases[0]).toEqual({ code: "1", variable: "aware_b1", awareCode: "1", n: 831, effectiveBase: null });
    expect(bases[1]).toMatchObject({ code: "2", awareCode: null, n: null, reason: expect.stringMatching(/means aware could not be told/) });
    expect(bases[2]).toEqual({ code: "3", variable: "aware_b3", awareCode: "1", n: 0, effectiveBase: null });
    expect(bases[3]).toMatchObject({ code: "4", variable: null, n: null, reason: "Awareness was not asked about this brand, so its aware base cannot be defined." });
  });
  it("an aware answer that is not a numeric code has no base (the aware respondents are selected by code)", () => {
    const vars = new Map([["aware_b1", yesNo("aware_b1", { No: "Not selected", Yes: "Selected" })]]);
    const [b] = awareBasesFromResult(result({ aware_b1: [60, 100, 60] }, ["No", "Yes"]), awareness, [{ code: "1" }], vars);
    expect(b).toMatchObject({ awareCode: "Yes", reason: expect.stringMatching(/not a numeric code/) });
  });
  it("no figures calculated: no base, said so", () => {
    expect(awareBasesFromResult(null, awareness, [{ code: "1" }], new Map())[0]).toMatchObject({ n: null, reason: "No figures were calculated." });
  });
});

describe("associationCellsFromResult: cells by brand code, unknown never 0", () => {
  const grid: BrandGrid = {
    kind: "associations",
    items: [
      { group: "attr_a1", item: "Reliable", byBrand: [{ code: "1", variable: "attr_a1_b1" }, { code: "2", variable: "attr_a1_b2" }] },
      { group: "attr_a2", item: "Safe", byBrand: [{ code: "2", variable: "attr_a2_b2" }] },
    ],
  };
  const vars = new Map(["attr_a1_b1", "attr_a1_b2", "attr_a2_b2"].map((v) => [v, yesNo(v)]));
  const base = (code: string, n: number | null, reason?: string): AwareBase => ({ code, variable: `aware_b${code}`, awareCode: "1", n, effectiveBase: null, ...(reason ? { reason } : {}) });
  it("each attribute's share among the brand's aware respondents; an attribute not asked about the brand is n/a", () => {
    const cells = associationCellsFromResult(result({ attr_a1_b1: [36.2, 831] }), grid, base("1", 831), vars);
    expect(cells).toEqual([
      { code: "1", variable: "attr_a1_b1", share: 36.2, base: 831 },
      { code: "1", variable: "", share: null, base: null, reason: "Not asked about this brand for this attribute." },
    ]);
  });
  it("nobody aware: n/a of a base of 0, never 0%; no base: the base's reason on every cell", () => {
    expect(associationCellsFromResult(null, grid, base("2", 0), vars).map((c) => [c.share, c.base, c.reason])).toEqual([
      [null, 0, "No respondent is aware of this brand."],
      [null, 0, "No respondent is aware of this brand."],
    ]);
    expect(associationCellsFromResult(null, grid, base("2", null, "Awareness was not asked."), vars).every((c) => c.share === null && c.reason === "Awareness was not asked.")).toBe(true);
  });
  it("a share that cannot be read (suppressed, or the selected answer unknown) is n/a with the reason", () => {
    const v2 = new Map(vars);
    v2.set("attr_a2_b2", yesNo("attr_a2_b2", { "0": "No", "1": "Not sure" }));
    const cells = associationCellsFromResult(result({ attr_a1_b2: [null, 4, 1], attr_a2_b2: [20, 40, 8] }), grid, base("2", 40), v2);
    expect(cells[0]).toMatchObject({ share: null, base: 4, reason: "Suppressed for a small base." });
    expect(cells[1]).toMatchObject({ share: null, reason: "Which answer means selected could not be told from its codes and labels." });
  });
});
