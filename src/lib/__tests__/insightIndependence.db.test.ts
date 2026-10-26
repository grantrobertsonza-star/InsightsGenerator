// INS-001 against a REAL PostgreSQL (disposable database built from supabase/migrations; see
// helpers/disposableDb.ts). Establishes what the mocked unit test cannot:
//   - finding_evidence_key(): table, document, grounded-claim and fallback identities
//   - insight_confidence_tier(): hand-computed reference cases, plus an invariant checked over a
//     grid: the tier is never above the old row-count rule (so applying the migration can only
//     lower a tier)
//   - the 0097 back-fill on rows written by the OLD code: corrected counts, lower-only tier
//     changes, one trace row per change, an insight with no links left untouched, and a rerun
//     that changes nothing
//   - the functions honour row-level security when called as a non-owner role
// Skipped, with a printed reason, when TEST_DATABASE_URL is not set.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createDisposableDb,
  DISPOSABLE_DB_SKIP_REASON,
  TEST_DATABASE_URL,
  type DisposableDb,
} from "./helpers/disposableDb";

const MIGRATION = "0097_insight_independent_sources.sql";

describe.skipIf(!TEST_DATABASE_URL)("INS-001 on a real database", () => {
  let db: DisposableDb;
  const ids: Record<string, string> = {};
  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
    (await db.pool.query(sql, params)).rows as T[];

  beforeAll(async () => {
    db = await createDisposableDb(MIGRATION); // schema as it was before INS-001

    const one = async (sql: string, params: unknown[]) => (await q<{ id: string }>(sql, params))[0].id;
    ids.tenant = await one(`insert into tenants (name) values ('A') returning id`, []);
    ids.tenantB = await one(`insert into tenants (name) values ('B') returning id`, []);
    ids.run = await one(`insert into runs (tenant_id) values ($1) returning id`, [ids.tenant]);
    const doc = (kind: string, name: string) =>
      one(
        `insert into documents (tenant_id, run_id, kind, source_filename, storage_path, ingestion_type)
         values ($1, $2, $3, $4, $4, case when $3 = 'table' then 'raw' end) returning id`,
        [ids.tenant, ids.run, kind, name],
      );
    ids.report1 = await doc("report", "r1.pdf");
    ids.report2 = await doc("report", "r2.pdf");
    ids.data = await doc("table", "survey.xlsx");
    const table = (index: number) =>
      one(
        `insert into document_tables (tenant_id, run_id, document_id, table_index, ingestion_type)
         values ($1, $2, $3, $4, 'raw') returning id`,
        [ids.tenant, ids.run, ids.data, index],
      );
    ids.t1 = await table(0);
    ids.t2 = await table(1);

    const finding = (origin: string, theme: string, tableId: string | null, docId: string | null, grounded: string | null = null) =>
      one(
        `insert into findings (tenant_id, run_id, origin, finding_text, status, theme, source_table_id, source_document_id, grounded_by_finding_id)
         values ($1, $2, $3, 'text', 'accepted', $4, $5, $6, $7) returning id`,
        [ids.tenant, ids.run, origin, theme, tableId, docId, grounded],
      );
    ids.fT1a = await finding("generated", "Trust", ids.t1, ids.data);
    ids.fT1b = await finding("generated", "Price", ids.t1, ids.data);
    ids.fT1c = await finding("generated", "Trust", ids.t1, ids.data);
    ids.fT2 = await finding("generated", "Price", ids.t2, ids.data);
    ids.fR1 = await finding("stated", "Trust", null, ids.report1);
    ids.fR1b = await finding("stated", "Trust", null, ids.report1);
    ids.fR1grounded = await finding("stated", "Trust", null, ids.report1, ids.fT1a);
    ids.fR2 = await finding("stated", "Trust", null, ids.report2);
    ids.fBare = await finding("generated", "Trust", null, null);

    // insights.finding_id is unique (one pre-insight per finding), so duplicated evidence reaches a
    // cluster as DIFFERENT findings resting on the same source - which is what the key resolves.
    const preByFinding = new Map<string, string>();
    const pre = async (findingId: string) => {
      if (!preByFinding.has(findingId)) {
        preByFinding.set(
          findingId,
          await one(
            `insert into insights (tenant_id, run_id, finding_id, headline, observation, tension, implication)
             values ($1, $2, $3, 'h', 'o', 't', 'i') returning id`,
            [ids.tenant, ids.run, findingId],
          ),
        );
      }
      return preByFinding.get(findingId)!;
    };
    // Written exactly as the OLD synthesizer did: triangulation_count = rows, tier from rows.
    const legacy = async (tier: string | null, themes: number, findings: string[]) => {
      const si = await one(
        `insert into synthesized_insights (tenant_id, run_id, headline, observation, tension, implication,
                                           triangulation_count, source_theme_count, confidence_tier)
         values ($1, $2, 'h', 'o', 't', 'i', $3, $4, $5) returning id`,
        [ids.tenant, ids.run, findings.length, themes, tier],
      );
      for (const f of findings) {
        await q(`insert into synthesized_insight_sources (tenant_id, synthesized_insight_id, pre_insight_id) values ($1, $2, $3)`, [
          ids.tenant,
          si,
          await pre(f),
        ]);
      }
      return si;
    };
    // Three rows from one table, two themes: the old rule said "strong". Independent sources: 1.
    ids.siOneTable = await legacy("strong", 2, [ids.fT1a, ids.fT1b, ids.fT1c]);
    // A computed result, the report claim grounded by it, and another result from the same table:
    // old "moderate" (3 rows); one independent source.
    ids.siSameFinding = await legacy("moderate", 1, [ids.fT1a, ids.fR1grounded, ids.fT1c]);
    // Three independent sources (table 1, table 2, report 2) across two themes: stays strong.
    ids.siIndependent = await legacy("strong", 2, [ids.fT1a, ids.fT2, ids.fR2]);
    // Two claims from one report: old "exploratory", stays exploratory.
    ids.siOneReport = await legacy("exploratory", 1, [ids.fR1, ids.fR1b]);
    // No remaining links: left alone.
    ids.siNoLinks = await one(
      `insert into synthesized_insights (tenant_id, run_id, headline, observation, tension, implication,
                                         triangulation_count, source_theme_count, confidence_tier)
       values ($1, $2, 'h', 'o', 't', 'i', 2, 1, 'exploratory') returning id`,
      [ids.tenant, ids.run],
    );

    await db.apply([MIGRATION]);
  }, 120000);

  afterAll(async () => {
    await db?.drop();
  });

  it("finding_evidence_key: table, document, grounded claim and fallback identities", async () => {
    const key = async (id: string) => (await q<{ k: string | null }>(`select finding_evidence_key($1) as k`, [id]))[0].k;
    expect(await key(ids.fT1a)).toBe(`table:${ids.t1}`);
    expect(await key(ids.fT1b)).toBe(`table:${ids.t1}`); // same table, different finding: same source
    expect(await key(ids.fT2)).toBe(`table:${ids.t2}`);
    expect(await key(ids.fR1)).toBe(`doc:${ids.report1}`);
    expect(await key(ids.fR1grounded)).toBe(`table:${ids.t1}`); // a claim and the result grounding it are one source
    expect(await key(ids.fBare)).toBe(`finding:${ids.fBare}`);
    expect(await key("00000000-0000-4000-8000-00000000abcd")).toBeNull();
  });

  it("insight_confidence_tier: hand-computed reference cases", async () => {
    const cases: [number | null, number | null, string | null][] = [
      [null, 3, null],
      [0, 0, "exploratory"],
      [1, 5, "exploratory"], // any number of themes from ONE source
      [2, 1, "exploratory"],
      [2, 2, "moderate"],
      [3, 1, "moderate"],
      [3, 2, "strong"],
      [7, null, "moderate"],
    ];
    for (const [n, t, expected] of cases) {
      const [{ tier }] = await q<{ tier: string | null }>(`select insight_confidence_tier($1::int, $2::int) as tier`, [n, t]);
      expect([n, t, tier]).toEqual([n, t, expected]);
    }
  });

  it("invariant: for any number of extra rows repeating a source, the tier is never above the old row-count rule", async () => {
    // The tier depends only on independent sources and themes, so repeated rows cannot raise it
    // (the unit test shows repeated rows do not change the count). This checks the consequence
    // the back-fill relies on: the corrected tier is never higher than what the old rule stored.
    const violations = await q(
      `select n, extra, t
       from generate_series(0, 6) n, generate_series(0, 6) extra, generate_series(0, 4) t
       where array_position(array['exploratory','moderate','strong'], insight_confidence_tier(n, t))
           > array_position(array['exploratory','moderate','strong'],
               case when t >= 2 and (n + extra) >= 3 then 'strong'
                    when t >= 2 or (n + extra) >= 3 then 'moderate'
                    else 'exploratory' end)`,
    );
    expect(violations).toEqual([]);
  });

  it("back-fill: corrected counts, lower-only tier changes, each change traced, unlinked insight untouched", async () => {
    const rows = await q<{ id: string; independent_source_count: number | null; confidence_tier: string | null; triangulation_count: number }>(
      `select id, independent_source_count, confidence_tier, triangulation_count from synthesized_insights`,
    );
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(by[ids.siOneTable]).toMatchObject({ independent_source_count: 1, confidence_tier: "exploratory", triangulation_count: 3 });
    expect(by[ids.siSameFinding]).toMatchObject({ independent_source_count: 1, confidence_tier: "exploratory", triangulation_count: 3 });
    expect(by[ids.siIndependent]).toMatchObject({ independent_source_count: 3, confidence_tier: "strong" });
    expect(by[ids.siOneReport]).toMatchObject({ independent_source_count: 1, confidence_tier: "exploratory" });
    expect(by[ids.siNoLinks]).toMatchObject({ independent_source_count: null, confidence_tier: "exploratory" });

    const traces = await q<{ detail: Record<string, unknown> }>(
      `select detail from trace where event = 'ins001_confidence_corrected' order by detail->>'previous_tier'`,
    );
    expect(traces.map((t) => [t.detail.synthesized_insight_id, t.detail.previous_tier, t.detail.corrected_tier]).sort()).toEqual(
      [
        [ids.siOneTable, "strong", "exploratory"],
        [ids.siSameFinding, "moderate", "exploratory"],
      ].sort(),
    );
  });

  it("re-applying the migration changes nothing and writes no further trace", async () => {
    const before = await q(`select id, independent_source_count, confidence_tier from synthesized_insights order by id`);
    await db.apply([MIGRATION]);
    expect(await q(`select id, independent_source_count, confidence_tier from synthesized_insights order by id`)).toEqual(before);
    const [{ n }] = await q<{ n: number }>(`select count(*)::int as n from trace where event = 'ins001_confidence_corrected'`);
    expect(n).toBe(2);
  });

  it("the functions honour row-level security for a non-owner role", async () => {
    const client = await db.pool.connect();
    try {
      await client.query(
        `do $$ begin
           if not exists (select 1 from pg_roles where rolname = 'ie_test_app') then
             create role ie_test_app nologin;
           end if;
         end $$`,
      );
      await client.query(`grant select on findings to ie_test_app`);
      await client.query("begin");
      await client.query("set local role ie_test_app");
      await client.query("select set_config('app.current_tenant_id', $1, true)", [ids.tenantB]);
      const other = await client.query(`select finding_evidence_key($1) as k`, [ids.fT1a]);
      expect(other.rows[0].k).toBeNull(); // another tenant's finding is invisible
      await client.query("select set_config('app.current_tenant_id', $1, true)", [ids.tenant]);
      const own = await client.query(`select finding_evidence_key($1) as k`, [ids.fT1a]);
      expect(own.rows[0].k).toBe(`table:${ids.t1}`);
      await client.query("rollback");
    } finally {
      client.release();
    }
  });
});

describe.skipIf(!!TEST_DATABASE_URL)("INS-001 on a real database", () => {
  it.skip(DISPOSABLE_DB_SKIP_REASON, () => {});
});
