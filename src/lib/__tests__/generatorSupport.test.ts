// FND-001 (F10): the actual narrative and recommendation generators never put an insight whose
// support is no longer valid in front of the model, while changed ("stale") support is still used.
// Mocked boundaries only: the database (a scripted client answering by statement) and the model
// client, which records the request it was sent and then fails with a sentinel so nothing
// downstream (parsing, persistence) runs. The support loader and classifier are the real ones.
//
// Fixture, shared with storyExportSupport.test.ts through helpers/fakeStoryDb.ts:
//   si-cur   current support
//   si-stale a supporting finding's figures changed since drafting   -> must still reach the prompt
//   si-inv   a supporting finding was rejected since drafting         -> must not reach the prompt
//
// Not established here: what the model writes, or how a generated narrative is persisted.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { insight, supportRows } from "./helpers/fakeStoryDb";

const state = vi.hoisted(() => ({
  statements: [] as string[],
  requests: [] as string[],
  insightIds: ["si-cur", "si-stale", "si-inv"],
  evidenceSynthesis: null as string | null,
}));

const SENTINEL = "model call captured";

function answer(sql: string): { rows: unknown[] } {
  const s = sql.replace(/\s+/g, " ");
  if (/to_regprocedure\('finding_support_parts/.test(s)) return { rows: [{ available: true }] };
  if (/as link_id/.test(s)) return { rows: supportRows(true) };
  if (/from runs where id/.test(s)) {
    return {
      rows: [
        {
          project_name: "Golden thread",
          business_problem: null,
          research_objective: "Understand regional performance",
          decision_statement: "Where to invest next year",
          evidence_synthesis: state.evidenceSynthesis,
          audience: "Leadership",
        },
      ],
    };
  }
  const names: Record<string, string> = { "si-cur": "Current", "si-stale": "Stale", "si-inv": "Invalid" };
  if (/join synthesized_insight_sources s/.test(s)) {
    // recommendationAgent: accepted insights with an action plan and no recommendation yet.
    return {
      rows: state.insightIds.map((id) => ({ ...insight(id, names[id]), source_headlines: [`${names[id]} source finding`] })),
    };
  }
  if (/from synthesized_insights si where si\.run_id = \$1 and si\.review_status = 'accepted'/.test(s)) {
    return { rows: state.insightIds.map((id) => ({ ...insight(id, names[id]), quality_score: null })) };
  }
  if (/from recommendations r/.test(s)) {
    return {
      rows: ["si-cur", "si-inv"].map((id) => ({
        action_text: `Act on the ${names[id].toLowerCase()} insight`,
        owner_role: "Marketing lead",
        timeline: "Next quarter",
        metric: "Share of trust",
        priority: "high",
        synthesized_insight_headline: `${names[id]} insight headline`,
        synthesized_insight_id: id,
      })),
    };
  }
  return { rows: [] };
}

vi.mock("../db", () => {
  const client = {
    query: async (sql: string) => {
      state.statements.push(sql);
      return answer(sql);
    },
  };
  const run = async (_tenant: string, cb: (c: typeof client) => unknown) => cb(client);
  return { withTenant: run, withTenantRead: run, withTenantRepeatableRead: run };
});
vi.mock("../anthropic", () => ({
  CLAUDE_MODEL: "test-model",
  anthropic: {
    messages: {
      create: async (request: unknown) => {
        state.requests.push(JSON.stringify(request));
        throw new Error(SENTINEL);
      },
    },
  },
}));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn() }));
vi.mock("../recommendationQualityScorer", () => ({ refreshRecommendationQuality: vi.fn() }));
vi.mock("../objectiveQualityScorer", () => ({ refreshObjectiveQuality: vi.fn() }));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));

vi.setConfig({ testTimeout: 30000 });

beforeEach(() => {
  state.statements = [];
  state.requests = [];
  state.insightIds = ["si-cur", "si-stale", "si-inv"];
  state.evidenceSynthesis = null;
});

const writes = () => state.statements.filter((s) => /^\s*(insert|update|delete)\b/i.test(s));

describe("narrative generator applies the support status (F10)", () => {
  it("leaves the invalid insight and its recommendation out of the prompt, keeps the changed one", async () => {
    const { generateStoryNarrative } = await import("../storyNarrative");
    await expect(generateStoryNarrative("tenant-1", "run-1")).rejects.toThrow(SENTINEL);

    expect(state.requests).toHaveLength(1);
    const prompt = state.requests[0];
    expect(prompt).toContain("Current insight headline");
    expect(prompt).toContain("Stale insight headline");
    expect(prompt).not.toContain("Invalid insight headline");
    expect(prompt).not.toContain("Invalid insight observation");
    expect(prompt).toContain("Act on the current insight");
    expect(prompt).not.toContain("Act on the invalid insight");
    expect(writes()).toEqual([]);
  });

  it("refuses with an actionable message, and makes no model call, when every accepted insight is invalid", async () => {
    state.insightIds = ["si-inv"];
    const { generateStoryNarrative } = await import("../storyNarrative");
    await expect(generateStoryNarrative("tenant-1", "run-1")).rejects.toThrow(/rests on evidence that was rejected or deleted/);
    expect(state.requests).toEqual([]);
    expect(writes()).toEqual([]);
  });
});

describe("narrative grounding (golden-thread repair)", () => {
  it("carries the no-invented-explanations rule and marks the earlier evidence summary as background, not a source of figures", async () => {
    state.evidenceSynthesis = "Scores conflict (4.2 vs 3.5), suggesting inconsistent measurement.";
    const { generateStoryNarrative } = await import("../storyNarrative");
    const { NO_INVENTED_EXPLANATIONS_RULE } = await import("../groundingRules");
    await expect(generateStoryNarrative("tenant-1", "run-1")).rejects.toThrow(SENTINEL);
    const request = JSON.parse(state.requests[0]) as { system: string };
    expect(request.system).toContain(NO_INVENTED_EXPLANATIONS_RULE);
    expect(request.system).toMatch(/Earlier evidence summary \(background framing only; take every figure from the accepted insights and recommendations below, never from this summary\): Scores conflict/);
  });
});

describe("recommendation generator applies the support status (F10)", () => {
  it("drafts from current and changed insights only; the invalid insight never reaches the model", async () => {
    const { generateSynthesizedRecommendations } = await import("../recommendationAgent");
    await generateSynthesizedRecommendations("tenant-1", "run-1").catch((error: Error) => {
      // A model failure may surface or be handled inside the generator; either way the request
      // below is what this test checks.
      expect(error.message).toContain(SENTINEL);
    });

    expect(state.requests.length).toBeGreaterThan(0);
    const sent = state.requests.join("\n");
    expect(sent).toContain("Current insight headline");
    expect(sent).toContain("Stale insight headline");
    expect(sent).not.toContain("Invalid insight headline");
    expect(sent).not.toContain("Invalid source finding");
  });

  it("makes no model call when the only eligible insight is invalid", async () => {
    state.insightIds = ["si-inv"];
    const { generateSynthesizedRecommendations } = await import("../recommendationAgent");
    await generateSynthesizedRecommendations("tenant-1", "run-1");
    expect(state.requests).toEqual([]);
    expect(writes()).toEqual([]);
  });
});
