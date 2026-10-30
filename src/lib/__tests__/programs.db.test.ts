// Renaming and deleting a program (Grant, 27 October 2026), against a real disposable PostgreSQL: delete
// unlinks its projects and keeps them; another tenant's program is never touched.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createDisposableDb, DISPOSABLE_DB_SKIP_REASON, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";

vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));

describe.skipIf(!TEST_DATABASE_URL)("programs: rename and delete (real database)", () => {
  let db: DisposableDb;
  const tenant = randomUUID();
  const other = randomUUID();
  const q = async (sql: string, p: unknown[] = []) => (await db.pool.query(sql, p)).rows;
  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    await q("insert into tenants(id,name) values($1,'A'),($2,'B')", [tenant, other]);
  }, 120000);
  afterAll(async () => { const { pool } = await import("../db"); await pool.end(); await db.drop(); }, 60000);

  it("renames, refuses an empty name, and deletes only the grouping, keeping its projects", async () => {
    const { renameProgramAction, deleteProgramAction } = await import("../programActions");
    const program = (await q("insert into programs(tenant_id,name) values($1,'CSM Tracker') returning id", [tenant]))[0].id;
    const run = (await q("insert into runs(tenant_id,project_name,program_id,wave_label) values($1,'Wave2&3',$2,'Wave 2') returning id", [tenant, program]))[0].id;
    await q("insert into documents(tenant_id,run_id,kind,ingestion_type,source_filename,storage_path) values($1,$2,'table','raw','w2.sav','x')", [tenant, run]);
    expect(await renameProgramAction(program, "  CSM Tracker 2026 ")).toEqual({ ok: true });
    expect((await q("select name from programs where id=$1", [program]))[0].name).toBe("CSM Tracker 2026");
    expect(await renameProgramAction(program, "   ")).toMatchObject({ ok: false, error: expect.stringMatching(/Give the program a name/) });
    expect(await deleteProgramAction(program)).toEqual({ ok: true, unlinked: 1 });
    expect(await q("select id from programs where id=$1", [program])).toEqual([]);
    expect(await q("select program_id, wave_label, project_name from runs where id=$1", [run])).toEqual([{ program_id: null, wave_label: null, project_name: "Wave2&3" }]);
    expect(await q("select count(*)::int as n from documents where run_id=$1", [run])).toEqual([{ n: 1 }]);
    // Gone already: said so, nothing changed.
    expect(await deleteProgramAction(program)).toMatchObject({ ok: false, error: expect.stringMatching(/no longer exists/) });
  });

  it("never renames or deletes another tenant's program", async () => {
    const { renameProgramAction, deleteProgramAction } = await import("../programActions");
    const theirs = (await q("insert into programs(tenant_id,name) values($1,'Theirs') returning id", [other]))[0].id;
    const theirRun = (await q("insert into runs(tenant_id,project_name,program_id) values($1,'X',$2) returning id", [other, theirs]))[0].id;
    expect(await renameProgramAction(theirs, "Mine")).toMatchObject({ ok: false });
    expect(await deleteProgramAction(theirs)).toMatchObject({ ok: false });
    expect(await q("select name from programs where id=$1", [theirs])).toEqual([{ name: "Theirs" }]);
    expect((await q("select program_id from runs where id=$1", [theirRun]))[0].program_id).toBe(theirs);
  });
});
describe.skipIf(!!TEST_DATABASE_URL)("programs: rename and delete (real database)", () => {
  it.skip(DISPOSABLE_DB_SKIP_REASON, () => {});
});
