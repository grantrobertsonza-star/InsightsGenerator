// The read-only migration history check (scripts/migration-history-check.mjs), run as Grant would
// run it against a real disposable database built from every migration whose Supabase record lists
// only the first 61 files (the state that made `supabase migration up` replay 0062). It must report
// the unrecorded files whose objects exist, flag one whose objects were removed, print a repair
// command only for the fully present ones, and write nothing (record and schema unchanged).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { createDisposableDb, DISPOSABLE_DB_SKIP_REASON, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";

describe.skipIf(!TEST_DATABASE_URL)("migration history check (real database)", () => {
  let db: DisposableDb;
  beforeAll(async () => {
    db = await createDisposableDb();
    await db.pool.query("create schema if not exists supabase_migrations");
    await db.pool.query("create table supabase_migrations.schema_migrations (version text primary key)");
    for (let v = 1; v <= 61; v++) await db.pool.query("insert into supabase_migrations.schema_migrations values ($1)", [String(v).padStart(4, "0")]);
    // As if 0108 had not been applied.
    await db.pool.query("drop index assistant_messages_request_role_idx");
    await db.pool.query("alter table assistant_messages drop column request_id");
  }, 120000);
  afterAll(async () => {
    await db.drop();
  });

  it("reports unrecorded files by what exists, suggests repair only for the complete ones, and changes nothing", async () => {
    const before = (await db.pool.query("select count(*)::int as n from supabase_migrations.schema_migrations")).rows[0].n;
    const out = execFileSync(process.execPath, [path.resolve("scripts/migration-history-check.mjs")], { encoding: "utf8", env: { ...process.env, DATABASE_URL: db.url } });
    expect(out).toContain("recorded by the Supabase CLI.");
    expect(out).toMatch(/0062_output_findings\.sql: not recorded; all \d+ objects it creates exist/);
    expect(out).toMatch(/0108_assistant_message_request_id\.sql: not recorded; none of its 2 objects exist \(not applied\?\)/);
    const repair = out.split("\n").find((l) => l.includes("supabase migration repair"))!;
    expect(repair).toContain(" 0062");
    expect(repair).not.toContain("0108");
    expect(repair).not.toContain(" 0061");
    expect((await db.pool.query("select count(*)::int as n from supabase_migrations.schema_migrations")).rows[0].n).toBe(before);
    expect((await db.pool.query("select count(*)::int as n from information_schema.columns where table_name='assistant_messages' and column_name='request_id'")).rows[0].n).toBe(0);
  }, 60000);
});

describe.skipIf(!!TEST_DATABASE_URL)("migration history check (real database)", () => {
  it.skip(DISPOSABLE_DB_SKIP_REASON, () => {});
});
