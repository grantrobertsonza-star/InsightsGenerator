// INS-001 correction (migration 0099) against a REAL PostgreSQL: one data file is one independent
// source, and existing confidence that was inflated by counting tables is corrected safely.
// Rows are written as the 0097-era code wrote them (independent_source_count from TABLE keys),
// then 0099 is applied, exactly as it would be on a deployed database.
//   - finding_evidence_key(): tables of one data file share a key; a claim and a table from the
//     same document share a key; different data files and reports stay distinct; grounding and
//     the fallback are unchanged
//   - back-fill: inflated counts and tiers are lowered, with one trace row per tier change;
//     genuinely independent insights, unlinked insights and human fields are untouched;
//     tiers are never raised; a rerun changes nothing
// Skipped, with a printed reason, when TEST_DATABASE_URL is not set.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDisposableDb, DISPOSABLE_DB_SKIP_REASON, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";

const MIGRATION = "0099_insight_dataset_independence.sql";

describe.skipIf(!TEST_DATABASE_URL)("INS-001 dataset independence (0099, real database)", () => {
  let db: DisposableDb;
  const ids: Record<string, string> = {};
  const q = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.pool.query(sql, p)).rows as T[];
  const one = async (sql: string, p: unknown[]) => (await q<{ id: string }>(sql, p))[0].id;

  beforeAll(async () => {
    db = await createDisposableDb(MIGRATION); // schema through 0098: the table-keyed rule
    ids.tenant = await one(`insert into tenants (name) values ('A') returning id`, []);
    ids.run = await one(`insert into runs (tenant_id) values ($1) returning id`, [ids.tenant]);
    const doc = (kind: string, name: string) =>
      one(
        `insert into documents (tenant_id, run_id, kind, source_filename, storage_path, ingestion_type)
         values ($1, $2, $3, $4, $4, case when $3 = 'table' then 'raw' end) returning id`,
        [ids.tenant, ids.run, kind, name],
      );
    ids.dataA = await doc("table", "survey-a.xlsx");
    ids.dataB = await doc("table", "survey-b.xlsx");
    ids.report = await doc("report", "report.pdf");
    const table = (docId: string, index: number) =>
      one(`insert into document_tables (tenant_id, run_id, document_id, table_index, ingestion_type) values ($1, $2, $3, $4, 'raw') returning id`, [
        ids.tenant,
        ids.run,
        docId,
        index,
      ]);
    ids.a0 = await table(ids.dataA, 0);
    ids.a1 = await table(ids.dataA, 1);
    ids.a2 = await table(ids.dataA, 2);
    ids.b0 = await table(ids.dataB, 0);
    ids.rt = await table(ids.report, 0); // a table read out of the report itself

    const finding = (tableId: string | null, docId: string | null, grounded: string | null = null) =>
      one(
        `insert into findings (tenant_id, run_id, origin, finding_text, status, source_table_id, source_document_id, grounded_by_finding_id)
         values ($1, $2, $3, 'text', 'accepted', $4, $5, $6) returning id`,
        [ids.tenant, ids.run, tableId ? "generated" : "stated", tableId, docId, grounded],
      );
    ids.fA0 = await finding(ids.a0, ids.dataA);
    ids.fA1 = await finding(ids.a1, ids.dataA);
    ids.fA2 = await finding(ids.a2, ids.dataA);
    ids.fB0 = await finding(ids.b0, ids.dataB);
    ids.fClaim = await finding(null, ids.report);
    ids.fReportTable = await finding(ids.rt, ids.report);
    ids.fGrounded = await finding(null, ids.report, ids.fA1);
    ids.fBare = await finding(null, null);

    const pre = (findingId: string) =>
      one(`insert into insights (tenant_id, run_id, finding_id, headline, observation, tension, implication) values ($1, $2, $3, 'h', 'o', 't', 'i') returning id`, [
        ids.tenant,
        ids.run,
        findingId,
      ]);
    const preIds: Record<string, string> = {};
    for (const key of ["fA0", "fA1", "fA2", "fB0", "fClaim", "fReportTable"]) preIds[key] = await pre(ids[key]);
    // Written as the 0097-era synthesizer wrote them: count of distinct TABLE keys, tier from it.
    const insight = async (count: number, themes: number, tier: string, sources: string[], status = "accepted") => {
      const si = await one(
        `insert into synthesized_insights (tenant_id, run_id, headline, observation, tension, implication,
                                           triangulation_count, source_theme_count, independent_source_count, confidence_tier, review_status)
         values ($1, $2, 'Researcher headline', 'o', 't', 'i', $3, $4, $5, $6, $7) returning id`,
        [ids.tenant, ids.run, sources.length, themes, count, tier, status],
      );
      for (const s of sources) {
        await q(`insert into synthesized_insight_sources (tenant_id, synthesized_insight_id, pre_insight_id) values ($1, $2, $3)`, [ids.tenant, si, preIds[s]]);
      }
      return si;
    };
    ids.siOneFile = await insight(3, 2, "strong", ["fA0", "fA1", "fA2"]); // one data file, three tables
    ids.siTwoFiles = await insight(3, 2, "strong", ["fA0", "fA1", "fB0"]); // two files: count 2, moderate
    ids.siIndependent = await insight(3, 2, "strong", ["fA0", "fB0", "fClaim"]); // three documents: unchanged
    ids.siReport = await insight(2, 2, "moderate", ["fClaim", "fReportTable"]); // one report: exploratory
    ids.siAlreadyLow = await insight(3, 1, "exploratory", ["fA0", "fA1", "fA2"]); // count falls, tier stays
    ids.siNoLinks = await insight(2, 1, "exploratory", []);

    await db.apply([MIGRATION]);
  }, 120000);

  afterAll(async () => {
    await db?.drop();
  });

  it("finding_evidence_key: one key per document; grounding and fallback unchanged", async () => {
    const key = async (id: string) => (await q<{ k: string | null }>(`select finding_evidence_key($1) as k`, [id]))[0].k;
    expect(await key(ids.fA0)).toBe(`doc:${ids.dataA}`);
    expect(await key(ids.fA1)).toBe(`doc:${ids.dataA}`);
    expect(await key(ids.fA2)).toBe(`doc:${ids.dataA}`);
    expect(await key(ids.fB0)).toBe(`doc:${ids.dataB}`);
    expect(await key(ids.fClaim)).toBe(`doc:${ids.report}`);
    expect(await key(ids.fReportTable)).toBe(`doc:${ids.report}`); // a table and a claim from one report
    expect(await key(ids.fGrounded)).toBe(`doc:${ids.dataA}`); // takes the grounding finding's key
    expect(await key(ids.fBare)).toBe(`finding:${ids.fBare}`);
    expect(await key("00000000-0000-4000-8000-00000000abcd")).toBeNull();
  });

  it("back-fill lowers inflated counts and tiers, traces each tier change, never raises, touches nothing else", async () => {
    const row = async (id: string) =>
      (await q<{ independent_source_count: number | null; confidence_tier: string | null; headline: string; review_status: string }>(
        `select independent_source_count, confidence_tier, headline, review_status from synthesized_insights where id = $1`,
        [id],
      ))[0];
    expect(await row(ids.siOneFile)).toMatchObject({ independent_source_count: 1, confidence_tier: "exploratory" });
    expect(await row(ids.siTwoFiles)).toMatchObject({ independent_source_count: 2, confidence_tier: "moderate" });
    expect(await row(ids.siIndependent)).toMatchObject({ independent_source_count: 3, confidence_tier: "strong" });
    expect(await row(ids.siReport)).toMatchObject({ independent_source_count: 1, confidence_tier: "exploratory" });
    expect(await row(ids.siAlreadyLow)).toMatchObject({ independent_source_count: 1, confidence_tier: "exploratory" });
    expect(await row(ids.siNoLinks)).toMatchObject({ independent_source_count: 2, confidence_tier: "exploratory" });
    for (const id of [ids.siOneFile, ids.siTwoFiles, ids.siIndependent, ids.siReport]) {
      expect(await row(id)).toMatchObject({ headline: "Researcher headline", review_status: "accepted" });
    }

    const traces = await q<{ detail: { synthesized_insight_id: string; previous_tier: string; corrected_tier: string } }>(
      `select detail from trace where event = 'ins001_dataset_confidence_corrected'`,
    );
    expect(
      traces.map((t) => [t.detail.synthesized_insight_id, t.detail.previous_tier, t.detail.corrected_tier]).sort(),
    ).toEqual(
      [
        [ids.siOneFile, "strong", "exploratory"],
        [ids.siTwoFiles, "strong", "moderate"],
        [ids.siReport, "moderate", "exploratory"],
      ].sort(),
    );
  });

  it("a rerun of the migration changes nothing", async () => {
    const snapshot = async () =>
      q(`select id, independent_source_count, confidence_tier from synthesized_insights order by id`);
    const before = await snapshot();
    const tracesBefore = (await q(`select count(*)::int n from trace`))[0];
    await db.apply([MIGRATION]);
    expect(await snapshot()).toEqual(before);
    expect((await q(`select count(*)::int n from trace`))[0]).toEqual(tracesBefore);
  });
});

describe.skipIf(!!TEST_DATABASE_URL)("INS-001 dataset independence (0099, real database)", () => {
  it.skip(DISPOSABLE_DB_SKIP_REASON, () => {});
});
