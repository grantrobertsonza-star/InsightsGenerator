// IMP-001 / IMP-016: negative two-tenant matrix on a REAL PostgreSQL (disposable database from the
// migrations). What is established here, and what is not:
//   - catalog: every table carrying tenant_id has row-level security and a policy for every command
//     keyed on app.current_tenant_id (generic: enumerated from the catalog, not a fixed list)
//   - behaviour, as a NON-OWNER role without BYPASSRLS (how the app must connect for this to hold):
//     tenant B cannot see, change or delete tenant A's rows in the core tables, cannot insert rows
//     for tenant A, and with no tenant set every query fails closed
//   - the owner bypass, shown explicitly: the table owner sees every tenant's rows, because no table
//     has FORCE ROW LEVEL SECURITY. Whether the DEPLOYED app connects as the owner is NOT knowable
//     here; scripts/check-tenant-isolation.mjs checks that against the real database, and is run
//     below against this disposable one for both kinds of role.
// Skipped, with a printed reason, when TEST_DATABASE_URL is not set.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { Client } from "pg";
import { createDisposableDb, DISPOSABLE_DB_SKIP_REASON, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const ROLE = "ie_test_tenant_app";
const CORE = ["runs", "documents", "findings", "synthesized_insights", "recommendations", "trace"];

describe.skipIf(!TEST_DATABASE_URL)("tenant isolation matrix (real database)", () => {
  let db: DisposableDb;
  const appUrl = () => {
    const u = new URL(db.url);
    u.username = ROLE;
    u.password = "ie_test_only";
    return u.toString();
  };

  beforeAll(async () => {
    db = await createDisposableDb();
    const q = (sql: string, p: unknown[] = []) => db.pool.query(sql, p);
    await q(`insert into tenants (id, name) values ($1, 'A'), ($2, 'B')`, [A, B]);
    const run = (await q(`insert into runs (tenant_id, project_name) values ($1, 'A project') returning id`, [A])).rows[0].id;
    const doc = (await q(`insert into documents (tenant_id, run_id, kind, source_filename, storage_path) values ($1, $2, 'report', 'a.pdf', 'p') returning id`, [A, run])).rows[0].id;
    const f = (await q(`insert into findings (tenant_id, run_id, origin, finding_text, status, source_document_id) values ($1, $2, 'stated', 'A secret', 'accepted', $3) returning id`, [A, run, doc])).rows[0].id;
    const si = (await q(`insert into synthesized_insights (tenant_id, run_id, headline, observation, tension, implication) values ($1, $2, 'A insight', 'o', 't', 'i') returning id`, [A, run])).rows[0].id;
    await q(
      `insert into recommendations (tenant_id, run_id, synthesized_insight_id, action_text, owner_role, owner_feasibility_note, timeline, metric,
                                    priority, assumptions_and_risks, alternatives_considered, source, status)
       values ($1, $2, $3, 'A action', 'r', 'n', 't', 'm', 'high', 'a', 'b', 'researcher_authored', 'accepted')`,
      [A, run, si],
    );
    await q(`insert into trace (tenant_id, run_id, event) values ($1, $2, 'a_event')`, [A, run]);
    void f;
    await q(`do $$ begin
      if not exists (select 1 from pg_roles where rolname = '${ROLE}') then
        create role ${ROLE} login password 'ie_test_only' nobypassrls;
      end if; end $$`);
    await q(`grant usage on schema public to ${ROLE}`);
    await q(`grant select, insert, update, delete on all tables in schema public to ${ROLE}`);
    await q(`revoke all on table tenants from ${ROLE}`);
  }, 120000);

  afterAll(async () => {
    await db?.drop();
  });

  it("catalog: every tenant table has RLS and a policy for all commands keyed on app.current_tenant_id", async () => {
    const rows = (
      await db.pool.query(`
        select c.relname as name, c.relrowsecurity as rls,
               exists (select 1 from pg_policy p where p.polrelid = c.oid and p.polcmd = '*'
                       and pg_get_expr(p.polqual, p.polrelid) like '%app.current_tenant_id%') as policy
        from pg_class c join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
        where c.relkind = 'r' and exists (select 1 from information_schema.columns col
              where col.table_schema = 'public' and col.table_name = c.relname and col.column_name = 'tenant_id')`)
    ).rows as { name: string; rls: boolean; policy: boolean }[];
    expect(rows.length).toBeGreaterThan(40);
    expect(rows.filter((r) => !r.rls || !r.policy).map((r) => r.name)).toEqual([]);
  });

  it("as a non-owner role: tenant B cannot see, change, delete or create tenant A's rows; no tenant fails closed", async () => {
    const c = new Client({ connectionString: appUrl() });
    await c.connect();
    try {
      for (const t of CORE) {
        await c.query("begin");
        await c.query("select set_config('app.current_tenant_id', $1, true)", [B]);
        expect([t, Number((await c.query(`select count(*) from ${t}`)).rows[0].count)]).toEqual([t, 0]);
        expect([t, (await c.query(`update ${t} set tenant_id = tenant_id`)).rowCount]).toEqual([t, 0]);
        expect([t, (await c.query(`delete from ${t}`)).rowCount]).toEqual([t, 0]);
        await c.query("rollback");

        await c.query("begin");
        await c.query("select set_config('app.current_tenant_id', $1, true)", [A]);
        expect([t, Number((await c.query(`select count(*) from ${t}`)).rows[0].count)]).toEqual([t, 1]); // A sees its own
        await c.query("rollback");
      }
      // Writing a row FOR tenant A while acting as B is rejected by the policy.
      await c.query("begin");
      await c.query("select set_config('app.current_tenant_id', $1, true)", [B]);
      await expect(c.query(`insert into runs (tenant_id, project_name) values ($1, 'smuggled')`, [A])).rejects.toThrow(/row-level security/);
      await c.query("rollback");

      // No tenant set: fails closed (an error), never "all rows".
      await c.query("begin");
      await expect(c.query(`select count(*) from findings`)).rejects.toThrow();
      await c.query("rollback");
    } finally {
      await c.end();
    }
  });

  it("the table owner bypasses the policies (no FORCE ROW LEVEL SECURITY): the deployment role must not own the tables", async () => {
    const owner = await db.pool.connect();
    try {
      await owner.query("begin");
      await owner.query("select set_config('app.current_tenant_id', $1, true)", [B]);
      expect(Number((await owner.query(`select count(*) from findings`)).rows[0].count)).toBe(1); // A's row, visible
      await owner.query("rollback");
    } finally {
      owner.release();
    }
  });

  it("the live check script reports NOT ENFORCED for the owner and ENFORCED for the non-owner role", () => {
    const script = path.join(process.cwd(), "scripts", "check-tenant-isolation.mjs");
    const asOwner = spawnSync(process.execPath, [script], { env: { ...process.env, DATABASE_URL: db.url }, encoding: "utf8" });
    expect(asOwner.status).toBe(2);
    expect(asOwner.stdout).toMatch(/VERDICT: NOT ENFORCED/);
    const asApp = spawnSync(process.execPath, [script], { env: { ...process.env, DATABASE_URL: appUrl() }, encoding: "utf8" });
    expect(asApp.stdout).toMatch(/VERDICT: ENFORCED/);
    expect(asApp.status).toBe(0);
  });
});

describe.skipIf(!!TEST_DATABASE_URL)("tenant isolation matrix (real database)", () => {
  it.skip(DISPOSABLE_DB_SKIP_REASON, () => {});
});
