// IMP-001 / IMP-016: scripts/check-tenant-isolation.mjs, run as a separate process against a real
// disposable database, exactly as a researcher runs it. It reads the app's .env files only when
// DATABASE_URL is unset, so each case runs from a temporary folder holding its own .env.local and
// with DATABASE_URL removed from the environment.
//   - .env.local is actually read (regression: the CommonJS @next/env import found no function and
//     the script reported "DATABASE_URL is not set" with a perfectly good .env.local)
//   - a superuser connection: NOT ENFORCED, and the fix is a separate role, never FORCE (which does
//     not apply to superusers or BYPASSRLS roles)
//   - a non-superuser table owner: NOT ENFORCED, with both remedies
//   - a non-owner, NOSUPERUSER, NOBYPASSRLS role with only grants on protected tables: ENFORCED,
//     and it saw no rows of the tenant that does own data
//   - the same role with access to the tenants registry (no row-level security): NOT ENFORCED
//   - the same role made a member of the table owner, inherited or SET-only: NOT ENFORCED, even
//     though its own attributes and ownership are unchanged
//   - no .env and no DATABASE_URL, and a database without tenant tables: could not check (exit 1),
//     never a verdict
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "pg";
import { createDisposableDb, DISPOSABLE_DB_SKIP_REASON, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";

const SCRIPT = path.join(process.cwd(), "scripts", "check-tenant-isolation.mjs");

function runCheck(envLocal: string | null) {
  const dir = mkdtempSync(path.join(tmpdir(), "tenant-check-"));
  try {
    if (envLocal !== null) writeFileSync(path.join(dir, ".env.local"), envLocal);
    // The script resolves pg and @next/env from the folder it is run in, like the app folder.
    symlinkSync(path.join(process.cwd(), "node_modules"), path.join(dir, "node_modules"), process.platform === "win32" ? "junction" : "dir");
    // As a researcher runs it: no DATABASE_URL in the environment, and no NODE_ENV (the test
    // runner's NODE_ENV=test would make @next/env skip .env.local).
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([k]) => k !== "DATABASE_URL" && k !== "NODE_ENV"),
    ) as NodeJS.ProcessEnv;
    const r = spawnSync(process.execPath, [SCRIPT], { cwd: dir, env, encoding: "utf8", timeout: 60000 });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const withUser = (url: string, user: string, password?: string) => {
  const u = new URL(url);
  u.username = user;
  u.password = password ?? "";
  return u.toString();
};

describe.skipIf(!TEST_DATABASE_URL)("tenant isolation check script (real database)", () => {
  let db: DisposableDb;
  const suffix = randomBytes(4).toString("hex");
  const appRole = `ie_test_app_${suffix}`;
  const ownerRole = `ie_test_owner_${suffix}`;
  const password = randomBytes(8).toString("hex");

  beforeAll(async () => {
    db = await createDisposableDb();
    const tenant = randomUUID();
    await db.pool.query(`insert into tenants (id, name) values ($1, 'Check tenant')`, [tenant]);
    await db.pool.query(`insert into runs (tenant_id, project_name) values ($1, 'Owned data')`, [tenant]);
    await db.pool.query(`create role ${appRole} login nosuperuser nobypassrls nocreatedb nocreaterole password '${password}'`);
    await db.pool.query(`grant usage on schema public to ${appRole}`);
    await db.pool.query(`grant select, insert, update, delete on all tables in schema public to ${appRole}`);
    // As scripts/db/setup-app-role.mjs leaves it: no access to the unprotected tenants registry.
    await db.pool.query(`revoke all on table tenants from ${appRole}`);
    await db.pool.query(`grant usage, select on all sequences in schema public to ${appRole}`);
    await db.pool.query(`grant execute on all functions in schema public to ${appRole}`);
    // A non-superuser owner of one tenant table (no FORCE), to separate "owner" from "superuser".
    await db.pool.query(`create role ${ownerRole} login nosuperuser nobypassrls password '${password}'`);
    await db.pool.query(`grant usage on schema public to ${ownerRole}`);
    await db.pool.query(`grant select on all tables in schema public to ${ownerRole}`);
    await db.pool.query(`alter table runs owner to ${ownerRole}`);
  }, 120000);

  afterAll(async () => {
    await db?.pool.query(`alter table runs owner to current_user`).catch(() => {});
    await db?.drop();
    const c = new Client({ connectionString: TEST_DATABASE_URL });
    await c.connect();
    for (const r of [appRole, ownerRole]) await c.query(`drop role if exists ${r}`).catch(() => {});
    await c.end();
  });

  it("reads DATABASE_URL from .env.local, and a superuser gets the separate-role fix, not FORCE", () => {
    const r = runCheck(`DATABASE_URL=${db.url}\n`);
    expect(r.out).toContain("DATABASE_URL read from the app's .env files");
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/VERDICT: NOT ENFORCED\. This role is a superuser/);
    expect(r.out).toMatch(/Connect the app as a separate role/);
    expect(r.out).toMatch(/FORCE ROW LEVEL SECURITY does not help here/);
    expect(r.out).not.toMatch(/Alternative: ALTER TABLE/);
  });

  it("a non-superuser that owns a tenant table: not enforced, with both remedies", () => {
    const r = runCheck(`DATABASE_URL=${withUser(db.url, ownerRole, password)}\n`);
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/owns 1 tenant table\(s\) without FORCE ROW LEVEL SECURITY/);
    expect(r.out).toMatch(/runs=1/);
    expect(r.out).toMatch(/Preferred: connect the app as a separate non-owner role/);
    expect(r.out).toMatch(/Alternative: ALTER TABLE \.\.\. FORCE ROW LEVEL SECURITY/);
  });

  it("a non-owner, NOSUPERUSER, NOBYPASSRLS role with grants only: enforced, sees no other tenant's rows", () => {
    const r = runCheck(`DATABASE_URL=${withUser(db.url, appRole, password)}\n`);
    expect(r.out).toMatch(/Role: ie_test_app_\w+ \(superuser: false, bypass RLS: false\)/);
    expect(r.out).toMatch(/owned by this role without FORCE ROW LEVEL SECURITY: 0/);
    expect(r.out).toMatch(/runs=0/);
    expect(r.out).toMatch(/VERDICT: ENFORCED/);
    expect(r.code).toBe(0);
  });

  it("access to the tenants registry, which has no row-level security, is reported as not enforced", async () => {
    await db.pool.query(`grant select, update on table tenants to ${appRole}`);
    try {
      const r = runCheck(`DATABASE_URL=${withUser(db.url, appRole, password)}\n`);
      expect(r.code).toBe(2);
      expect(r.out).toMatch(/Tables without row-level security this role can use: tenants \(SELECT, UPDATE\)/);
      expect(r.out).toMatch(/VERDICT: NOT ENFORCED\. This role can use 1 table\(s\) that have no row-level security/);
    } finally {
      await db.pool.query(`revoke all on table tenants from ${appRole}`);
    }
  });

  it("membership in the table owner, inherited or SET-only, is reported as not enforced", async () => {
    for (const option of ["inherit true", "inherit false"]) {
      await db.pool.query(`grant ${ownerRole} to ${appRole} with ${option}`);
      try {
        const r = runCheck(`DATABASE_URL=${withUser(db.url, appRole, password)}\n`);
        expect(r.code, option).toBe(2);
        expect(r.out).toMatch(new RegExp(`Memberships that bypass the policies: ${appRole} -> ${ownerRole}`));
        expect(r.out).toMatch(/belongs to 1 role\(s\) that bypass the policies/);
        expect(r.out).toContain(`REVOKE "${ownerRole}" FROM "${appRole}";`);
      } finally {
        await db.pool.query(`revoke ${ownerRole} from ${appRole}`);
      }
    }
    // Back to the plain role: enforced again.
    expect(runCheck(`DATABASE_URL=${withUser(db.url, appRole, password)}\n`).code).toBe(0);
  });

  it("no DATABASE_URL anywhere, or a database with no tenant tables: could not check, never a verdict", async () => {
    const none = runCheck(null);
    expect(none.code).toBe(1);
    expect(none.out).toMatch(/DATABASE_URL is not set, and no \.env file .* defines it \(no \.env files found/);

    const empty = new URL(TEST_DATABASE_URL);
    empty.pathname = `/ie_test_empty_${suffix}`;
    const c = new Client({ connectionString: TEST_DATABASE_URL });
    await c.connect();
    await c.query(`create database ie_test_empty_${suffix}`);
    try {
      const r = runCheck(`DATABASE_URL=${empty.toString()}\n`);
      expect(r.code).toBe(1);
      expect(r.out).toMatch(/Could not check: no tables with a tenant_id column/);
      expect(r.out).not.toMatch(/VERDICT/);
    } finally {
      await c.query(`drop database if exists ie_test_empty_${suffix} with (force)`);
      await c.end();
    }
  });
});

describe.skipIf(!!TEST_DATABASE_URL)("tenant isolation check script (real database)", () => {
  it.skip(DISPOSABLE_DB_SKIP_REASON, () => {});
});
