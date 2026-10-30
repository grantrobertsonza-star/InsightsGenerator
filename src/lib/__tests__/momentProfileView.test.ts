// Page 02's Moment profile and Moment reach, display rules (src/lib/momentProfileView.ts) and the pure parts of the
// loaders (trackerMomentProfile.momentProfileParts, trackerMomentReach.reachFromSummaries):
//   - moments ordered by category relevance by identity (the grid item's group), ties in the grid's order, unknown
//     relevance after every ranked moment, never as 0; no relevance at all keeps the grid's order, said;
//   - "the six most relevant" equals the recall table's count (RECALL_MOMENTS); a chosen set stays in axis order;
//   - brands: the client's first, at most five, a sixth refused with the reason, the client's brand kept;
//   - an n/a value breaks its line (no segment through an unknown value);
//   - the remembered view survives storage that throws;
//   - reach: ranking with unknowns last, the headline, the share of links withheld unless every brand's base is
//     every eligible respondent, a brand nobody links is a known 0 with per linker n/a.
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));
vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
import {
  PROFILE_MAX_BRANDS,
  PROFILE_TOP_MOMENTS,
  defaultProfileBrands,
  orderProfileMoments,
  profileAxisMax,
  profileSegments,
  rankReach,
  reachHeadline,
  readMomentCardView,
  selectProfileMoments,
  toggleProfileBrand,
  writeMomentCardView,
  momentCardViewKey,
} from "../momentProfileView";
import { RECALL_MOMENTS } from "../trackerMoments";
import { momentProfileParts } from "../trackerMomentProfile";
import { reachFromSummaries } from "../trackerMomentReach";
import { recogniseTracker, type RoleVariable, type TrackerRecognition, type BrandGrid } from "../trackerRoles";
import { resolveDashboard } from "../trackerDashboard";
import type { LinkCountSummary } from "../parseStatsFile";

const M = (n: number) => ({ group: `cep_c${String(n).padStart(2, "0")}`, item: `Moment ${n}` });

describe("orderProfileMoments: x axis order by category relevance", () => {
  const moments = [M(1), M(2), M(3), M(4), M(5)];
  it("highest relevance first, by the grid item's group; ties in the grid's order; unknown last in the grid's order", () => {
    const relevance = [
      { gridGroup: "cep_c03", share: 70.1 },
      { gridGroup: "cep_c01", share: 50 },
      { gridGroup: "cep_c05", share: 50 },
      { gridGroup: "cep_c02", share: null },
      { gridGroup: null, share: 99 },
    ];
    const { moments: out, byRelevance } = orderProfileMoments(moments, relevance);
    expect(byRelevance).toBe(true);
    expect(out.map((m) => m.group)).toEqual(["cep_c03", "cep_c01", "cep_c05", "cep_c02", "cep_c04"]);
    expect(out.map((m) => m.relevance)).toEqual([70.1, 50, 50, null, null]);
  });
  it("unrounded: 50.04 ranks above 50.01 although both show 50.0%", () => {
    const { moments: out } = orderProfileMoments([M(1), M(2)], [{ gridGroup: "cep_c01", share: 50.01 }, { gridGroup: "cep_c02", share: 50.04 }]);
    expect(out.map((m) => m.group)).toEqual(["cep_c02", "cep_c01"]);
  });
  it("no relevance available: the grid's order, said (byRelevance false)", () => {
    const { moments: out, byRelevance } = orderProfileMoments(moments, null);
    expect(byRelevance).toBe(false);
    expect(out.map((m) => m.group)).toEqual(moments.map((m) => m.group));
  });
});

describe("selectProfileMoments", () => {
  const twelve = Array.from({ length: 12 }, (_, i) => ({ ...M(i + 1), relevance: i === 3 ? null : 90 - i }));
  it("the six most relevant equal the recall table's count and skip a moment without relevance", () => {
    expect(PROFILE_TOP_MOMENTS).toBe(RECALL_MOMENTS);
    const top = selectProfileMoments(twelve, { kind: "top" });
    expect(top.map((m) => m.group)).toEqual(["cep_c01", "cep_c02", "cep_c03", "cep_c05", "cep_c06", "cep_c07"]);
  });
  it("all, and a chosen set kept in axis order whatever order it was chosen in; a moment the file lacks dropped", () => {
    expect(selectProfileMoments(twelve, { kind: "all" })).toHaveLength(12);
    expect(selectProfileMoments(twelve, { kind: "chosen", groups: ["cep_c09", "cep_c02", "cep_c99"] }).map((m) => m.group)).toEqual(["cep_c02", "cep_c09"]);
  });
});

describe("brands drawn", () => {
  const list = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];
  it("default: the client's brand first, then the brands compared, at most five, only listed codes", () => {
    expect(defaultProfileBrands("8", ["1", "2", "8", "3", "4", "5", "99"], list)).toEqual(["8", "1", "2", "3", "4"]);
    expect(defaultProfileBrands(null, ["2", "1"], list)).toEqual(["2", "1"]);
  });
  it("a sixth brand is refused with the reason; the client's brand stays; others keep the brand list's order", () => {
    const five = ["8", "1", "2", "3", "4"];
    expect(PROFILE_MAX_BRANDS).toBe(5);
    expect(toggleProfileBrand(five, "6", "8", list)).toEqual({ brands: five, refused: expect.stringMatching(/Up to 5 brands/) });
    expect(toggleProfileBrand(five, "8", "8", list)).toEqual({ brands: five, refused: expect.stringMatching(/always shown/) });
    const four = toggleProfileBrand(five, "2", "8", list).brands;
    expect(four).toEqual(["8", "1", "3", "4"]);
    expect(toggleProfileBrand(four, "10", "8", list).brands).toEqual(["8", "1", "3", "4", "10"]);
    expect(toggleProfileBrand(["8", "4"], "2", "8", list).brands).toEqual(["8", "2", "4"]);
  });
});

describe("drawing", () => {
  it("an n/a value breaks the line: no segment touches it", () => {
    expect(profileSegments([10, 12, null, 14, 15, null])).toEqual([
      [0, 1],
      [3, 4],
    ]);
  });
  it("axis: the next 10 above the highest value, at least 20, at most 100; unknowns ignored", () => {
    expect(profileAxisMax([3, null, 12.1])).toBe(20);
    expect(profileAxisMax([41])).toBe(50);
    expect(profileAxisMax([100])).toBe(100);
    expect(profileAxisMax([null])).toBe(20);
  });
});

describe("remembered view", () => {
  it("per data file, recall table by default, profile when stored; storage that throws falls back and reports false", () => {
    const store = new Map<string, string>();
    const ok = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    expect(readMomentCardView(ok, "doc-a")).toBe("recall");
    expect(writeMomentCardView(ok, "doc-a", "profile")).toBe(true);
    expect(store.get(momentCardViewKey("doc-a"))).toBe("profile");
    expect(readMomentCardView(ok, "doc-a")).toBe("profile");
    expect(readMomentCardView(ok, "doc-b")).toBe("recall");
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readMomentCardView(broken, "doc-a")).toBe("recall");
    expect(writeMomentCardView(broken, "doc-a", "profile")).toBe(false);
    expect(readMomentCardView(null, "doc-a")).toBe("recall");
  });
});

describe("momentProfileParts", () => {
  const vars: RoleVariable[] = JSON.parse(readFileSync(path.join(process.cwd(), "fixtures", "tracker-roles", "bmw_car.json"), "utf8"));
  const rec = recogniseTracker(vars);
  const names = new Set(vars.map((v) => v.name));
  it("BMW pack: the moments grid (12 moments) and the awareness question", () => {
    const p = momentProfileParts(rec, resolveDashboard(rec, names, "weight", {}));
    expect(p.status).toBe("ok");
    if (p.status !== "ok") return;
    expect(p.grid.items).toHaveLength(12);
    expect(p.awareness.byBrand[0].variable).toBe("aware_b01");
  });
  it("awareness unmapped: mapping needed (never all respondents); no moments grid: not measured", () => {
    const awareGroup = resolveDashboard(rec, names, "weight", {}).stages.find((s) => s.stage === "awareness")!.group;
    const p = momentProfileParts(rec, resolveDashboard(rec, names, "weight", { stages: { [awareGroup]: null } }));
    expect(p).toMatchObject({ status: "mapping_needed", reason: expect.stringMatching(/moment profile/) });
    const noGrid: TrackerRecognition = { ...rec, grids: rec.grids.filter((g) => g.kind !== "moments") };
    expect(momentProfileParts(noGrid, resolveDashboard(noGrid, names, "weight", {}))).toMatchObject({ status: "not_measured" });
  });
});

describe("reach: figures, share of links and ranking", () => {
  const grid: BrandGrid = { kind: "moments", items: [1, 2].map((c) => ({ group: `cep_c0${c}`, item: `M${c}`, byBrand: ["1", "2", "3"].map((b) => ({ code: b, variable: `cep_c0${c}_b0${b}` })) })) };
  const s = (o: Partial<LinkCountSummary>): LinkCountSummary => ({ eligible: 100, n: 100, w: 100, nEff: 90, noneValid: 0, partlyValid: 0, meanExact: 1, anyPctExact: 50, linkers: 50, perLinkerExact: 2, linksExact: 100, ...o });
  const brands = [{ code: "1" }, { code: "2" }, { code: "3" }];
  it("every brand's base is every eligible respondent: shares of links add to 100; nobody links is 0 known, per linker n/a", () => {
    const r = reachFromSummaries(brands, grid, new Map([["1", s({ linksExact: 150 })], ["2", s({ linksExact: 50 })], ["3", s({ meanExact: 0, anyPctExact: 0, linkers: 0, perLinkerExact: null, linksExact: 0 })]]), true);
    expect(r.shareWithheld).toBeNull();
    expect(r.brands.map((b) => b.shareOfLinks)).toEqual([75, 25, 0]);
    expect(r.brands[2]).toMatchObject({ perPerson: 0, penetration: 0, perLinker: null, perLinkerReason: expect.stringMatching(/Nobody links/) });
    expect(r.brands[0].effectiveBase).toBe(90);
  });
  it("withheld for every brand when one brand's count is unknown, or a base is not every eligible respondent", () => {
    const unknown = reachFromSummaries(brands, grid, new Map<string, LinkCountSummary | { reason: string }>([["1", s({})], ["2", s({})], ["3", { reason: "code unknown" }]]), false);
    expect(unknown.shareWithheld).toMatch(/unknown/);
    expect(unknown.brands.map((b) => b.shareOfLinks)).toEqual([null, null, null]);
    expect(unknown.brands[2]).toMatchObject({ perPerson: null, reason: "code unknown" });
    expect(unknown.brands[0].effectiveBase).toBeNull();
    const partial = reachFromSummaries(brands, grid, new Map([["1", s({})], ["2", s({ n: 99, partlyValid: 1 })], ["3", s({})]]), true);
    expect(partial.shareWithheld).toMatch(/did not answer every moment/);
  });
  it("a suppressed base: n/a with the reason, never 0", () => {
    const r = reachFromSummaries(brands, grid, new Map([["1", s({ n: 6, meanExact: null, anyPctExact: null, perLinkerExact: null })], ["2", s({})], ["3", s({})]]), true);
    expect(r.brands[0]).toMatchObject({ perPerson: null, penetration: null, base: 6, reason: "Suppressed for a small base." });
  });
  it("ranking: highest first, ties in list order, unknown last and unranked; the headline uses rank among known", () => {
    const rows = [
      { code: "1", perPerson: 1.2, penetration: 40, perLinker: 3, shareOfLinks: 20 },
      { code: "2", perPerson: null, penetration: null, perLinker: null, shareOfLinks: null },
      { code: "3", perPerson: 1.84, penetration: 42.4, perLinker: 4.3, shareOfLinks: 30 },
      { code: "4", perPerson: 1.2, penetration: 45, perLinker: 2.7, shareOfLinks: 20 },
    ];
    const r = rankReach(rows, "perPerson");
    expect(r.map((x) => [x.brand.code, x.rank, x.of])).toEqual([
      ["3", 1, 3],
      ["1", 2, 3],
      ["4", 3, 3],
      ["2", null, 3],
    ]);
    expect(rankReach(rows, "penetration").map((x) => x.brand.code)).toEqual(["4", "3", "1", "2"]);
    const name = (c: string) => ({ "1": "Kia", "3": "Toyota", "4": "Ford" })[c] ?? c;
    expect(reachHeadline(rows, "3", name)).toBe("Toyota: 1.8 moments per person, 1st of 3; linked to at least one moment by 42%");
    expect(reachHeadline(rows, "4", name)).toBe("Ford: 1.2 moments per person, 3rd of 3; linked to at least one moment by 45%");
    expect(reachHeadline(rows, "2", name)).toBeNull();
    expect(reachHeadline(rows, null, name)).toBeNull();
  });
});
