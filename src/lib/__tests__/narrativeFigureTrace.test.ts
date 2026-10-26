// Numerical traceability (numberTrace.ts). Two layers, tested separately:
//   1. the shared validator: reference cases written by the implementer for each context rule
//      (value, rounding, sign, measure, group, unit, base, cited source) and each outcome. These are
//      NOT independent evidence: Codex's adversarial set (golden-thread hardening task C) is meant to
//      be added alongside them.
//   2. the ACTUAL generateStoryNarrative: an unsupported figure is never saved (the retry is told
//      which; three bad drafts save nothing and say why); a figure that only needs review is saved
//      WITH the stored check, never as traced; pillars are checked against the insights they cite.
//      Mocked boundaries: the database client (scripted reads, captured writes), the model and the
//      support loader (all current; support is not under test here).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkFigures, figureCheck, figureCheckNote } from "../numberTrace";

const statuses = (text: string, sources: string[], absent?: "unsupported" | "needs_review") =>
  checkFigures("f", text, sources, absent).figures.map((f) => `${f.text}:${f.status}`);

describe("numberTrace reference cases (implementer-written; Codex's independent set is numberCheckFixtures.test.ts)", () => {
  const nps = ["NPS is 25 (95% interval 14.4 to 35.6, base 200), somewhere from the mid-teens to the mid-thirties."];

  it("an invented plus-or-minus 15 is unsupported; the supplied estimate and interval trace", () => {
    expect(statuses("The score could be 15 points higher or lower.", nps)).toEqual(["15:unsupported"]);
    expect(statuses("NPS is 25, with a 95% interval of 14.4 to 35.6.", nps)).toEqual([]);
  });

  it("context not established reads needs review, never traced: a paraphrased subject, or no subject at all", () => {
    expect(statuses("Leaders are net promoters at 25.", nps)).toEqual(["25:needs_review"]);
    expect(statuses("Likely between 14 and 36.", nps)).toEqual(["14:needs_review", "36:needs_review"]);
    expect(statuses("Men buy at 60%.", ["Purchase: men 60%, women 40%."])).toEqual(["60:needs_review"]); // "buy" is not "purchase"
  });

  it("a subject the cited evidence never mentions needs review (Codex: 25 stated for customers, cited for leaders)", () => {
    expect(statuses("Customer NPS is 25.", ["Leadership NPS is 25."])).toEqual(["25:needs_review"]);
  });

  it("sign: a reversed signed value is unsupported (Codex: Leadership NPS -25 from +25); the same sign traces", () => {
    expect(statuses("Leadership NPS is -25.", ["Leadership NPS is +25."])).toEqual(["-25:unsupported"]);
    expect(statuses("Leadership NPS is −25.", ["Leadership NPS is 25."])).toEqual(["−25:unsupported"]);
    expect(statuses("Leadership NPS is -25.", ["Leadership NPS is -25."])).toEqual([]);
  });

  it("direction in words: a fall where the evidence says a rise is unsupported", () => {
    expect(statuses("Sales fell 5%.", ["Sales rose 5% this year."])).toEqual(["5:unsupported"]);
    expect(statuses("Sales rose 5%.", ["Sales rose 5% this year."])).toEqual([]);
  });

  it("group: a correct number attached to the wrong group is unsupported; the right group and both groups trace", () => {
    const src = ["Purchase: men 60%, women 40%."];
    expect(statuses("Women purchase at 60%.", src)).toEqual(["60:unsupported"]);
    expect(statuses("Men purchase at 60%.", src)).toEqual([]);
    expect(statuses("Men purchase at 60% and women at 40%.", src)).toEqual([]);
  });

  it("derivations: a percentage-point difference of two cited shares traces (proposed policy); a relative difference needs review", () => {
    expect(statuses("Women purchase 20 percentage points more than men.", ["Purchase: women 60%, men 40%."])).toEqual([]);
    expect(statuses("Women purchase 50% more than men.", ["Purchase: women 60%, men 40%."])).toEqual(["50:needs_review"]);
    expect(statuses("Women purchase 20% more than men.", ["Purchase: women 60%, men 40%."])).toEqual(["20:unsupported"]);
  });

  it("unit and measure: an average stated as a share, or points for a percentage, are unsupported", () => {
    expect(statuses("4.2% of customers are satisfied.", ["Satisfaction mean 4.2 among customers."])).toEqual(["4.2:unsupported"]);
    expect(statuses("Trust rose 12 points.", ["Trust rose 12% this year."])).toEqual(["12:unsupported"]);
  });

  it("base: a matching base traces; a different base is unsupported; a plain count needs review", () => {
    expect(statuses("Trust is 72% (base 300).", ["Trust is 72% (base 300)."])).toEqual([]);
    expect(statuses("Trust is 72%, based on 500 customers.", ["Trust is 72% (base 300)."])).toEqual(["500:unsupported"]);
    expect(statuses("Trust is 72% among 300 customers.", ["Trust is 72% (base 300)."])).toEqual(["300:needs_review"]);
  });

  it("rounding traces at the output's precision only; extra decimals are not rounding", () => {
    expect(statuses("About 43% agree.", ["42.6% agree"])).toEqual([]);
    expect(statuses("Exactly 42.63% agree.", ["42.6% agree"])).toEqual(["42.63:unsupported"]);
  });

  it("cited source: a figure from evidence the text does not cite is not traced", () => {
    expect(statuses("Trust is 72% among customers.", ["Loyalty is 40% among customers."])).toEqual(["72:unsupported"]);
  });

  it("recommendations: an absent figure may be a proposed target, so it needs review; a wrong-group figure is still unsupported", () => {
    expect(statuses("Lift trust to 80% among customers.", ["Trust is 72% among customers."], "needs_review")).toEqual(["80:needs_review"]);
    expect(statuses("Women purchase at 60%; target 70%.", ["Purchase: men 60%, women 40%."], "needs_review")).toContain("60:unsupported");
  });

  it("causal and whole-population claims alongside a figure are unsupported, even when the figure itself traces", () => {
    const check = figureCheck([{ field: "a", text: "Men purchase at 60% because of the advertising.", sources: ["Purchase: men 60%, women 40%."] }]);
    expect(check.status).toBe("unsupported");
    expect(check.figures.map((f) => f.text)).toEqual(["because of"]);
  });

  it("currency and thousands are read; figures glued to letters are not statistics", () => {
    expect(statuses("Budget R1,200 per store in Q1.", ["Budget of R1,200 per store."])).toEqual([]);
  });

  it("the stored record and its note: worst status wins; traced has no note", () => {
    const check = figureCheck([
      { field: "a", text: "Men purchase at 60%.", sources: ["Purchase: men 60%, women 40%."] },
      { field: "b", text: "Leaders are net promoters at 25.", sources: nps },
    ]);
    expect(check).toMatchObject({ status: "needs_review", checked: 2 });
    expect(figureCheckNote(check)).toMatch(/^Figures need review: 25 \(/);
    expect(figureCheckNote(figureCheck([{ field: "a", text: "Men purchase at 60%.", sources: ["Purchase: men 60%, women 40%."] }]))).toBeNull();
  });
});

const state = vi.hoisted(() => ({
  drafts: [] as Record<string, unknown>[],
  requests: [] as { system: string; user: string }[],
  writes: [] as { sql: string; params: unknown[] }[],
  checkColumns: true,
}));

vi.mock("../db", () => {
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      const s = sql.replace(/\s+/g, " ");
      if (/information_schema\.columns/.test(s) && /figure_check/.test(JSON.stringify(params) + s)) {
        return { rows: [{ n: state.checkColumns ? 4 : 0 }] };
      }
      if (/^\s*(insert|update|delete)\b/i.test(s)) {
        state.writes.push({ sql: s, params });
        return { rows: [] };
      }
      if (/from runs where id/.test(s)) {
        return {
          rows: [
            {
              project_name: "Leadership",
              business_problem: null,
              research_objective: "Understand advocacy",
              decision_statement: "Whether to invest in advocacy",
              evidence_synthesis: "Earlier summary mentioned a 15-point swing.", // background: never a source
              audience: "Board",
            },
          ],
        };
      }
      if (/from synthesized_insights si where si\.run_id/.test(s)) {
        return {
          rows: [
            {
              id: "si-nps",
              headline: "Leadership NPS is 25",
              observation: "NPS is 25 (95% interval 14.4 to 35.6, base 200), somewhere from the mid-teens to the mid-thirties.",
              tension: "Advocacy is positive but not strong.",
              implication: "Treat advocacy as a modest asset.",
              confidence_tier: "moderate",
              quality_tier: null,
              quality_score: null,
            },
            {
              id: "si-trust",
              headline: "Trust is 72% among customers",
              observation: "Trust is 72% among customers (base 300).",
              tension: "t",
              implication: "i",
              confidence_tier: "moderate",
              quality_tier: null,
              quality_score: null,
            },
          ],
        };
      }
      return { rows: [] };
    },
  };
  const run = async (_t: string, cb: (c: typeof client) => unknown) => cb(client);
  return { withTenant: run, withTenantRead: run, withTenantRepeatableRead: run };
});
vi.mock("../supportStatus", () => ({
  loadInsightSupportOrUnchecked: async () => ({ statusOf: () => ({ status: "current", reasons: [] }) }),
}));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn() }));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));
vi.mock("../anthropic", () => ({
  CLAUDE_MODEL: "test-model",
  anthropic: {
    messages: {
      create: vi.fn(async (req: { system: string; messages: { content: string }[] }) => {
        state.requests.push({ system: req.system, user: req.messages[0].content });
        // Each call takes the next scripted draft; the last one repeats once the script runs out.
        const input = state.drafts.length > 1 ? state.drafts.shift() : state.drafts[0];
        return { stop_reason: "tool_use", usage: {}, content: [{ type: "tool_use", name: "record_narrative", input }] };
      }),
    },
  },
}));

const draft = (pillarSoWhat: string, indices = [0]) => ({
  executive_summary: "Leadership NPS is 25.",
  situation: "Leaders were surveyed.",
  complication: "Advocacy is modest.",
  question: "Whether to invest in advocacy",
  governing_thought: "Advocacy is a modest asset worth building on.",
  pillars: [{ theme: "Advocacy", headline: "Leadership NPS is 25.", so_what: pillarSoWhat, insight_indices: indices }],
  recommendations_intro: "The actions follow.",
  caveats: ["Only two insights are available."],
});

beforeEach(() => {
  state.drafts = [];
  state.requests = [];
  state.writes = [];
  state.checkColumns = true;
});

const storedCheck = () => {
  const w = state.writes.find((x) => /update deck_narratives set figure_check/.test(x.sql));
  return w ? JSON.parse(String(w.params[1])) : undefined;
};

describe("generateStoryNarrative enforces traceable figures", () => {
  it("a matching group in an aside cannot verify a different sentence subject", async () => {
    state.drafts = [draft("Customers, rather than the surveyed leaders, have an NPS of 25.", [0])];
    const { generateStoryNarrative } = await import("../storyNarrative");
    await generateStoryNarrative("tenant-1", "run-1");
    expect(storedCheck()).toMatchObject({ status: "needs_review" });
    expect(storedCheck().figures).toEqual(expect.arrayContaining([expect.objectContaining({ field: "pillar 1 so what", status: "needs_review" })]));
    state.writes = [];
    state.drafts = [draft("Leadership NPS is 25.", [0])];
    await generateStoryNarrative("tenant-1", "run-1");
    expect(storedCheck()).toMatchObject({ status: "traced" });
  });
  it("rejects a draft with an invented range, tells the retry which figure, saves the clean retry with its check", async () => {
    state.drafts = [draft("The score could be 15 points higher or lower."), draft("The 95% interval is 14.4 to 35.6.")];
    const { generateStoryNarrative } = await import("../storyNarrative");
    const { NO_DERIVED_FIGURES_RULE } = await import("../groundingRules");
    const narrative = await generateStoryNarrative("tenant-1", "run-1");
    expect(state.requests).toHaveLength(2);
    expect(state.requests[0].system).toContain(NO_DERIVED_FIGURES_RULE);
    expect(state.requests[1].user).toMatch(/does not support: 15 \(15 points is neither a cited value nor the difference of two cited shares\)/);
    expect(narrative.pillars[0].so_what).toBe("The 95% interval is 14.4 to 35.6.");
    expect(state.writes.filter((w) => /insert into deck_narratives/.test(w.sql))).toHaveLength(1);
    expect(storedCheck()).toMatchObject({ status: "traced", figures: [] });
  });

  it("three drafts with unsupported figures: nothing is saved and the error names field, figure and reason", async () => {
    state.drafts = [draft("Could be 15 points either way.")];
    const { generateStoryNarrative } = await import("../storyNarrative");
    await expect(generateStoryNarrative("tenant-1", "run-1")).rejects.toThrow(
      /does not support \(pillar 1 so what: 15 \(15 points is neither a cited value nor the difference of two cited shares\)\).*Nothing was saved; the previous narrative, if any, is unchanged/,
    );
    expect(state.requests).toHaveLength(3);
    expect(state.writes).toEqual([]);
  });

  it("a pillar is checked against the insights IT cites: a figure from another insight is unsupported there", async () => {
    // 72% belongs to the trust insight (index 1); the pillar cites only the NPS insight (index 0).
    state.drafts = [draft("Trust is 72% among customers.", [0])];
    const { generateStoryNarrative } = await import("../storyNarrative");
    await expect(generateStoryNarrative("tenant-1", "run-1")).rejects.toThrow(/pillar 1 so what: 72/);
  });

  it("a figure that only needs review is saved with the stored check, not as traced", async () => {
    state.drafts = [draft("Leaders are net promoters at 25.")];
    const { generateStoryNarrative } = await import("../storyNarrative");
    await generateStoryNarrative("tenant-1", "run-1");
    expect(state.requests).toHaveLength(1);
    expect(storedCheck()).toMatchObject({
      status: "needs_review",
      figures: [{ field: "pillar 1 so what", text: "25", status: "needs_review" }],
    });
  });

  it("the earlier evidence summary is not a source of figures", async () => {
    state.drafts = [draft("A 15-point swing is possible.")];
    const { generateStoryNarrative } = await import("../storyNarrative");
    await expect(generateStoryNarrative("tenant-1", "run-1")).rejects.toThrow(/pillar 1 so what: 15/);
  });

  it("before migration 0101 the narrative still saves, with no stored check (not checked, never traced)", async () => {
    state.checkColumns = false;
    state.drafts = [draft("Leaders are net promoters at 25.")];
    vi.resetModules(); // the availability check caches a positive answer per process
    const { generateStoryNarrative } = await import("../storyNarrative");
    await generateStoryNarrative("tenant-1", "run-1");
    expect(state.writes.filter((w) => /insert into deck_narratives/.test(w.sql))).toHaveLength(1);
    expect(storedCheck()).toBeUndefined();
  });
});
