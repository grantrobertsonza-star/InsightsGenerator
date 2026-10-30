// R5 (Grant, 30 October 2026: "yes, we need it ... don't want to over complicate"): time windows and the tracker type
// (Durables or FMCG). Expected values are written from the brief, not from the code: "Bought in the past 3 months" is
// usage in that window (FMCG penetration), not acquisition; "acquired" and a durable's 12-month purchase stay
// acquisition; the BMW pack's stages do not move; the type is suggested with its reason, a saved choice replaces it, and
// it sets the overview's stages and order; a wave change is withheld when the window changed.
import { describe, expect, it, vi } from "vitest";
// trackerFigures and trackerOverview import the engine and database modules; these tests call only their pure parts.
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));
vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
import { readFileSync } from "node:fs";
import path from "node:path";
import { choiceProblems, normaliseChoices, resolveDashboard } from "../trackerDashboard";
import { changesAgainst, overviewMeasures, type StageFigures } from "../trackerFigures";
import { stageTilesOf } from "../trackerOverview";
import { recogniseTracker, type RoleVariable } from "../trackerRoles";
import { suggestTrackerType } from "../trackerType";
import { windowChangeReason, windowOf, windowSuffix } from "../trackerWindows";

const BRANDS = ["Crunchos", "Nutty Bar", "Fresh Bake", "Golden Crisp"];
const YES_NO = { "0": "No", "1": "Yes" };

/** A per-brand yes/no question as a codebook gives it (question ID, multiple-response set). */
function asked(group: string, wording: string, labels: Record<string, string> = YES_NO, form: "codebook" | "csv" | "labels" = "codebook"): RoleVariable[] {
  return BRANDS.map((b, i) => {
    const name = `${group}_b${i + 1}`;
    const text = `${wording} ${b}`;
    if (form === "csv") return { name, label: `${name}. ${text}`, valueLabels: labels, questionId: group.toUpperCase(), numeric: true };
    if (form === "labels") return { name, label: text, valueLabels: labels, group, numeric: true };
    return { name, label: text, valueLabels: labels, questionId: group.toUpperCase(), questionType: "multiple_response" as const, group, numeric: true };
  });
}
/** The single-choice brand question whose answer list is the brand frame. */
const mostOften: RoleVariable = { name: "most_often", label: "Brand bought most often", valueLabels: { "1": BRANDS[0], "2": BRANDS[1], "3": BRANDS[2], "4": BRANDS[3], "98": "None of these" }, numeric: true };

function fmcg(form: "codebook" | "csv" | "labels" = "codebook", recent = "Bought in the past 3 months"): RoleVariable[] {
  return [
    mostOften,
    ...asked("aware", "Aware", { "0": "Not aware", "1": "Aware" }, form),
    ...asked("consider", "Would consider", YES_NO, form),
    ...asked("ever", "Ever bought", YES_NO, form),
    ...asked("p3m", recent, YES_NO, form),
    ...asked("bumo", "Buy most often", YES_NO, form),
  ];
}
const stages = (r: ReturnType<typeof recogniseTracker>) => Object.fromEntries(r.measures.map((m) => [m.group.replace(/^q:/, "").toLowerCase(), m.stage]));
const windows = (r: ReturnType<typeof recogniseTracker>) => Object.fromEntries(r.measures.map((m) => [m.group.replace(/^q:/, "").toLowerCase(), m.window]));

describe("recognition: a purchase or use question in a recent window is usage in that window", () => {
  for (const form of ["codebook", "csv", "labels"] as const) {
    it(`an FMCG codebook (${form} form): aware, would consider, ever bought, bought in the past 3 months, buy most often`, () => {
      const r = recogniseTracker(fmcg(form));
      expect(r.type).toBe("brand");
      expect(r.frame?.brands.map((b) => b.label)).toEqual(BRANDS);
      expect(stages(r)).toEqual({ aware: "awareness", consider: "consideration", ever: "trial", p3m: "usage", bumo: "frequent_usage" });
      expect(windows(r)).toEqual({ aware: "unknown", consider: "unknown", ever: "ever", p3m: "past_3_months", bumo: "unknown" });
      expect(r.measures.find((m) => m.group.toLowerCase().includes("p3m"))?.stageReason).toMatch(/"Bought" in a recent window/);
      expect(r.questions.some((q) => q.id.startsWith("stage:"))).toBe(false);
    });
  }
  for (const [wording, window] of [
    ["Bought P3M", "past_3_months"],
    ["Bought in the past three months", "past_3_months"],
    ["Purchased in the last 4 weeks", "past_month"],
    ["Bought in the past month", "past_month"],
    ["Purchased P1M", "past_month"],
    ["Bought in the past week", "past_week"],
    ["Used in the past 6 months", "past_6_months"],
    ["Bought in the last 13 weeks", "past_3_months"],
  ] as const) {
    it(`"${wording}" is usage, ${window}`, () => {
      const r = recogniseTracker([mostOften, ...asked("aware", "Aware"), ...asked("consider", "Would consider"), ...asked("p", wording)]);
      const m = r.measures.find((x) => x.group === "p")!;
      expect([m.stage, m.window]).toEqual(["usage", window]);
    });
  }
  it('"Acquired" and "Recently acquired" stay acquisition; so does a take-up in a recent window ("Started using in the past 3 months")', () => {
    for (const wording of ["Acquired", "Recently acquired", "Started using in the past 3 months"]) {
      const r = recogniseTracker([mostOften, ...asked("aware", "Aware"), ...asked("a", wording)]);
      expect(r.measures.find((x) => x.group === "a")?.stage, wording).toBe("acquisition");
    }
  });
  it('a durable\'s "Bought in the past 12 months" stays acquisition (12 months), with an FMCG reading of usage kept beside it', () => {
    const r = recogniseTracker([mostOften, ...asked("aware", "Aware"), ...asked("shortlist", "Shortlist"), ...asked("own", "Currently own"), ...asked("b12", "Bought in the past 12 months")]);
    const m = r.measures.find((x) => x.group === "b12")!;
    expect([m.stage, m.window]).toEqual(["acquisition", "past_12_months"]);
    expect(m.stageByType).toEqual({ durables: "acquisition", fmcg: "usage" });
    expect(r.measures.find((x) => x.group === "own")?.window).toBe("currently");
    expect(r.trackerType.type).toBe("durables");
  });
  it("the window is read from the answer labels when the wording states none", () => {
    const r = recogniseTracker([mostOften, ...asked("aware", "Aware"), ...asked("consider", "Would consider"), ...asked("bought", "Bought", { "0": "Not bought", "1": "Bought in the last 4 weeks" })]);
    const m = r.measures.find((x) => x.group === "bought")!;
    expect([m.stage, m.window]).toEqual(["usage", "past_month"]);
    expect(m.windowReason).toMatch(/its answers say/);
  });
  it("two periods in one wording are unknown, never one of them", () => {
    expect(windowOf("Bought in the past 3 months or past 12 months").window).toBe("unknown");
    expect(windowOf("Prompted awareness")).toEqual({ window: "unknown", reason: "neither the question nor its answers state a period" });
  });
});

describe("the BMW pack's recognition does not move", () => {
  const bmw: RoleVariable[] = JSON.parse(readFileSync(path.join(process.cwd(), "fixtures", "tracker-roles", "bmw_car.json"), "utf8"));
  const r = recogniseTracker(bmw);
  it("every stage as before; ownership is current, the 12-month acquisition keeps acquisition with no type-dependent reading", () => {
    const s = Object.fromEntries(r.measures.map((m) => [m.group, m.stage]));
    expect([s.unaided, s.aware, s.consider, s.shortlist, s["q:F3"], s.owner, s.bought12, s["q:O4"], s["q:R1"], s["q:W1"]]).toEqual([
      "unaided_awareness", "awareness", "consideration", "shortlist", "first_choice", "usage", "acquisition", "repeat", "rejection", "word_of_mouth",
    ]);
    const w = Object.fromEntries(r.measures.map((m) => [m.group, m.window]));
    expect([w.owner, w.bought12, w["q:O4"]]).toEqual(["currently", "past_12_months", "past_12_months"]);
    expect(r.measures.find((m) => m.group === "bought12")?.stageByType).toBeUndefined();
  });
  it("is suggested Durables, with the reason", () => {
    expect(r.trackerType.type).toBe("durables");
    expect(r.trackerType.reason).toMatch(/shortlist or first choice/);
    expect(r.trackerType.reason).toMatch(/current ownership or use/);
  });
});

describe("tracker type: suggested from the questions, replaced by a choice, and setting the overview's stages", () => {
  const r = recogniseTracker(fmcg());
  const names = new Set(fmcg().map((v) => v.name));
  it("the FMCG codebook is suggested FMCG: a recent purchase window and a bought most often question, no shortlist", () => {
    expect(r.trackerType.type).toBe("fmcg");
    expect(r.trackerType.reason).toMatch(/recent window.*past 3 months/);
    expect(r.trackerType.reason).toMatch(/bought most often/);
  });
  it("FMCG overview: awareness, consideration, ever tried, bought in the window, bought most often, in that order", () => {
    const d = resolveDashboard(r, names, null, {});
    expect(d.trackerType).toMatchObject({ type: "fmcg", source: "suggested", suggested: "fmcg" });
    expect(d.overviewStages).toEqual(["awareness", "consideration", "trial", "usage", "frequent_usage"]);
    expect(overviewMeasures(r, d).shown.map((s) => s.measure.group)).toEqual(["aware", "consider", "ever", "p3m", "bumo"]);
    expect(stageTilesOf(r, d).map((t) => [t.stage, t.status, t.window])).toEqual([
      ["awareness", "shown", "unknown"], ["consideration", "shown", "unknown"], ["trial", "shown", "ever"], ["usage", "shown", "past_3_months"], ["frequent_usage", "shown", "unknown"],
    ]);
  });
  it("a saved choice of Durables replaces the suggestion and sets the Durables order; the researcher's stage mapping still applies", () => {
    const d = resolveDashboard(r, names, null, { trackerType: "durables", stages: { ever: "shortlist" } });
    expect(d.trackerType).toMatchObject({ type: "durables", source: "chosen", suggested: "fmcg" });
    expect(d.overviewStages).toEqual(["awareness", "consideration", "shortlist", "first_choice", "usage", "acquisition"]);
    expect(stageTilesOf(r, d).find((t) => t.stage === "shortlist")).toMatchObject({ status: "shown", groups: ["ever"] });
  });
  it("a 12-month purchase is acquisition for Durables and annual penetration (usage) for FMCG, unless another question is already usage", () => {
    const vars = [mostOften, ...asked("aware", "Aware"), ...asked("consider", "Would consider"), ...asked("b12", "Bought in the past 12 months"), ...asked("bumo", "Buy most often")];
    const rec = recogniseTracker(vars);
    const n = new Set(vars.map((v) => v.name));
    const stageOfB12 = (choices: Parameters<typeof resolveDashboard>[3]) => resolveDashboard(rec, n, null, choices).stages.find((s) => s.group === "b12")!.stage;
    expect(rec.trackerType.type).toBe("fmcg");
    expect(stageOfB12({})).toBe("usage");
    expect(stageOfB12({ trackerType: "durables" })).toBe("acquisition");
    // With a P3M question as usage, the 12-month purchase stays acquisition under FMCG: no contest is created.
    const withP3m = [...vars, ...asked("p3m", "Bought in the past 3 months")];
    const rec2 = recogniseTracker(withP3m);
    const d2 = resolveDashboard(rec2, new Set(withP3m.map((v) => v.name)), null, {});
    expect(d2.stages.find((s) => s.group === "b12")?.stage).toBe("acquisition");
    expect(d2.stages.find((s) => s.group === "p3m")?.stage).toBe("usage");
    // A chosen stage is never changed by the type.
    expect(stageOfB12({ stages: { b12: "acquisition" } })).toBe("acquisition");
  });
  it("no suggestion when the questions settle neither: the untyped list, and the reason asks for a choice", () => {
    const vars = [mostOften, ...asked("aware", "Aware"), ...asked("consider", "Would consider")];
    const rec = recogniseTracker(vars);
    expect(rec.trackerType.type).toBeNull();
    const d = resolveDashboard(rec, new Set(vars.map((v) => v.name)), null, {});
    expect(d.trackerType.type).toBeNull();
    expect(d.overviewStages).toEqual(["awareness", "consideration", "shortlist", "first_choice", "trial", "usage", "frequent_usage"]);
    expect(d.trackerType.reason).toMatch(/Choose one/);
  });
  it("FMCG signals with a shortlist question are Durables (the considered-purchase funnel)", () => {
    expect(suggestTrackerType([{ label: "Bought P3M", stage: "usage", window: "past_3_months" }, { label: "Shortlist", stage: "shortlist", window: "unknown" }]).type).toBe("durables");
    expect(suggestTrackerType([{ label: "Buy most often", stage: "frequent_usage", window: "unknown" }]).type).toBe("fmcg");
    expect(suggestTrackerType([{ label: "Past 12 month household acquisition", stage: "acquisition", window: "past_12_months" }]).type).toBe("durables");
  });
  it("a type that is not Durables or FMCG is refused as a new choice; a stored unknown one is reported, never read as a type", () => {
    expect(choiceProblems({ trackerType: "services" }, r, names, null)).toEqual(['"services" is not a tracker type. Choose Durables or FMCG.']);
    expect(choiceProblems({ trackerType: "fmcg" }, r, names, null)).toEqual([]);
    expect(choiceProblems({ trackerType: "services" }, r, names, null, { trackerType: "services" })).toEqual([]);
    const d = resolveDashboard(r, names, null, normaliseChoices({ trackerType: "services" }));
    expect(d.trackerType).toMatchObject({ type: "fmcg", source: "suggested" });
    expect(d.needsChoice.find((n) => n.id === "tracker-type")?.text).toMatch(/\("services"\) is not one this app knows/);
    expect(normaliseChoices({ trackerType: 3 }).trackerType).toBe("3");
    expect(normaliseChoices({ trackerType: null }).trackerType).toBeUndefined();
  });
});

describe("wave comparison: only the same stage with the same window", () => {
  const fig = (window: StageFigures["window"], share: number): StageFigures[] => [
    { stage: "usage", group: "p3m", label: "Bought in the window", window, byBrand: [{ code: "1", variable: "bought_window_b1", share, base: 200 }] },
    { stage: "awareness", group: "aware", label: "Aware", window: "unknown", byBrand: [{ code: "1", variable: "aware_b1", share: share + 40, base: 240 }] },
  ];
  it("a changed window is withheld with the reason; the same window is compared", () => {
    const c = changesAgainst(fig("past_month", 30), fig("past_3_months", 45));
    expect(c.find((x) => x.stage === "usage")).toEqual({
      stage: "usage", code: "1", current: 30, previous: null, changePp: null,
      reason: "The time window changed (past 3 months in the previous wave, past month now), so it is not compared.",
    });
    expect(c.find((x) => x.stage === "awareness")?.changePp).toBeCloseTo(-15, 9);
    expect(changesAgainst(fig("past_3_months", 30), fig("past_3_months", 45)).find((x) => x.stage === "usage")?.changePp).toBeCloseTo(-15, 9);
  });
  it("a known window against an unknown one is withheld; two unstated windows are the same question", () => {
    expect(windowChangeReason("past_3_months", "unknown")).toMatch(/window not stated in the previous wave, past 3 months now/);
    expect(windowChangeReason("unknown", "unknown")).toBeNull();
  });
});

describe("the compact wording beside a stage", () => {
  it("a known window always; an unknown one only for a behaviour stage", () => {
    expect(windowSuffix("usage", "past_3_months")).toBe(", past 3 months");
    expect(windowSuffix("usage", "unknown")).toBe(", window not stated");
    expect(windowSuffix("awareness", "unknown")).toBe("");
    expect(windowSuffix("trial", "ever")).toBe(", ever");
    expect(windowSuffix("usage", null)).toBe("");
  });
});
