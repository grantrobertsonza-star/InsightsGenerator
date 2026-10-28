// FND-001 (F1): the actual synthesizeInsights records, per source link, the support fingerprint of
// each finding AS THE MODEL SAW IT when the cluster was drafted. Mocked boundaries only: the
// database wrapper (a scripted client that records every statement and its parameters), the
// model client (scripted record_clusters / record_synthesized_insight tool calls), usage logging
// and the contradiction refresh. Clustering, the gate, persistence and the de-duplication of
// cluster members are the real code.
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  available: true as boolean,
  statements: [] as { sql: string; params: unknown[] }[],
  eligible: [] as Record<string, unknown>[],
  /** Simulates a researcher editing a finding while the model drafts: finding_support_parts()
   * would now return this, but the stored snapshot must still be the drafted one. */
  currentAfterDraft: null as Record<string, unknown> | null,
}));

vi.mock("../db", () => {
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      state.statements.push({ sql, params });
      if (/from runs where id/.test(sql)) {
        return { rows: [{ entry_point: "generate", decision_statement: null, research_objective: "Grow share", business_problem: null }], rowCount: 1 };
      }
      if (/select count\(\*\)::text as count/.test(sql)) return { rows: [{ count: String(state.eligible.length) }] };
      if (/to_regprocedure\('finding_support_parts/.test(sql)) return { rows: [{ available: state.available }] };
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

const model = vi.hoisted(() => ({ calls: [] as { tool: string; content: string }[] }));
vi.mock("../anthropic", () => ({
  CLAUDE_MODEL: "test-model",
  anthropic: {
    messages: {
      create: vi.fn(async (req: { tool_choice: { name: string }; messages: { content: string }[] }) => {
        model.calls.push({ tool: req.tool_choice.name, content: req.messages[0].content });
        if (req.tool_choice.name === "record_clusters") {
          // The model lists member 0 twice and member 1 once: de-duplication must leave two links.
          return {
            stop_reason: "tool_use",
            usage: {},
            content: [{ type: "tool_use", name: "record_clusters", input: { clusters: [{ label: "Regional lift", member_indices: [0, 0, 1] }] } }],
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
                headline: "Region B is pulling ahead",
                observation: "Two findings agree region B leads.",
                tension: "Region A gets more budget.",
                implication: "Rebalance spend toward B.",
                action_plan_status: "has_action",
                materiality_rationale: "Large, decision-relevant gap.",
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

const drafted = (n: number) => ({ wording: `w${n}`, figures: `f${n}`, verdict: "robust", calculation: null });

beforeEach(() => {
  state.available = true;
  state.statements = [];
  state.currentAfterDraft = null;
  model.calls = [];
  state.eligible = [0, 1].map((n) => ({
    id: `pi-${n}`,
    headline: `Pre-insight ${n}`,
    observation: "o",
    tension: "t",
    implication: "i",
    theme: "Regions",
    support_snapshot: drafted(n),
  }));
});

describe("synthesizeInsights records the drafted-from support (F1)", () => {
  it("reads each pre-insight's own drafted-from snapshot with the eligible pre-insights and stores exactly those values on each link", async () => {
    const { synthesizeInsights } = await import("../insightSynthesizer");
    await synthesizeInsights("tenant-1", "run-1");

    // EC10K-F03 (batch 64): the pre-insight's snapshot, not the finding's fingerprint now (which
    // stamped a finding corrected after the pre-insight was drafted as current).
    const read = state.statements.find((s) => /select i\.id, i\.headline/.test(s.sql))!;
    expect(read.sql).toMatch(/i\.support_snapshot as support_snapshot/);
    expect(read.sql).not.toMatch(/finding_support_parts\(f\.id\) as support_snapshot/);

    const links = state.statements.filter((s) => /insert into synthesized_insight_sources/.test(s.sql));
    expect(links).toHaveLength(2); // the duplicated index was claimed once
    expect(links.map((l) => [l.params[2], JSON.parse(String(l.params[3]))])).toEqual([
      ["pi-0", drafted(0)],
      ["pi-1", drafted(1)],
    ]);
    // Stored from the drafting read, not recomputed at insert time: a change made while the model
    // was drafting therefore shows as "changed since drafted" on the very first check.
    expect(links.every((l) => !/finding_support_parts/.test(l.sql))).toBe(true);

    const insight = state.statements.find((s) => /insert into synthesized_insights/.test(s.sql))!;
    // triangulation_count equals the number of links actually written (the deletion signal).
    expect(insight.params[8]).toBe(2);

    // The fingerprint is never shown to the model.
    expect(model.calls.every((c) => !/"wording"|w0|f0/.test(c.content))).toBe(true);
  });

  it("without migration 0096 the insight is still written, with no snapshot (reads as not checked, never current)", async () => {
    state.available = false;
    state.eligible = state.eligible.map((e) => ({ ...e, support_snapshot: null }));
    const { synthesizeInsights } = await import("../insightSynthesizer");
    await synthesizeInsights("tenant-1", "run-1");

    const read = state.statements.find((s) => /select i\.id, i\.headline/.test(s.sql))!;
    expect(read.sql).not.toMatch(/finding_support_parts/);
    expect(read.sql).toMatch(/null::jsonb as support_snapshot/);
    const links = state.statements.filter((s) => /insert into synthesized_insight_sources/.test(s.sql));
    expect(links).toHaveLength(2);
    expect(links.every((l) => !/support_snapshot/.test(l.sql) && l.params.length === 3)).toBe(true);
  });
});
