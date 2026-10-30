// INS-001 / FND-001: the ACTUAL synthesizeInsights publishing to a REAL PostgreSQL (disposable
// database built from every migration, driven through the app's own db.ts). Only the model client,
// usage logging, the contradiction refresh and the storage client are mocked.
//
// Why this exists: Codex's 2026-10-16 review found that fresh synthesis published nothing under
// 0097. The INSERT used parameter $10 both for a smallint column and as an integer function
// argument, and PostgreSQL refused it (42P08). The earlier tests captured the SQL through a fake
// client or exercised the SQL functions directly, so neither crossed this boundary.
//
// Establishes:
//   - publication: the insight row, every source link with its drafted support snapshot, the
//     independent-source count and the confidence tier, all written together
//   - 0099: three tables from one data file count as ONE independent source (exploratory), while
//     a second data file and a report are genuinely independent (strong)
//   - rollback: a failure while writing links leaves no insight and no link behind
//   - retry: after the failure is removed, a rerun publishes each insight exactly once, and a
//     further rerun adds nothing
// Skipped, with a printed reason, when TEST_DATABASE_URL is not set.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createDisposableDb, DISPOSABLE_DB_SKIP_REASON, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";

const TENANT = "00000000-0000-4000-8000-0000000000d1";
const model = vi.hoisted(() => ({ clusters: [] as { label: string; member_indices: number[] }[] }));

vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn() }));
vi.mock("../contradictionDetector", () => ({ refreshContradictions: vi.fn() }));
vi.mock("../anthropic", () => ({
  CLAUDE_MODEL: "test-model",
  anthropic: {
    messages: {
      create: vi.fn(async (req: { tool_choice: { name: string } }) => {
        if (req.tool_choice.name === "record_clusters") {
          return { stop_reason: "tool_use", usage: {}, content: [{ type: "tool_use", name: "record_clusters", input: { clusters: model.clusters } }] };
        }
        return {
          stop_reason: "tool_use",
          usage: {},
          content: [
            {
              type: "tool_use",
              name: "record_synthesized_insight",
              input: {
                headline: "Drafted insight",
                observation: "o",
                tension: "t",
                implication: "i",
                action_plan_status: "has_action",
                materiality_rationale: "m",
                passes_validity_gate: true,
              },
            },
          ],
        };
      }),
    },
  },
}));

vi.setConfig({ testTimeout: 30000 });

describe.skipIf(!TEST_DATABASE_URL)("synthesis publication (real database)", () => {
  let db: DisposableDb;
  const q = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.pool.query(sql, p)).rows as T[];
  const one = async (sql: string, p: unknown[]) => (await q<{ id: string }>(sql, p))[0].id;

  const newRun = () => one(`insert into runs (tenant_id) values ($1) returning id`, [TENANT]);
  const doc = (run: string, kind: string, name: string) =>
    one(
      `insert into documents (tenant_id, run_id, kind, source_filename, storage_path, ingestion_type)
       values ($1, $2, $3, $4, $4, case when $3 = 'table' then 'raw' end) returning id`,
      [TENANT, run, kind, name],
    );
  const table = (run: string, docId: string, index: number) =>
    one(
      `insert into document_tables (tenant_id, run_id, document_id, table_index, ingestion_type) values ($1, $2, $3, $4, 'raw') returning id`,
      [TENANT, run, docId, index],
    );
  /** One accepted finding with its pre-insight; `order` fixes the eligible order (theme, then time). */
  const preInsight = async (run: string, theme: string, tableId: string | null, docId: string | null, order: number) => {
    const f = await one(
      `insert into findings (tenant_id, run_id, origin, finding_text, status, theme, source_table_id, source_document_id)
       values ($1, $2, $3, $4, 'accepted', $5, $6, $7) returning id`,
      [TENANT, run, tableId ? "generated" : "stated", `Finding ${order}`, theme, tableId, docId],
    );
    return one(
      // The pre-insight records its drafted-from support, as insightGenerator.ts does (0103); the link
      // copies it (EC10K-F03, batch 64).
      `insert into insights (tenant_id, run_id, finding_id, headline, observation, tension, implication, created_at, support_snapshot)
       values ($1, $2, $3, $4, 'o', 't', 'i', now() + make_interval(secs => $5), finding_support_parts($3)) returning id`,
      [TENANT, run, f, `Pre-insight ${order}`, order],
    );
  };
  const published = (run: string) =>
    q<{ id: string; triangulation_count: number; source_theme_count: number; independent_source_count: number | null; confidence_tier: string | null }>(
      `select id, triangulation_count, source_theme_count, independent_source_count, confidence_tier
       from synthesized_insights where run_id = $1 order by created_at, id`,
      [run],
    );
  const links = (run: string) =>
    q<{ synthesized_insight_id: string; pre_insight_id: string; snapshot_matches: boolean; has_snapshot: boolean }>(
      `select s.synthesized_insight_id, s.pre_insight_id,
              s.support_snapshot is not null as has_snapshot,
              s.support_snapshot = pi.support_snapshot as snapshot_matches
       from synthesized_insight_sources s
       join synthesized_insights si on si.id = s.synthesized_insight_id
       join insights pi on pi.id = s.pre_insight_id
       where si.run_id = $1`,
      [run],
    );

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = TENANT;
    await q(`insert into tenants (id, name) values ($1, 'T')`, [TENANT]);
  }, 120000);
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool?.end?.();
    await db?.drop();
  });
  beforeEach(() => {
    model.clusters = [];
  });

  it("publishes the insight, its links and drafted snapshots; three tables from one data file are one independent source", async () => {
    const run = await newRun();
    const data = await doc(run, "table", "survey.xlsx");
    const [t1, t2, t3] = [await table(run, data, 0), await table(run, data, 1), await table(run, data, 2)];
    // Eligible order is theme, then creation time: Price (1), Trust (2, 3).
    await preInsight(run, "Price", t1, data, 1);
    await preInsight(run, "Trust", t2, data, 2);
    await preInsight(run, "Trust", t3, data, 3);
    model.clusters = [{ label: "One survey", member_indices: [0, 1, 2] }];

    const { synthesizeInsights } = await import("../insightSynthesizer");
    await synthesizeInsights(TENANT, run);

    const rows = await published(run);
    expect(rows).toHaveLength(1);
    // Three tables, two themes: the old table key gave 3 independent sources and "strong".
    expect(rows[0]).toMatchObject({ triangulation_count: 3, source_theme_count: 2, independent_source_count: 1, confidence_tier: "exploratory" });
    const written = await links(run);
    expect(written).toHaveLength(3);
    expect(written.every((l) => l.has_snapshot && l.snapshot_matches)).toBe(true);
  });

  it("genuinely independent sources (two data files and a report) still reach strong", async () => {
    const run = await newRun();
    const fileA = await doc(run, "table", "wave-a.xlsx");
    const fileB = await doc(run, "table", "wave-b.xlsx");
    const report = await doc(run, "report", "report.pdf");
    await preInsight(run, "Price", await table(run, fileA, 0), fileA, 1);
    await preInsight(run, "Trust", await table(run, fileB, 0), fileB, 2);
    await preInsight(run, "Trust", null, report, 3);
    model.clusters = [{ label: "Three sources", member_indices: [0, 1, 2] }];

    const { synthesizeInsights } = await import("../insightSynthesizer");
    await synthesizeInsights(TENANT, run);
    expect((await published(run))[0]).toMatchObject({ independent_source_count: 3, confidence_tier: "strong" });
  });

  it("a failure while writing links rolls everything back; a retry publishes each insight once and a rerun adds nothing", async () => {
    const run = await newRun();
    const data = await doc(run, "table", "survey.xlsx");
    const report = await doc(run, "report", "report.pdf");
    const ids = [
      await preInsight(run, "A", await table(run, data, 0), data, 1),
      await preInsight(run, "A", null, report, 2),
      await preInsight(run, "B", await table(run, data, 1), data, 3),
      await preInsight(run, "B", null, report, 4),
    ];
    model.clusters = [
      { label: "First", member_indices: [0, 1] },
      { label: "Second", member_indices: [2, 3] },
    ];
    // A real database failure on the LAST link of the SECOND insight, after the first insight and
    // its links were already written inside the same transaction.
    await q(`create or replace function fail_link() returns trigger language plpgsql as $$
             begin
               if new.pre_insight_id = '${ids[3]}' then raise exception 'injected link failure'; end if;
               return new;
             end $$`);
    await q(`create trigger fail_link before insert on synthesized_insight_sources for each row execute function fail_link()`);

    const { synthesizeInsights } = await import("../insightSynthesizer");
    await expect(synthesizeInsights(TENANT, run)).rejects.toThrow(/injected link failure/);
    expect(await published(run)).toEqual([]);
    expect(await links(run)).toEqual([]);

    await q(`drop trigger fail_link on synthesized_insight_sources`);
    await synthesizeInsights(TENANT, run);
    const rows = await published(run);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.independent_source_count === 2 && r.confidence_tier === "exploratory")).toBe(true);
    expect((await links(run)).map((l) => l.pre_insight_id).sort()).toEqual([...ids].sort());

    // Nothing is eligible any more (every pre-insight is linked), so a rerun publishes nothing new.
    await synthesizeInsights(TENANT, run);
    expect(await published(run)).toHaveLength(2);
    expect(await links(run)).toHaveLength(4);
  });
});

describe.skipIf(!!TEST_DATABASE_URL)("synthesis publication (real database)", () => {
  it.skip(DISPOSABLE_DB_SKIP_REASON, () => {});
});
