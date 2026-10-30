// Waves of one tracking study count as one source (migration 0124, Grant 27 October 2026), against a real
// PostgreSQL: rows written as 0099 counted them (two wave files = two sources), then 0124 is applied as it
// would be on a deployed database.
//   - finding_evidence_key(): tables of labelled wave files share the project's study key; an unlabelled
//     data file, a report and a blank label keep their document keys;
//   - back-fill: an insight resting on two waves falls to one source and its tier is lowered, traced; one
//     resting on a wave and a report keeps two; human fields untouched; a rerun changes nothing.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createDisposableDb, DISPOSABLE_DB_SKIP_REASON, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";

const MIGRATION = "0124_wave_study_independence.sql";

describe.skipIf(!TEST_DATABASE_URL)("waves of one study are one source (0124, real database)", () => {
  let db: DisposableDb;
  const ids: Record<string, string> = {};
  const q = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.pool.query(sql, p)).rows as T[];
  const one = async (sql: string, p: unknown[]) => (await q<{ id: string }>(sql, p))[0].id;

  beforeAll(async () => {
    db = await createDisposableDb(MIGRATION);
    ids.tenant = await one(`insert into tenants (name) values ('A') returning id`, []);
    ids.run = await one(`insert into runs (tenant_id) values ($1) returning id`, [ids.tenant]);
    const doc = (kind: string, name: string, wave: string | null) =>
      one(
        `insert into documents (tenant_id, run_id, kind, source_filename, storage_path, ingestion_type, data_setup)
         values ($1, $2, $3, $4, $4, case when $3 = 'table' then 'raw' end, $5) returning id`,
        [ids.tenant, ids.run, kind, name, kind === "table" ? JSON.stringify({ layout: "rows_are_cases", unit: "respondents", method: "survey", accepted: true, wave }) : null],
      );
    ids.w1 = await doc("table", "wave1.sav", "Wave 1");
    ids.w2 = await doc("table", "wave2.sav", "Wave 2");
    ids.adhoc = await doc("table", "adhoc.sav", null);
    ids.blank = await doc("table", "blank.sav", "   ");
    ids.report = await doc("report", "report.pdf", null);
    const table = (docId: string) => one(`insert into document_tables (tenant_id, run_id, document_id, table_index, ingestion_type) values ($1, $2, $3, 0, 'raw') returning id`, [ids.tenant, ids.run, docId]);
    const finding = (tableId: string | null, docId: string) =>
      one(`insert into findings (tenant_id, run_id, origin, finding_text, status, source_table_id, source_document_id) values ($1, $2, $3, 'text', 'accepted', $4, $5) returning id`, [ids.tenant, ids.run, tableId ? "generated" : "stated", tableId, docId]);
    ids.fW1 = await finding(await table(ids.w1), ids.w1);
    ids.fW2 = await finding(await table(ids.w2), ids.w2);
    ids.fAdhoc = await finding(await table(ids.adhoc), ids.adhoc);
    ids.fBlank = await finding(await table(ids.blank), ids.blank);
    ids.fReport = await finding(null, ids.report);
    const pre = (f: string) => one(`insert into insights (tenant_id, run_id, finding_id, headline, observation, tension, implication) values ($1, $2, $3, 'h', 'o', 't', 'i') returning id`, [ids.tenant, ids.run, f]);
    const preIds: Record<string, string> = {};
    for (const k of ["fW1", "fW2", "fAdhoc", "fReport"]) preIds[k] = await pre(ids[k]);
    const insight = async (count: number, tier: string, sources: string[]) => {
      const si = await one(
        `insert into synthesized_insights (tenant_id, run_id, headline, observation, tension, implication, triangulation_count, source_theme_count, independent_source_count, confidence_tier, review_status)
         values ($1, $2, 'Researcher headline', 'o', 't', 'i', $3, 2, $4, $5, 'accepted') returning id`,
        [ids.tenant, ids.run, sources.length, count, tier],
      );
      for (const s of sources) await q(`insert into synthesized_insight_sources (tenant_id, synthesized_insight_id, pre_insight_id) values ($1, $2, $3)`, [ids.tenant, si, preIds[s]]);
      return si;
    };
    // As 0099 counted them: two wave files were two independent sources.
    ids.siTwoWaves = await insight(2, "moderate", ["fW1", "fW2"]);
    ids.siWaveAndReport = await insight(2, "moderate", ["fW1", "fReport"]);
    ids.siWaveAndAdhoc = await insight(2, "moderate", ["fW1", "fAdhoc"]);
    await db.apply([MIGRATION]);
  }, 120000);
  afterAll(async () => { await db?.drop(); });

  it("finding_evidence_key: labelled waves share the study key; other documents keep their own", async () => {
    const key = async (id: string) => (await q<{ k: string | null }>(`select finding_evidence_key($1) as k`, [id]))[0].k;
    expect(await key(ids.fW1)).toBe(`study:${ids.run}`);
    expect(await key(ids.fW2)).toBe(`study:${ids.run}`);
    expect(await key(ids.fAdhoc)).toBe(`doc:${ids.adhoc}`);
    expect(await key(ids.fBlank)).toBe(`doc:${ids.blank}`);
    expect(await key(ids.fReport)).toBe(`doc:${ids.report}`);
  });

  it("back-fill lowers an insight resting on two waves only, traces it, touches nothing else, and a rerun changes nothing", async () => {
    const row = async (id: string) => (await q(`select independent_source_count, confidence_tier, headline, review_status from synthesized_insights where id = $1`, [id]))[0];
    expect(await row(ids.siTwoWaves)).toMatchObject({ independent_source_count: 1, confidence_tier: "exploratory", headline: "Researcher headline", review_status: "accepted" });
    expect(await row(ids.siWaveAndReport)).toMatchObject({ independent_source_count: 2, confidence_tier: "moderate" });
    expect(await row(ids.siWaveAndAdhoc)).toMatchObject({ independent_source_count: 2, confidence_tier: "moderate" });
    const traces = async () => (await q<{ detail: { synthesized_insight_id: string; previous_tier: string; corrected_tier: string } }>(`select detail from trace where event = 'waves_one_study_confidence_corrected'`)).map((t) => [t.detail.synthesized_insight_id, t.detail.previous_tier, t.detail.corrected_tier]);
    expect(await traces()).toEqual([[ids.siTwoWaves, "moderate", "exploratory"]]);
    await db.pool.query(readFileSync(path.join(process.cwd(), "supabase", "migrations", MIGRATION), "utf8"));
    expect(await traces()).toHaveLength(1);
    expect(await row(ids.siTwoWaves)).toMatchObject({ independent_source_count: 1, confidence_tier: "exploratory" });
  });
});
describe.skipIf(!!TEST_DATABASE_URL)("waves of one study are one source (0124, real database)", () => {
  it.skip(DISPOSABLE_DB_SKIP_REASON, () => {});
});
