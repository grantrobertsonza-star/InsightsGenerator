// R6 CSM extension: keys, grains and sample separation (pure rules; the database tests read the pack's files).
import { describe, expect, it, vi } from "vitest";

// The modules under test import the database and storage clients; nothing here reaches them.
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { checkChannelLink, checkKeys, companyListProblems, waveValues } from "../csmExtensionKeys";
import { csmGrainOf, fieldOf, isCsmExtensionField, SAMPLE_TYPE_OF } from "../csmExtensionRoles";
import { parseExtensionRequest } from "../csmExtension";
import { readDistribution, readStatistic } from "../csmExtensionMetrics";
import type { CrosstabResult } from "../parseStatsFile";

describe("grain and sample type from the file itself", () => {
  const rel = ["respondent_id", "wave", "company", "company_csat5", "journey_recent30"];
  const ch = ["respondent_id", "experience_id", "channel", "channel_csat5"];
  const nc = ["respondent_id", "company", "focal_company", "current_focal_use"];
  it("structure decides; the data sheet must agree", () => {
    expect(csmGrainOf(rel, "Respondents")).toMatchObject({ grain: "relationship", sampleType: "current_customers" });
    expect(csmGrainOf(ch, "Experiences")).toMatchObject({ grain: "channel", sampleType: "current_customers" });
    expect(csmGrainOf(nc, "Noncustomers")).toMatchObject({ grain: "noncustomer", sampleType: "focal_noncustomers" });
    // A file with no sheet (SPSS, CSV) is read by its structure.
    expect(csmGrainOf(rel, null)).toMatchObject({ grain: "relationship" });
    // A sheet naming another family contradicts the fields: unknown, with the reason (never a guess).
    const bad = csmGrainOf(rel, "Noncustomers");
    expect(bad.grain).toBeNull();
    expect("reason" in bad && bad.reason).toMatch(/names the noncustomer family/);
    expect(csmGrainOf(["company_csat5"], "Respondents")).toMatchObject({ grain: null });
    expect(csmGrainOf([...ch, "focal_company", "current_focal_use"], null)).toMatchObject({ grain: null });
    expect(SAMPLE_TYPE_OF).toEqual({ relationship: "current_customers", channel: "current_customers", noncustomer: "focal_noncustomers" });
  });
});

describe("keys: text IDs, one latest row per customer and channel, no union of grains", () => {
  it("leading zeroes are kept as text; a numeric ID is refused", () => {
    const ok = checkKeys([{ respondent_id: "01100001" }, { respondent_id: "01100002" }], "relationship");
    expect(ok).toMatchObject({ ok: true, records: 2, distinctPeople: 2 });
    expect([...ok.ids]).toEqual(["01100001", "01100002"]);
    const numeric = checkKeys([{ respondent_id: 1100001 }, { respondent_id: "01100002" }], "relationship");
    expect(numeric.ok).toBe(false);
    expect(numeric.problems[0]).toMatch(/not text in 1 record .*leading zeroes/);
  });
  it("a repeated customer, or two latest rows for one customer in one channel, is refused", () => {
    expect(checkKeys([{ respondent_id: "0001" }, { respondent_id: "0001" }], "relationship").problems[0]).toMatch(/repeats/);
    const ch = checkKeys(
      [
        { respondent_id: "0001", channel: 1, experience_id: "0001-C1" },
        { respondent_id: "0001", channel: 2, experience_id: "0001-C2" },
        { respondent_id: "0001", channel: 2, experience_id: "0001-C2b" },
      ],
      "channel",
    );
    expect(ch.ok).toBe(false);
    expect(ch.problems.join(" ")).toMatch(/More than one latest record .*0001 in channel 2/);
    // Several channels for one customer are one person: distinct customers stay 1, records 3.
    expect(ch.distinctPeople).toBe(1);
    expect(ch.records).toBe(3);
    expect(checkKeys([{ respondent_id: "1", channel: 1, experience_id: "X" }, { respondent_id: "2", channel: 1, experience_id: "X" }], "channel").problems.join(" ")).toMatch(/experience_id is missing or repeated: X/);
  });
  it("channel records link to the same wave's customers with the same weight", () => {
    const rel = [{ respondent_id: "0001", weight: 0.8 }, { respondent_id: "0002", weight: 1.2 }];
    expect(checkChannelLink([{ respondent_id: "0001", weight: 0.8 }], rel)).toEqual([]);
    expect(checkChannelLink([{ respondent_id: "0009", weight: 1 }], rel)[0]).toMatch(/belongs to no customer/);
    expect(checkChannelLink([{ respondent_id: "0002", weight: 1 }], rel)[0]).toMatch(/weight different/);
  });
  it("wave values and company lists must agree across linked files", () => {
    expect(waveValues([{ wave: 1 }, { wave: 1 }])).toEqual(["1"]);
    expect(waveValues([{ x: 1 }])).toEqual([]);
    const banks = [{ code: "1", label: "FNB" }, { code: "2", label: "Standard Bank" }];
    expect(companyListProblems(banks, banks, "a", "b")).toEqual([]);
    expect(companyListProblems(banks, [{ code: "1", label: "Vodacom" }], "a", "b")[0]).toMatch(/name companies differently/);
  });
});

describe("fields are confirmed by their answer lists", () => {
  const v = (name: string, valueLabels?: Record<string, string>, extra = {}) => ({ name, label: name, valueLabels, numeric: true, ...extra });
  it("an emotion needs its 1 to 5 scale declared; an outcome its pending code", () => {
    const scale = { "1": "Not at all", "2": "A little", "3": "Moderately", "4": "Very", "5": "Extremely", "99": "Do not know" };
    expect(fieldOf([v("journey_reassured5", scale)], "journey_reassured5", { kind: "scale", lo: 1, hi: 5 }).status).toBe("found");
    expect(fieldOf([v("journey_reassured5", { "1": "a", "2": "b" })], "journey_reassured5", { kind: "scale", lo: 1, hi: 5 })).toMatchObject({ status: "not_measured", reason: expect.stringMatching(/missing 3, 4, 5/) });
    expect(fieldOf([], "journey_status", { kind: "codes", required: [1, 2, 3, 9] })).toMatchObject({ status: "not_measured", reason: "journey_status is not in this file." });
    expect(fieldOf([v("journey_status", { "1": "Completed", "2": "Partly", "3": "Unresolved" })], "journey_status", { kind: "codes", required: [1, 2, 3, 9] })).toMatchObject({ status: "not_measured", reason: expect.stringMatching(/code 9/) });
  });
});

describe("the extension's fields are never a company CSM role", () => {
  it("journey, benchmark and noncustomer fields are the extension's; a brand tracker's purchase journey list is not", () => {
    for (const n of ["journey_csat5", "benchmark_csat5", "journey_status", "channel_reassured5", "stay_reason_r01", "expect_level_d03", "alternative_csat5", "focal_consider5"]) expect(isCsmExtensionField(n), n).toBe(true);
    for (const n of ["journey_j01", "company_csat5", "channel_csat5", "recommend_0to10", "continue5"]) expect(isCsmExtensionField(n), n).toBe(false);
  });
  it("a screening flag declaring only 0 is a 0/1 answer; one declaring 2 is not", () => {
    const v = (labels: Record<string, string>) => [{ name: "current_focal_use", label: "x", valueLabels: labels, numeric: true }];
    expect(fieldOf(v({ "0": "No" }), "current_focal_use", { kind: "binary" }).status).toBe("found");
    expect(fieldOf(v({ "0": "No", "2": "Maybe" }), "current_focal_use", { kind: "binary" }).status).toBe("not_measured");
  });
});

describe("statistics read from the engine's rows (domains, non-answers, pending)", () => {
  const q = (rows: { code: string; label: string; w: number; n: number }[]) =>
    ({
      key: "x",
      label: "x",
      kind: "single",
      rows: rows.map((r) => ({ label: r.label, rawCode: r.code, count: [r.w], countExact: [r.w], nCell: [r.n], pct: [null], rowPct: [], p: [], sig: [], base: [], total: { count: r.w, countExact: r.w, nCell: r.n, pct: null, base: { n: 0, w: 0, nEff: 0 } } })),
    }) as unknown as CrosstabResult["questions"][number];
  it("top two, mean and the disclosed don't know", () => {
    const x = q([
      { code: "1", label: "Very dissatisfied", w: 10, n: 10 },
      { code: "4", label: "Satisfied", w: 30, n: 30 },
      { code: "5", label: "Very satisfied", w: 20, n: 20 },
      { code: "99", label: "Do not know", w: 5, n: 5 },
    ]);
    const t2b = readStatistic(x, "total", "t2b");
    expect(t2b).toMatchObject({ value: (50 / 60) * 100, weightedBase: 60, rawBase: 60, nonresponse: 5, outsideDomain: 0 });
    expect(readStatistic(x, "total", "mean5").value).toBeCloseTo((10 + 120 + 100) / 60, 12);
  });
  it("a pending code is an answer in an outcome distribution, a 0 is a valid answer", () => {
    const status = q([
      { code: "1", label: "Completed", w: 60, n: 60 },
      { code: "2", label: "Partly completed", w: 10, n: 10 },
      { code: "3", label: "Unresolved", w: 10, n: 10 },
      { code: "9", label: "Still pending", w: 20, n: 20 },
    ]);
    const d = readDistribution(status, "total", ["1", "2", "3", "9"]);
    expect(d.weightedBase).toBe(100);
    expect(d.rows.find((r) => r.code === "9")?.share).toBe(20);
    const yes = readStatistic(q([{ code: "0", label: "No", w: 70, n: 70 }, { code: "1", label: "Yes", w: 30, n: 30 }]), "total", "yes");
    expect(yes).toMatchObject({ value: 30, rawBase: 100 });
  });
  it("no valid answer is no value, never 0; small bases are flagged", () => {
    const none = readStatistic(q([{ code: "99", label: "Do not know", w: 3, n: 3 }]), "total", "t2b");
    expect(none).toMatchObject({ value: null, nonresponse: 3, reason: "No valid answers in this group." });
    expect(readStatistic(q([{ code: "5", label: "Very satisfied", w: 20, n: 20 }]), "total", "t2b").baseLevel).toBe("very_small");
    expect(readStatistic(q([{ code: "5", label: "Very satisfied", w: 40, n: 40 }]), "total", "t2b").baseLevel).toBe("small");
  });
  it("a paired gap uses its own -4 to 4 domain", () => {
    const g = readStatistic(q([{ code: "-2", label: "-2", w: 1, n: 1 }, { code: "1", label: "1", w: 3, n: 3 }]), "total", "mean_gap");
    expect(g.value).toBeCloseTo((-2 + 3) / 4, 12);
  });
});

describe("the server boundary", () => {
  it("accepts a section and numeric codes; refuses anything else", () => {
    expect(parseExtensionRequest({ section: "journey", company: "1", task: null, journeyChannel: "" })).toEqual({ ok: true, section: "journey", filters: { company: "1", task: null, journeyChannel: null, dataWave: null } });
    expect(parseExtensionRequest({ section: "nope" }).ok).toBe(false);
    expect(parseExtensionRequest({ section: "journey", company: "FNB" }).ok).toBe(false);
    expect(parseExtensionRequest(null).ok).toBe(false);
  });
});
