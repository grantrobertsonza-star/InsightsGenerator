// IMP-001 / IMP-016: the separate application role (scripts/db/setup-app-role.mjs) on a real
// disposable database, end to end:
//   - the actual setup script, run as a separate process like a researcher runs it: report-only
//     mode changes nothing; --apply creates a LOGIN, NOSUPERUSER, NOBYPASSRLS, non-owner role with
//     grants on every table; a second --apply is a harmless repair; the password is never printed
//   - the actual tenant check script, connected as that role: ENFORCED
//   - a table a LATER migration creates (as the owner) is usable by the role without rerunning
//     setup (default privileges), and its policy applies
//   - the app's own db.ts (withTenant / withTenantRead / withTenantRepeatableRead) connected as the
//     role: a tenant sees, updates and inserts only its own rows; inserting another tenant's row
//     is refused; reusing one pooled connection across tenants keeps them apart; a query with no
//     tenant set fails instead of returning everything
//   - the tenants registry (no row-level security): the role can neither read nor change any
//     tenant's row, ordinary inserts that reference it still work, and a role left with access by
//     an earlier version of the script is repaired by --apply
//   - a role that belongs to the table owner (two grants removed, inherited; or SET-only): the bypass
//     is real, setup refuses it (report and --apply) without changing anything, and names the REVOKE
//   - the backup's connection guard, judged on the connection itself: the restricted role is refused
//     whether it arrives as DATABASE_URL or DATABASE_ADMIN_URL; a BYPASSRLS role without SELECT is
//     refused; the owner is accepted from either variable
// Skipped, with a printed reason, when TEST_DATABASE_URL is not set.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "pg";
import { createDisposableDb, DISPOSABLE_DB_SKIP_REASON, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";
// G6: actions and routes take the tenant from the signed-in request; tests supply the seeded one.
vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());

// Boundaries of the server actions exercised below; the database work is real.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../verifyAfterGenerate", () => ({ verifyAfterGenerate: vi.fn(async () => {}) }));

const SETUP = path.join(process.cwd(), "scripts", "db", "setup-app-role.mjs");
const CHECK = path.join(process.cwd(), "scripts", "check-tenant-isolation.mjs");

function runScript(script: string, args: string[], env: Record<string, string>) {
  // From an empty folder with no .env files, so only the given environment counts.
  const dir = mkdtempSync(path.join(tmpdir(), "app-role-"));
  try {
    symlinkSync(path.join(process.cwd(), "node_modules"), path.join(dir, "node_modules"), process.platform === "win32" ? "junction" : "dir");
    const base = Object.fromEntries(
      Object.entries(process.env).filter(([k]) => !["DATABASE_URL", "DATABASE_ADMIN_URL", "APP_DB_ROLE", "APP_DB_PASSWORD", "NODE_ENV"].includes(k)),
    );
    const r = spawnSync(process.execPath, [script, ...args], { cwd: dir, env: { ...base, ...env } as NodeJS.ProcessEnv, encoding: "utf8", timeout: 60000 });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const asUser = (url: string, user: string, password: string) => {
  const u = new URL(url);
  u.username = user;
  u.password = password;
  return u.toString();
};

describe.skipIf(!TEST_DATABASE_URL)("separate application role (real database)", () => {
  let db: DisposableDb;
  const role = `ie_test_role_${randomBytes(4).toString("hex")}`;
  const password = randomBytes(12).toString("hex");
  let appUrl = "";
  const tenantA = randomUUID();
  const tenantB = randomUUID();

  beforeAll(async () => {
    db = await createDisposableDb();
    appUrl = asUser(db.url, role, password);
    await db.pool.query(`insert into tenants (id, name) values ($1, 'A'), ($2, 'B')`, [tenantA, tenantB]);
  }, 120000);

  afterAll(async () => {
    vi.resetModules();
    await db?.drop();
    const c = new Client({ connectionString: TEST_DATABASE_URL });
    await c.connect();
    // Default privileges reference the role; they are dropped with the database above.
    await c.query(`drop role if exists ${role}`).catch(() => {});
    await c.end();
  });

  it("report-only mode changes nothing; --apply creates a restricted, non-owner role; a rerun is a harmless repair", async () => {
    const report = runScript(SETUP, [], { DATABASE_ADMIN_URL: db.url, APP_DB_ROLE: role });
    expect(report.code).toBe(2);
    expect(report.out).toContain(`role "${role}" does not exist`);
    expect((await db.pool.query(`select 1 from pg_roles where rolname = $1`, [role])).rowCount).toBe(0);

    const noPassword = runScript(SETUP, ["--apply"], { DATABASE_ADMIN_URL: db.url, APP_DB_ROLE: role });
    expect(noPassword.code).toBe(1);
    expect(noPassword.out).toMatch(/APP_DB_PASSWORD must be set/);

    const applied = runScript(SETUP, ["--apply"], { DATABASE_ADMIN_URL: db.url, APP_DB_ROLE: role, APP_DB_PASSWORD: password });
    expect(applied.out, applied.out).toMatch(/is ready/);
    expect(applied.code).toBe(0);
    expect(applied.out).not.toContain(password);
    expect(applied.out).toMatch(/No access granted .* without row-level security: tenants\./);

    const r = (
      await db.pool.query(
        `select rolcanlogin, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole,
                (select count(*)::int from pg_tables where schemaname = 'public' and tableowner = $1) as owned
         from pg_roles where rolname = $1`,
        [role],
      )
    ).rows[0];
    expect(r).toEqual({ rolcanlogin: true, rolsuper: false, rolbypassrls: false, rolcreatedb: false, rolcreaterole: false, owned: 0 });

    const again = runScript(SETUP, ["--apply"], { DATABASE_ADMIN_URL: db.url, APP_DB_ROLE: role, APP_DB_PASSWORD: password });
    expect(again.code).toBe(0);
    expect(again.out).toMatch(/already exists with the restricted attributes and every grant/);
  });

  it("the tenant check, connected as the role, reports ENFORCED", () => {
    const r = runScript(CHECK, [], { DATABASE_URL: appUrl });
    expect(r.out).toMatch(/VERDICT: ENFORCED/);
    expect(r.code).toBe(0);
  });

  it("a table a later migration creates is usable by the role without rerunning setup, and its policy applies", async () => {
    await db.pool.query(`create table later_table (id uuid primary key default gen_random_uuid(), tenant_id uuid not null references tenants(id), note text)`);
    await db.pool.query(`alter table later_table enable row level security`);
    await db.pool.query(`create policy tenant_isolation on later_table using (tenant_id = current_setting('app.current_tenant_id')::uuid)`);
    await db.pool.query(`insert into later_table (tenant_id, note) values ($1, 'a'), ($2, 'b')`, [tenantA, tenantB]);
    const c = new Client({ connectionString: appUrl });
    await c.connect();
    try {
      await c.query("begin");
      await c.query("select set_config('app.current_tenant_id', $1, true)", [tenantA]);
      expect((await c.query(`select note from later_table`)).rows).toEqual([{ note: "a" }]);
      await c.query("rollback");
    } finally {
      await c.end();
    }
  });

  it("through the app's own db.ts as the role: each tenant reads, updates and inserts only its own rows", async () => {
    vi.resetModules();
    // db.ts keeps its pool on globalThis across module reloads (dev hot reload); drop it so this
    // import opens a new pool on the role's connection.
    (globalThis as { pgPool?: unknown }).pgPool = undefined;
    process.env.DATABASE_URL = appUrl;
    const { withTenant, withTenantRead, withTenantRepeatableRead, pool } = await import("../db");
    try {
      const runA = await withTenant(tenantA, async (c) =>
        (await c.query<{ id: string }>(`insert into runs (tenant_id, project_name) values ($1, 'A project') returning id`, [tenantA])).rows[0].id,
      );
      await withTenant(tenantB, async (c) => c.query(`insert into runs (tenant_id, project_name) values ($1, 'B project')`, [tenantB]));

      const seen = async (t: string) => (await withTenantRead(t, (c) => c.query<{ project_name: string }>(`select project_name from runs order by 1`))).rows.map((r) => r.project_name);
      // One pooled connection reused across tenants (session-level setting) stays correct.
      expect(await seen(tenantA)).toEqual(["A project"]);
      expect(await seen(tenantB)).toEqual(["B project"]);
      expect(await seen(tenantA)).toEqual(["A project"]);
      expect((await withTenantRepeatableRead(tenantB, (c) => c.query(`select 1 from runs where id = $1`, [runA]))).rowCount).toBe(0);

      // B cannot change or delete A's run: the statement matches nothing.
      expect((await withTenant(tenantB, (c) => c.query(`update runs set project_name = 'hijacked' where id = $1`, [runA]))).rowCount).toBe(0);
      expect((await withTenant(tenantB, (c) => c.query(`delete from runs where id = $1`, [runA]))).rowCount).toBe(0);
      expect((await db.pool.query(`select project_name from runs where id = $1`, [runA])).rows[0].project_name).toBe("A project");

      // B cannot write a row into A's tenant.
      await expect(
        withTenant(tenantB, (c) => c.query(`insert into runs (tenant_id, project_name) values ($1, 'planted')`, [tenantA])),
      ).rejects.toThrow(/row-level security/);
    } finally {
      await pool.end();
    }
  });

  it("ordinary researcher actions succeed as the role for their own tenant and touch nothing of another", async () => {
    // Seeded as the owner: a run, a document and a finding in each tenant.
    const seed = async (tenant: string, tag: string) => {
      const run = (await db.pool.query(`insert into runs (tenant_id, project_name) values ($1, $2) returning id`, [tenant, `${tag} run`])).rows[0].id as string;
      const doc = (
        await db.pool.query(
          `insert into documents (tenant_id, run_id, kind, ingestion_type, source_filename, storage_path) values ($1, $2, 'table', 'raw', $3, $4) returning id`,
          [tenant, run, `${tag}.xlsx`, `${tenant}/${run}/${tag}.xlsx`],
        )
      ).rows[0].id as string;
      const finding = (
        await db.pool.query(`insert into findings (tenant_id, run_id, origin, finding_text, status) values ($1, $2, 'generated', $3, 'pending') returning id`, [tenant, run, `${tag} finding`])
      ).rows[0].id as string;
      return { run, doc, finding };
    };
    const a = await seed(tenantA, "A");
    const b = await seed(tenantB, "B");

    vi.resetModules();
    // db.ts keeps its pool on globalThis across module reloads (dev hot reload); drop it so this
    // import opens a new pool on the role's connection.
    (globalThis as { pgPool?: unknown }).pgPool = undefined;
    process.env.DATABASE_URL = appUrl;
    process.env.DEFAULT_TENANT_ID = tenantA;
    const actions = await import("../findingActions");
    const { withTenantRead, pool } = await import("../db");
    try {
      // The app's actual server actions, as tenant A, on A's own finding: stored.
      await actions.setFindingStatus(a.run, a.finding, "accepted");
      await actions.setFindingNote(a.run, a.finding, "A's researcher note");
      const ownA = (await db.pool.query(`select status, researcher_note from findings where id = $1`, [a.finding])).rows[0];
      expect(ownA).toEqual({ status: "accepted", researcher_note: "A's researcher note" });

      // The same actions as tenant A, aimed at B's run and finding: nothing changes.
      await actions.setFindingStatus(b.run, b.finding, "rejected");
      await actions.setFindingNote(b.run, b.finding, "planted");
      const ownB = (await db.pool.query(`select status, researcher_note from findings where id = $1`, [b.finding])).rows[0];
      expect(ownB).toEqual({ status: "pending", researcher_note: null });

      // File access goes through the document row: B's storage path is not visible to A, so A
      // cannot obtain it to download, sign or remove (storage itself is reached with the server
      // key, so this database lookup is what scopes it; see the handover).
      const path = await withTenantRead(tenantA, (c) => c.query(`select storage_path from documents where id = $1`, [b.doc]));
      expect(path.rowCount).toBe(0);
      expect((await withTenantRead(tenantB, (c) => c.query(`select storage_path from documents where id = $1`, [b.doc]))).rows[0].storage_path).toBe(
        `${tenantB}/${b.run}/B.xlsx`,
      );
    } finally {
      await pool.end();
      delete process.env.DEFAULT_TENANT_ID;
    }
  });

  it("with no tenant set, a tenant table query fails rather than returning every tenant's rows", async () => {
    const c = new Client({ connectionString: appUrl });
    await c.connect();
    try {
      await expect(c.query(`select count(*) from runs`)).rejects.toThrow(/app\.current_tenant_id/);
    } finally {
      await c.end();
    }
  });

  it("the tenants registry: no read or write of any tenant's row as the role; ordinary inserts referencing it still work", async () => {
    const c = new Client({ connectionString: appUrl });
    await c.connect();
    try {
      await c.query("begin");
      await c.query("select set_config('app.current_tenant_id', $1, true)", [tenantA]);
      // The foreign-key check on runs.tenant_id runs with the owner's rights, not the role's.
      expect((await c.query(`insert into runs (tenant_id, project_name) values ($1, 'needs tenants FK') returning id`, [tenantA])).rowCount).toBe(1);
      await c.query("rollback");
      for (const sql of [
        `select name from tenants`,
        `update tenants set name = 'renamed' where id = '${tenantB}'`,
        `insert into tenants (name) values ('planted')`,
        `delete from tenants where id = '${tenantB}'`,
      ]) {
        await c.query("begin");
        await c.query("select set_config('app.current_tenant_id', $1, true)", [tenantA]);
        await expect(c.query(sql), sql).rejects.toThrow(/permission denied for table tenants/);
        await c.query("rollback");
      }
    } finally {
      await c.end();
    }
    expect((await db.pool.query(`select name from tenants where id = $1`, [tenantB])).rows[0].name).toBe("B");
  });

  it("a role left with registry access by an earlier setup is reported and repaired by --apply", async () => {
    await db.pool.query(`grant select, insert, update, delete on table tenants to ${role}`);
    const report = runScript(SETUP, [], { DATABASE_ADMIN_URL: db.url, APP_DB_ROLE: role });
    expect(report.code).toBe(2);
    expect(report.out).toMatch(/has access to table\(s\) without row-level security, so across every tenant: tenants \(SELECT, INSERT, UPDATE, DELETE\)/);
    const repaired = runScript(SETUP, ["--apply"], { DATABASE_ADMIN_URL: db.url, APP_DB_ROLE: role, APP_DB_PASSWORD: password });
    expect(repaired.code, repaired.out).toBe(0);
    const left = (await db.pool.query(`select has_table_privilege($1, 'tenants', 'select') or has_table_privilege($1, 'tenants', 'update') as any`, [role])).rows[0].any;
    expect(left).toBe(false);
  });

  it("membership in the table owner bypasses the policies; setup refuses it, changes nothing and names the REVOKE", async () => {
    // A non-superuser, NOBYPASSRLS owner of runs, reached through an intermediate role, as a
    // deployment might have it.
    const owner = `${role}_owner`;
    const middle = `${role}_mid`;
    await db.pool.query(`create role ${owner} nologin nosuperuser nobypassrls`);
    await db.pool.query(`create role ${middle} nologin nosuperuser nobypassrls`);
    await db.pool.query(`alter table runs owner to ${owner}`);
    const runB = (await db.pool.query(`insert into runs (tenant_id, project_name) values ($1, 'B only') returning id`, [tenantB])).rows[0].id as string;
    const visibleToA = async () => {
      const c = new Client({ connectionString: appUrl });
      await c.connect();
      try {
        await c.query("begin");
        await c.query("select set_config('app.current_tenant_id', $1, true)", [tenantA]);
        return (await c.query(`select 1 from runs where id = $1`, [runB])).rowCount;
      } finally {
        await c.end();
      }
    };
    const memberships = () =>
      db.pool.query(`select roleid::regrole::text as r, member::regrole::text as m from pg_auth_members where member = $1::regrole or member = $2::regrole order by 1, 2`, [role, middle]);
    try {
      expect(await visibleToA()).toBe(0);
      await db.pool.query(`grant ${owner} to ${middle}`);
      await db.pool.query(`grant ${middle} to ${role}`);
      // The fault is real: tenant A now sees tenant B's run through inherited ownership.
      expect(await visibleToA()).toBe(1);

      const before = (await memberships()).rows;
      const privilegesBefore = (await db.pool.query(`select has_table_privilege($1, 'findings', 'select') as f`, [role])).rows[0];
      for (const args of [[], ["--apply"]]) {
        const r = runScript(SETUP, args, { DATABASE_ADMIN_URL: db.url, APP_DB_ROLE: role, APP_DB_PASSWORD: password });
        expect(r.code, r.out).toBe(2);
        expect(r.out).toContain(`(${role} -> ${middle} -> ${owner})`);
        expect(r.out).toContain(`REVOKE "${middle}" FROM "${role}";`);
        expect(r.out).toMatch(/Refused[\s\S]*never changes role memberships/);
        expect(r.out).not.toMatch(/is ready/);
      }
      expect((await memberships()).rows).toEqual(before);
      expect((await db.pool.query(`select has_table_privilege($1, 'findings', 'select') as f`, [role])).rows[0]).toEqual(privilegesBefore);

      // SET-only membership (no inheritance) is still a bypass: the role can SET ROLE to the owner.
      await db.pool.query(`revoke ${middle} from ${role}`);
      await db.pool.query(`grant ${owner} to ${role} with inherit false`);
      expect(await visibleToA()).toBe(0);
      const setOnly = runScript(SETUP, [], { DATABASE_ADMIN_URL: db.url, APP_DB_ROLE: role });
      expect(setOnly.code).toBe(2);
      expect(setOnly.out).toContain(`REVOKE "${owner}" FROM "${role}";`);
      const setConnection = new Client({ connectionString: appUrl });
      await setConnection.connect();
      try {
        await setConnection.query("begin");
        await setConnection.query("select set_config('app.current_tenant_id', $1, true)", [tenantA]);
        await setConnection.query(`set role ${owner}`);
        expect((await setConnection.query("select 1 from runs where id = $1", [runB])).rowCount).toBe(1);
        await setConnection.query("reset role");
        expect((await setConnection.query("select 1 from runs where id = $1", [runB])).rowCount).toBe(0);
        await setConnection.query("rollback");
      } finally {
        await setConnection.end();
      }
      await db.pool.query(`revoke ${owner} from ${role}`);
      expect(runScript(SETUP, [], { DATABASE_ADMIN_URL: db.url, APP_DB_ROLE: role }).code).toBe(0);
    } finally {
      await db.pool.query(`alter table runs owner to current_user`);
      for (const r of [middle, owner]) {
        await db.pool.query(`revoke ${r} from ${role}`).catch(() => {});
        await db.pool.query(`drop role if exists ${r}`).catch(() => {});
      }
    }
  });

  it("the backup's connection guard judges the connection, not the variable name", async () => {
    const { resolveAdminUrl } = await import("../../../scripts/db/adminConnection.mjs");
    await expect(resolveAdminUrl({})).rejects.toThrow(/Neither/);
    await expect(resolveAdminUrl({ DATABASE_ADMIN_URL: "postgres://postgres@127.0.0.1:55513/unavailable", DATABASE_URL: db.url })).rejects.toThrow();
    await expect(resolveAdminUrl({ DATABASE_URL: appUrl })).rejects.toThrow(/DATABASE_URL connects as .* cannot read \d+ table\(s\) completely.*Set DATABASE_ADMIN_URL/);
    // Explicit DATABASE_ADMIN_URL naming the restricted role is refused too, and not replaced by
    // a DATABASE_URL that would pass.
    await expect(resolveAdminUrl({ DATABASE_ADMIN_URL: appUrl, DATABASE_URL: db.url })).rejects.toThrow(
      /DATABASE_ADMIN_URL connects as .* cannot read \d+ table\(s\) completely: .*\(filtered by row-level security\).*not the app's restricted role/,
    );
    await expect(resolveAdminUrl({ DATABASE_URL: appUrl, DATABASE_ADMIN_URL: db.url })).resolves.toEqual({ url: db.url, source: "DATABASE_ADMIN_URL" });
    await expect(resolveAdminUrl({ DATABASE_URL: db.url })).resolves.toEqual({ url: db.url, source: "DATABASE_URL" });

    // BYPASSRLS is not enough on its own: without SELECT the backup would miss whole tables.
    const bypass = `${role}_bypass`;
    await db.pool.query(`create role ${bypass} login nosuperuser bypassrls password '${password}'`);
    try {
      await expect(resolveAdminUrl({ DATABASE_ADMIN_URL: asUser(db.url, bypass, password) })).rejects.toThrow(/cannot read \d+ table\(s\) completely: .*\(no SELECT\)/);
      await db.pool.query(`grant usage on schema public to ${bypass}`);
      await db.pool.query(`grant select on all tables in schema public to ${bypass}`);
      await expect(resolveAdminUrl({ DATABASE_ADMIN_URL: asUser(db.url, bypass, password) })).resolves.toMatchObject({ source: "DATABASE_ADMIN_URL" });
    } finally {
      await db.pool.query(`drop owned by ${bypass}`).catch(() => {});
      await db.pool.query(`drop role if exists ${bypass}`).catch(() => {});
    }
  });
});

describe.skipIf(!!TEST_DATABASE_URL)("separate application role (real database)", () => {
  it.skip(DISPOSABLE_DB_SKIP_REASON, () => {});
});
