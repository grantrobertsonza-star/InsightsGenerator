// Codex CT500-F01 (2026-10-24): deleting a table with another project's id (same organisation)
// archived and deleted the table's findings, then deleted no table, and the action reported success.
// deleteCrosstab now locks the table by its own id and the project's before archiving anything.
// Real disposable PostgreSQL and the actual deleteCrosstabAction; no engine or model call is needed.
//   - wrong project: refused, the table and its finding untouched, nothing archived
//   - another organisation's table: refused, untouched
//   - a missing or already deleted table: refused
//   - healthy deletion: finding archived, table gone
//   - a delete that fails after the archive: rolled back, the finding still live, nothing archived
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";

vi.setConfig({ testTimeout: 30_000 });
vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: { storage: { from: vi.fn() } } }));
vi.mock("../anthropic", () => ({ CLAUDE_MODEL: "synthetic", anthropic: { messages: { create: vi.fn() } } }));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn() }));

describe.skipIf(!TEST_DATABASE_URL)("CT500-F01 a table is deleted only from its own project (real database)", () => {
  let db: DisposableDb;
  const tenant = randomUUID();
  const otherTenant = randomUUID();
  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    await db.pool.query("insert into tenants(id,name) values($1,'Synthetic tables'),($2,'Other organisation')", [tenant, otherTenant]);
  }, 120000);
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end();
    await db.drop();
  });

  /** A project with a data file, one saved crosstab and a finding posted from it. */
  async function projectWithTable(tenantId = tenant) {
    const run = (await db.pool.query("insert into runs(tenant_id,project_name) values($1,'P') returning id", [tenantId])).rows[0].id as string;
    const doc = (
      await db.pool.query("insert into documents(tenant_id,run_id,kind,ingestion_type,source_filename,storage_path) values($1,$2,'table','raw','s.csv','x/s.csv') returning id", [tenantId, run])
    ).rows[0].id as string;
    const table = (
      await db.pool.query(
        `insert into document_tables(tenant_id,run_id,document_id,table_index,label,headers,rows,ingestion_type,crosstab,crosstab_status)
         values($1,$2,$3,100,'Saved table','[]','[]','aggregated','{"version":2}','committed') returning id`,
        [tenantId, run, doc],
      )
    ).rows[0].id as string;
    const finding = (
      await db.pool.query("insert into findings(tenant_id,run_id,origin,finding_text,source_table_id) values($1,$2,'generated','From the saved table',$3) returning id", [tenantId, run, table])
    ).rows[0].id as string;
    return { run, table, finding };
  }
  const state = async (table: string, finding: string) => ({
    table: (await db.pool.query("select count(*)::int n from document_tables where id = $1", [table])).rows[0].n as number,
    finding: (await db.pool.query("select count(*)::int n from findings where id = $1", [finding])).rows[0].n as number,
    archived: (await db.pool.query("select count(*)::int n from finding_history where original_finding_id = $1", [finding])).rows[0].n as number,
  });

  it("another project's id: refused, the table and its finding untouched, nothing archived", async () => {
    const { deleteCrosstabAction } = await import("../crosstabActions");
    const a = await projectWithTable();
    const b = await projectWithTable();
    const r = await deleteCrosstabAction(b.run, a.table);
    expect(r).toMatchObject({ ok: false });
    expect((r as { error: string }).error).toMatch(/not in this project/);
    expect(await state(a.table, a.finding)).toEqual({ table: 1, finding: 1, archived: 0 });
  });

  it("another organisation's table, and a table already deleted: refused", async () => {
    const { deleteCrosstabAction } = await import("../crosstabActions");
    const foreign = await projectWithTable(otherTenant);
    expect(await deleteCrosstabAction(foreign.run, foreign.table)).toMatchObject({ ok: false });
    expect(await state(foreign.table, foreign.finding)).toEqual({ table: 1, finding: 1, archived: 0 });
    const own = await projectWithTable();
    expect(await deleteCrosstabAction(own.run, own.table)).toEqual({ ok: true });
    expect(await deleteCrosstabAction(own.run, own.table)).toMatchObject({ ok: false, error: expect.stringMatching(/not in this project/) });
    expect(await deleteCrosstabAction(own.run, randomUUID())).toMatchObject({ ok: false });
  });

  it("healthy deletion: the finding is archived and the table gone", async () => {
    const { deleteCrosstabAction } = await import("../crosstabActions");
    const own = await projectWithTable();
    expect(await deleteCrosstabAction(own.run, own.table)).toEqual({ ok: true });
    expect(await state(own.table, own.finding)).toEqual({ table: 0, finding: 0, archived: 1 });
  });

  it("a delete that fails after the archive rolls everything back", async () => {
    const { deleteCrosstabAction } = await import("../crosstabActions");
    const own = await projectWithTable();
    const fn = `refuse_table_delete_${randomUUID().replaceAll("-", "")}`;
    await db.pool.query(
      `create function ${fn}() returns trigger language plpgsql as $$ begin raise exception 'Synthetic table delete outage'; end $$;
       create trigger ${fn} before delete on document_tables for each row when (old.id = '${own.table}'::uuid) execute function ${fn}()`,
    );
    try {
      expect(await deleteCrosstabAction(own.run, own.table)).toMatchObject({ ok: false });
      expect(await state(own.table, own.finding)).toEqual({ table: 1, finding: 1, archived: 0 });
    } finally {
      await db.pool.query(`drop trigger if exists ${fn} on document_tables; drop function if exists ${fn}()`);
    }
    // Recovery: with the outage gone the same delete succeeds once.
    expect(await deleteCrosstabAction(own.run, own.table)).toEqual({ ok: true });
    expect(await state(own.table, own.finding)).toEqual({ table: 0, finding: 0, archived: 1 });
  });
});
