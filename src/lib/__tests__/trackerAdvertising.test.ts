// Page 04 "Advertising & WOM" (Grant's design, 29 October 2026), pure parts:
//   - findAdvertisingRecall (trackerRoles.ts): the prompted recall question as asked, found by its wording per brand
//     (not its group), the one keeping "not sure" apart preferred over a derived yes indicator; never by a variable
//     name alone; two candidates are ambiguous;
//   - recallFromResult: yes and not sure shares by code, ranked by yes, unknown never 0;
//   - womFromResult: exclusive groups among all eligible from a table of word of mouth by awareness, adding to 100;
//     groups that the file shows are not exclusive are n/a with the counts;
//   - womParts: no word of mouth question is "not_measured"; awareness unmapped is "mapping_needed".
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));
vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
import { findAdvertisingRecall, recogniseTracker, type BrandFrame, type RoleVariable } from "../trackerRoles";
import { resolveDashboard } from "../trackerDashboard";
import { recallFromResult, womFromResult, womParts } from "../trackerAdvertising";
import type { CrosstabResult } from "../parseStatsFile";

const fixture = (dir: string, name: string): RoleVariable[] => JSON.parse(readFileSync(path.join(process.cwd(), "fixtures", dir, `${name}.json`), "utf8"));
const frame: BrandFrame = { brands: ["Toyota", "Ford", "BMW", "Kia"].map((label, i) => ({ code: String(i + 1), label })), nonBrandCodes: [], questions: [] };
const v = (name: string, label: string, valueLabels?: Record<string, string>): RoleVariable => ({ name, label, numeric: true, ...(valueLabels ? { valueLabels } : {}) });
const ASKED = { "0": "No", "1": "Yes", "9": "Not sure" };

describe("findAdvertisingRecall: the prompted recall question as asked", () => {
  it("BMW pack, codebook (one question ID for the asked question and its derived indicator) and SPSS labels only: the question with Not sure", () => {
    for (const [dir, name] of [["tracker-roles", "bmw_car"], ["tracker-raw", "bmw_car_spss_labels_only"], ["tracker-roles", "banking_brand"]]) {
      const a = recogniseTracker(fixture(dir, name)).advertisingRecall;
      expect(a, name).toMatchObject({ status: "found", label: "Prompted advertising recall", keepsNotSure: true });
      if (a.status !== "found") continue;
      expect(a.byBrand.map((b) => b.variable)).toEqual(Array.from({ length: 10 }, (_, i) => `adprompt_b${String(i + 1).padStart(2, "0")}`));
    }
  });
  it("unprompted recall is never prompted recall; a single yes/no recall question is used, said to keep no not sure", () => {
    const vars = frame.brands.flatMap((b, i) => [v(`unaided_ad_${i}`, `Unprompted advertising recall ${b.label}`, { "0": "Not selected", "1": "Selected" }), v(`ad_${i}`, `Seen advertising for ${b.label}`, { "0": "No", "1": "Yes" })]);
    expect(findAdvertisingRecall(vars, frame)).toMatchObject({ status: "found", label: "Seen advertising for", keepsNotSure: false });
    expect(findAdvertisingRecall(vars.filter((x) => x.name.startsWith("unaided")), frame)).toMatchObject({ status: "not_found" });
  });
  it("two questions that both keep not sure apart: ambiguous, neither used", () => {
    const vars = frame.brands.flatMap((b, i) => [v(`a_${i}`, `Seen advertising for ${b.label}`, ASKED), v(`c_${i}`, `Advertising recall on TV ${b.label}`, ASKED)]);
    expect(findAdvertisingRecall(vars, frame)).toMatchObject({ status: "ambiguous", candidates: ["Seen advertising for", "Advertising recall on TV"] });
  });
  it("a label that repeats the variable's name (a CSV with a linked codebook) is read after the name", () => {
    const vars = frame.brands.map((b, i) => v(`adprompt_b0${i + 1}`, `adprompt_b0${i + 1}. Prompted advertising recall ${b.label}`, ASKED));
    expect(findAdvertisingRecall(vars, frame)).toMatchObject({ status: "found", label: "Prompted advertising recall" });
  });
  it("never from a variable name alone: variables without their own wording or answer list are not read", () => {
    const named = frame.brands.map((_, i) => v(`adprompt_b0${i + 1}`, `adprompt_b0${i + 1}`, ASKED));
    expect(findAdvertisingRecall(named, frame).status).toBe("not_found");
    const noList = frame.brands.map((b, i) => v(`ad_${i}`, `Prompted advertising recall ${b.label}`));
    expect(findAdvertisingRecall(noList, frame).status).toBe("not_found");
  });
});

// A Cross tab result with single-choice questions read from the total column: per code [weighted count, n].
type Answers = Record<string, [number, number]>;
function table(questions: Record<string, Answers>, columns: { var: string; rawCode: string; n: number; perQuestion: Record<string, number> }[] = [], suppressed: string[] = []): CrosstabResult {
  const total = Object.values(questions)[0];
  const totalN = Object.values(total).reduce((s, [, n]) => s + n, 0);
  return {
    total: { n: totalN, w: 0, nEff: 0 },
    columns: columns.map((c) => ({ ...c, block: 0, blockLabel: c.var, name: c.rawCode, w: 0, nEff: 0 })),
    questions: Object.entries(questions).map(([key, answers]) => {
      const w = Object.values(answers).reduce((s, [x]) => s + x, 0);
      const n = Object.values(answers).reduce((s, [, x]) => s + x, 0);
      return {
        key,
        rows: [
          { label: "Base", isBase: true, count: columns.length ? columns.map((c) => c.perQuestion[key] ?? 0) : [n], pct: [null], total: { count: n } },
          ...Object.entries(answers).map(([code, [cw, cn]]) => ({
            label: `answer ${code}`,
            rawCode: code,
            count: [cw],
            nCell: [cn],
            pct: [suppressed.includes(`${key}:${code}`) ? null : (100 * cw) / w],
            pctExact: [suppressed.includes(`${key}:${code}`) ? null : (100 * cw) / w],
            total: { count: cw, countExact: cw, nCell: cn, pct: (100 * cw) / w, pctExact: suppressed.includes(`${key}:${code}`) ? null : (100 * cw) / w },
          })),
        ],
      };
    }),
  } as unknown as CrosstabResult;
}

describe("recallFromResult: yes and not sure by code, ranked", () => {
  const recall = { status: "found" as const, label: "Prompted advertising recall", keepsNotSure: true, byBrand: [{ code: "1", variable: "ad1" }, { code: "2", variable: "ad2" }, { code: "3", variable: "ad3" }] };
  const vars = new Map(["ad1", "ad2", "ad3"].map((n) => [n, v(n, n, ASKED)]));
  it("yes share and not sure share of the same base (not sure is not yes and stays in the base); ranked by yes", () => {
    const r = recallFromResult(table({ ad1: { "0": [50, 50], "1": [30, 30], "9": [20, 20] }, ad2: { "0": [40, 40], "1": [60, 60] }, ad3: { "0": [90, 90], "1": [10, 10], "9": [0.0, 0] } }), recall, [{ code: "1" }, { code: "2" }, { code: "3" }, { code: "4" }], vars);
    expect(r.map((b) => [b.code, b.yes, b.notSure, b.base])).toEqual([
      ["2", 60, 0, 100],
      ["1", 30, 20, 100],
      ["3", 10, 0, 100],
      ["4", null, null, null],
    ]);
    expect(r[3].reason).toBe("Advertising recall was not asked about this brand.");
  });
  it("a selected answer that cannot be told, or no figures, is n/a with the reason and never ranked as 0", () => {
    const odd = new Map(vars);
    odd.set("ad1", v("ad1", "ad1", { "0": "No", "1": "Maybe" }));
    const r = recallFromResult(table({ ad1: { "0": [50, 50], "1": [50, 50] }, ad2: { "0": [100, 100], "1": [0, 0] } }), recall, [{ code: "1" }, { code: "2" }], odd);
    expect(r.map((b) => [b.code, b.yes])).toEqual([["2", 0], ["1", null]]);
    expect(r[1].reason).toMatch(/selected could not be told/);
    expect(recallFromResult(null, recall, [{ code: "1" }], vars)[0]).toMatchObject({ yes: null, reason: "No figures were calculated." });
  });
  it("a suppressed not sure share is not available, never 0", () => {
    const r = recallFromResult(table({ ad1: { "0": [5, 5], "1": [3, 3], "9": [1, 1] } }, [], ["ad1:9"]), recall, [{ code: "1" }], vars);
    expect(r[0].notSure).toBeNull();
  });
});

describe("womFromResult: exclusive groups among all eligible", () => {
  const vars = new Map([
    ["aware1", v("aware1", "Aware Toyota", { "0": "Not selected", "1": "Selected" })],
    ["wom1", v("wom1", "Word of mouth Toyota", { "1": "Mainly positive", "2": "Mainly negative", "3": "Mixed", "4": "Neutral", "5": "Not heard" })],
  ]);
  const cols = (awareN: number, awareAnswered: number, unawareN: number, unawareAnswered: number) => [
    { var: "aware1", rawCode: "0", n: unawareN, perQuestion: { aware1: unawareN, wom1: unawareAnswered } },
    { var: "aware1", rawCode: "1", n: awareN, perQuestion: { aware1: awareN, wom1: awareAnswered } },
  ];
  it("every answer code (one nobody gave is 0 of the known base) and Unaware, each of all eligible, adding to 100", () => {
    const r = womFromResult(table({ aware1: { "0": [25, 20], "1": [75, 80] }, wom1: { "1": [30, 32], "3": [20, 20], "5": [25, 28] } }, cols(80, 80, 20, 0)), "1", "aware1", "wom1", vars);
    expect(r.reason).toBeUndefined();
    expect(r.base).toBe(100);
    expect(r.groups!.map((g) => [g.key, g.label, g.share, g.n])).toEqual([
      ["1", "Mainly positive", 30, 32],
      ["2", "Mainly negative", 0, 0],
      ["3", "Mixed", 20, 20],
      ["4", "Neutral", 0, 0],
      ["5", "Not heard", 25, 28],
      ["unaware", "Unaware", 25, 20],
    ]);
    expect(r.groups!.reduce((s, g) => s + g.share, 0)).toBeCloseTo(100, 12);
  });
  it("an aware respondent without an answer, or an unaware one with an answer: n/a with the counts, never a remainder group", () => {
    const missing = womFromResult(table({ aware1: { "0": [25, 20], "1": [75, 80] }, wom1: { "1": [74, 79] } }, cols(80, 79, 20, 0)), "1", "aware1", "wom1", vars);
    expect(missing).toMatchObject({ groups: null, reason: expect.stringMatching(/1 respondents aware of the brand have no word of mouth answer and 0 not aware/) });
    const extra = womFromResult(table({ aware1: { "0": [25, 20], "1": [75, 80] }, wom1: { "1": [76, 81] } }, cols(80, 80, 20, 1)), "1", "aware1", "wom1", vars);
    expect(extra).toMatchObject({ groups: null, reason: expect.stringMatching(/and 1 not aware of it have one/) });
  });
  it("an awareness answer that cannot be told is n/a with the reason", () => {
    const odd = new Map(vars);
    odd.set("aware1", v("aware1", "Aware Toyota", { "0": "No", "1": "Perhaps" }));
    const r = womFromResult(table({ aware1: { "0": [25, 20], "1": [75, 80] }, wom1: { "1": [75, 80] } }, cols(80, 80, 20, 0)), "1", "aware1", "wom1", odd);
    expect(r).toMatchObject({ groups: null, reason: expect.stringMatching(/means aware could not be told/) });
  });
});

describe("womParts: the word of mouth and awareness questions", () => {
  const vars = fixture("tracker-roles", "bmw_car");
  const rec = recogniseTracker(vars);
  const names = new Set(vars.map((x) => x.name));
  it("BMW pack: the word of mouth question with all ten brands, and the awareness question", () => {
    const p = womParts(rec, resolveDashboard(rec, names, "weight", {}));
    expect(p.status).toBe("ok");
    if (p.status !== "ok") return;
    expect(p.wom.byBrand.find((b) => b.code === "8")?.variable).toBe("wom_b08");
    expect(p.awareness.byBrand.find((b) => b.code === "8")?.variable).toBe("aware_b08");
  });
  it("word of mouth set to no stage: not measured; awareness unmapped: mapping needed", () => {
    const d = resolveDashboard(rec, names, "weight", {});
    const womGroup = d.stages.find((s) => s.stage === "word_of_mouth")!.group;
    expect(womParts(rec, resolveDashboard(rec, names, "weight", { stages: { [womGroup]: null } }))).toMatchObject({ status: "not_measured" });
    const awareGroup = d.stages.find((s) => s.stage === "awareness")!.group;
    expect(womParts(rec, resolveDashboard(rec, names, "weight", { stages: { [awareGroup]: null } }))).toMatchObject({ status: "mapping_needed", reason: expect.stringMatching(/No question is mapped as awareness/) });
  });
});
