// INS-001: the actual synthesizeInsights counts INDEPENDENT evidence sources (distinct
// finding_evidence_key values), not cluster rows, and takes the tier from the single SQL
// definition insight_confidence_tier(). Mocked boundaries only: the database wrapper (a scripted
// client recording every statement and parameter) and the model client (scripted clustering and
// reframing). Clustering, de-duplication, the gate and persistence are the real code.
// The SQL functions themselves are tested against a real database in insightIndependence.db.test.ts.
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  independence: true as boolean,
  statements: [] as { sql: string; params: unknown[] }[],
  eligible: [] as Record<string, unknown>[],
}));

vi.mock("../db", () => {
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      state.statements.push({ sql, params });
      if (/from runs where id/.test(sql)) {
        return { rows: [{ entry_point: "generate", decision_statement: null, research_objective: "Grow share", business_problem: null }], rowCount: 1 };
      }
      if (/select count\(\*\)::text as count/.test(sql)) return { rows: [{ count: String(state.eligible.length) }] };
      if (/to_regprocedure\('finding_support_parts/.test(sql)) {
        return { rows: [{ available: true, independence: state.independence }] };
      }
      if (/select i\.id, i\.headline/.test(sql)) return { rows: state.eligible };
      if (/insert into trace/.test(sql)) return { rows: [] };
      // EC10K-F03: whether pre-insights record their drafted-from snapshot (0103); applied here.
      if (/table_name = 'insights' and column_name = 'support_snapshot'/.test(sql)) return { rows: [{ available: true }] };
      // EC10K-F04: the synthesis write's lock, the run check and the recheck that every member is still free.
      if (/pg_advisory_xact_lock/.test(sql)) return { rows: [{}] };
      if (/^select 1 from runs where id = \$1$/.test(sql)) return { rows: [{ "?column?": 1 }], rowCount: 1 };
      if (/not exists \(select 1 from synthesized_insight_sources s where s\.pre_insight_id = i\.id\)/.test(sql) && /i\.id = any\(\$1::uuid\[\]\)/.test(sql)) {
        const ids = params[0] as string[];
        return { rows: ids.map((id) => ({ id })), rowCount: ids.length };
      }
      if (/insert into synthesized_insights/.test(sql)) return { rows: [{ id: "si-new" }] };
      if (/insert into synthesized_insight_sources/.test(sql)) return { rows: [] };
      // Numerical traceability (0101) column check: this fake predates it, so it reads as not applied.
      if (/column_name = 'figure_check'/.test(sql)) return { rows: [{ n: 0 }] };
      // CE-2: the accepted objectives the synthesis prompt is given; none here, so the run's text stands.
      if (/from objective_candidates where run_id = \$1 and status = 'accepted'/.test(sql)) return { rows: [] };
      throw new Error(`unexpected query: ${sql}`);
    },
  };
  const run = async (_tenant: string, cb: (c: typeof client) => unknown) => cb(client);
  return { withTenant: run, withTenantRead: run };
});

vi.mock("../anthropic", () => ({
  CLAUDE_MODEL: "test-model",
  anthropic: {
    messages: {
      create: vi.fn(async (req: { tool_choice: { name: string } }) => {
        if (req.tool_choice.name === "record_clusters") {
          return {
            stop_reason: "tool_use",
            usage: {},
            content: [{ type: "tool_use", name: "record_clusters", input: { clusters: [{ label: "Trust", member_indices: [0, 1, 2] }] } }],
          };
        }
        return {
          stop_reason: "tool_use",
          usage: {},
          content: [
            {
              type: "tool_use",
              name: "record_synthesized_insight",
              input: {
                headline: "Brand A leads on trust",
                observation: "Three findings say so.",
                tension: "Spend favours brand B.",
                implication: "Rebalance spend.",
                action_plan_status: "has_action",
                materiality_rationale: "Decision-relevant.",
                passes_validity_gate: true,
              },
            },
          ],
        };
      }),
    },
  },
}));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn() }));
vi.mock("../contradictionDetector", () => ({ refreshContradictions: vi.fn() }));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));

vi.setConfig({ testTimeout: 20000 });

function members(keys: (string | null)[], themes: string[]) {
  return keys.map((key, n) => ({
    id: `pi-${n}`,
    headline: `Pre-insight ${n}`,
    observation: "o",
    tension: "t",
    implication: "i",
    theme: themes[n],
    support_snapshot: { wording: `w${n}`, figures: `f${n}`, verdict: null, calculation: null },
    evidence_key: key,
  }));
}

const insightInsert = () => state.statements.find((s) => /insert into synthesized_insights/.test(s.sql))!;

beforeEach(() => {
  state.independence = true;
  state.statements = [];
});

describe("synthesizeInsights counts independent sources (INS-001)", () => {
  it("three pre-insights from ONE table across two themes: 1 independent source, tier from the SQL rule, links still 3", async () => {
    state.eligible = members(["table:T1", "table:T1", "table:T1"], ["Trust", "Price", "Trust"]);
    const { synthesizeInsights } = await import("../insightSynthesizer");
    await synthesizeInsights("tenant-1", "run-1");

    const insert = insightInsert();
    expect(insert.sql).toMatch(/independent_source_count, confidence_tier/);
    expect(insert.sql).toMatch(/insight_confidence_tier\(\$12::integer, \$10::integer\)/);
    expect(insert.params[8]).toBe(3); // triangulation_count = links written (FND-001's deletion signal)
    expect(insert.params[9]).toBe(2); // source_theme_count
    expect(insert.params[11]).toBe(1); // independent_source_count
    // The old row-count rule would have stored "strong" (3 rows, 2 themes); no tier literal is sent.
    expect(insert.params).not.toContain("strong");
    expect(insert.params).not.toContain("moderate");
    const links = state.statements.filter((s) => /insert into synthesized_insight_sources/.test(s.sql));
    expect(links).toHaveLength(3);
  });

  it("three genuinely independent sources still count as three", async () => {
    state.eligible = members(["table:T1", "doc:R2", "table:T2"], ["Trust", "Price", "Trust"]);
    const { synthesizeInsights } = await import("../insightSynthesizer");
    await synthesizeInsights("tenant-1", "run-1");
    expect(insightInsert().params[11]).toBe(3);
  });

  it("before migration 0097: no independence count and no tier (unknown), never the row count", async () => {
    state.independence = false;
    state.eligible = members([null, null, null], ["Trust", "Price", "Trust"]);
    const { synthesizeInsights } = await import("../insightSynthesizer");
    await synthesizeInsights("tenant-1", "run-1");
    const insert = insightInsert();
    expect(insert.sql).not.toMatch(/independent_source_count/);
    expect(insert.sql).toMatch(/materiality_rationale, confidence_tier\)\s+values \(\$1, \$2, \$3, \$4, \$5, \$6, \$7, \$8, \$9, \$10, \$11, null\)/);
    expect(insert.params).toHaveLength(11);
  });

  it("a key that could not be resolved leaves independence unknown rather than undercounting or guessing", async () => {
    state.eligible = members(["table:T1", null, "doc:R2"], ["Trust", "Price", "Trust"]);
    const { synthesizeInsights } = await import("../insightSynthesizer");
    await synthesizeInsights("tenant-1", "run-1");
    const insert = insightInsert();
    expect(insert.sql).not.toMatch(/independent_source_count/);
    expect(insert.params).toHaveLength(11);
  });
});
