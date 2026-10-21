// Codex GT100-F03 (golden-thread 100-case review, 2026-10-21) on a real PostgreSQL: a correction to
// a custom NET's member variable marks the insights built on that table changed, the same as a
// correction to an ordinary row variable does. Actual saveVariableOverride and loadInsightSupport;
// the tables, findings and insights are persisted in the shape the app saves them. Mocked: the
// data file's dictionary (saveVariableOverride checks the variable exists in it) and the survey
// design check (no design on either side), which both need the stored file; neither is under test.
// Skipped, with a printed reason, when TEST_DATABASE_URL is not set.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDisposableDb, DISPOSABLE_DB_SKIP_REASON, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";

vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));
vi.mock("../crosstabs", () => ({
  // Self-contained, as the other database tests mock this module: spreading the original here let
  // saveVariableOverride's lazy import reach the real dictionary loader and its file storage.
  loadVariableDictionary: async () => ({
    variables: ["A", "B", "Q", "UNRELATED"].map((name) => ({ name, label: name, type: "categorical", inSet: false })),
    sets: [],
  }),
  // No design on either side, so the design check is current and only corrections decide.
  resolveCurrentDesignSnapshotStatus: async () => ({ ok: true, snapshot: "null" }),
  designFreshnessStatus: (snapshot: { design: unknown } | null | undefined, current: { ok: boolean; snapshot?: string }) =>
    snapshot && current.ok && JSON.stringify(snapshot.design) === current.snapshot ? "current" : "unknown",
}));

describe.skipIf(!TEST_DATABASE_URL)("NET members are calculation inputs for support freshness (GT100-F03)", () => {
  let db: DisposableDb;
  let tenant = "";
  let run = "";
  let doc = "";
  const one = async (sql: string, p: unknown[]) => (await db.pool.query(sql, p)).rows[0].id as string;

  /** A saved calculated table, a finding from it, and an insight drafted on that finding. */
  async function insightOnTable(index: number, savedRequest: unknown): Promise<string> {
    const table = await one(
      `insert into document_tables (tenant_id, run_id, document_id, table_index, label, ingestion_type, crosstab, overrides_snapshot, design_snapshot)
       values ($1, $2, $3, $4, 'Saved table', 'raw', $5, '{}', '{"design": null}') returning id`,
      [tenant, run, doc, index, JSON.stringify({ savedRequest })],
    );
    const finding = await one(
      `insert into findings (tenant_id, run_id, origin, finding_text, status, stated_stats, source_table_id)
       values ($1, $2, 'generated', $3, 'accepted', '{"value": 50}', $4) returning id`,
      [tenant, run, `Finding from table ${index}`, table],
    );
    const pre = await one(
      `insert into insights (tenant_id, run_id, finding_id, headline, observation, tension, implication) values ($1, $2, $3, 'h', 'o', 't', 'i') returning id`,
      [tenant, run, finding],
    );
    const insight = await one(
      `insert into synthesized_insights (tenant_id, run_id, headline, observation, tension, implication, triangulation_count, source_theme_count)
       values ($1, $2, $3, 'o', 't', 'i', 1, 1) returning id`,
      [tenant, run, `Insight on table ${index}`],
    );
    await db.pool.query(
      `insert into synthesized_insight_sources (tenant_id, synthesized_insight_id, pre_insight_id, support_snapshot)
       values ($1, $2, $3, finding_support_parts($4))`,
      [tenant, insight, pre, finding],
    );
    return insight;
  }

  let netInsight = "";
  let ordinaryInsight = "";

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    tenant = await one(`insert into tenants (name) values ('T') returning id`, []);
    run = await one(`insert into runs (tenant_id) values ($1) returning id`, [tenant]);
    doc = await one(
      `insert into documents (tenant_id, run_id, kind, ingestion_type, source_filename, storage_path, variable_overrides)
       values ($1, $2, 'table', 'raw', 'survey.csv', 'synthetic-survey', '{}') returning id`,
      [tenant, run],
    );
    // As CrosstabWorkspace saves custom NETs: the row's own vars empty, the members under nets.
    netInsight = await insightOnTable(1, {
      columnVars: [],
      rowItems: [{ key: "nets-1", label: "Nets", vars: [], kind: "nets", nets: [{ label: "A or B", vars: ["A", "B"] }] }],
      weightVar: null,
    });
    ordinaryInsight = await insightOnTable(2, { columnVars: [], rowItems: [{ key: "Q", label: "Q", vars: ["Q"] }], weightVar: null });
  }, 120000);

  afterAll(async () => {
    const { pool } = await import("../db");
    await pool?.end?.();
    await db?.drop();
  });

  const support = async (insight: string) => {
    const { loadInsightSupport } = await import("../supportStatus");
    return (await loadInsightSupport(tenant, run, [insight])).statusOf(insight);
  };
  const correct = async (variable: string, type: "categorical" | "continuous" | null) => {
    const { saveVariableOverride } = await import("../variableOverrides");
    await saveVariableOverride(tenant, run, doc, variable, { type });
  };

  it("starts current", async () => {
    expect((await support(netInsight)).status).toBe("current");
    expect((await support(ordinaryInsight)).status).toBe("current");
  });

  it("a correction to an unrelated variable leaves both current (control)", async () => {
    await correct("UNRELATED", "continuous");
    expect((await support(netInsight)).status).toBe("current");
    expect((await support(ordinaryInsight)).status).toBe("current");
    await correct("UNRELATED", null);
  });

  it("a correction to a NET member marks the NET's insight changed, not the ordinary one", async () => {
    await correct("B", "continuous");
    const net = await support(netInsight);
    expect(net.status).toBe("stale");
    expect(JSON.stringify(net)).toMatch(/corrections_changed/);
    expect((await support(ordinaryInsight)).status).toBe("current");
  });

  it("clearing the correction restores current", async () => {
    await correct("B", null);
    expect((await support(netInsight)).status).toBe("current");
  });

  it("a correction to an ordinary row variable still marks its insight changed (control)", async () => {
    await correct("Q", "continuous");
    expect((await support(ordinaryInsight)).status).toBe("stale");
    expect((await support(netInsight)).status).toBe("current");
    await correct("Q", null);
    expect((await support(ordinaryInsight)).status).toBe("current");
  });
});
describe.skipIf(!!TEST_DATABASE_URL)("NET members are calculation inputs for support freshness (GT100-F03)", () => {
  it.skip(DISPOSABLE_DB_SKIP_REASON, () => {});
});
