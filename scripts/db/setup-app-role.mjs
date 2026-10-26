// IMP-001 / IMP-016: creates (or repairs) the separate database role the APP connects as, so
// row-level security actually applies to it. The table owner, a superuser and a BYPASSRLS role all
// skip the tenant policies, so while the app connects as `postgres` isolation rests on application
// code alone (scripts/check-tenant-isolation.mjs reports NOT ENFORCED). See docs/database-roles.md.
//
//   node scripts/db/setup-app-role.mjs            report only: what exists, what would change
//   node scripts/db/setup-app-role.mjs --apply    create/repair the role and its grants
//
// Environment (read from the shell, else from the app folder's .env files like `next dev`):
//   DATABASE_ADMIN_URL  an owner/admin connection (the URL the app uses today). Required.
//   APP_DB_ROLE         role name, default insights_app (lowercase letters, digits, underscore).
//   APP_DB_PASSWORD     the role's password, at least 16 characters. Required for --apply.
//                       Never printed, logged or written anywhere by this script.
//
// What --apply does, in one transaction, and only that:
//   - CREATE ROLE if missing, else ALTER ROLE, with LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB
//     NOCREATEROLE NOREPLICATION and the given password
//   - CONNECT on this database; USAGE on schema public (and schema extensions, if present, for
//     the vector type); SELECT/INSERT/UPDATE/DELETE on every public table that has row-level
//     security; USAGE/SELECT on every sequence; EXECUTE on every function
//   - on every public table WITHOUT row-level security (today only the tenants registry, which the
//     app never reads or writes: foreign-key checks run with the table owner's rights), REVOKE
//     this role's own table privileges, so it cannot read or rename another tenant's registry row.
//     The revoked tables are printed. Earlier versions of this script granted them.
//   - ALTER DEFAULT PRIVILEGES for each role that owns tables in public, so tables, sequences and
//     functions that later migrations create are granted the same way without rerunning this.
//     A later table created WITHOUT row-level security is therefore granted too; the report and
//     scripts/check-tenant-isolation.mjs both flag it, and rerunning --apply revokes it.
// Before changing anything it refuses an existing role that belongs, directly or through other
// roles, to a role that could bypass the tenant policies (an owner of public objects, a superuser,
// BYPASSRLS or CREATEROLE role, or a read/write-all role): a member can use that role's rights by
// inheritance or SET ROLE (scripts/db/roleExposure.mjs). It names each membership chain and the
// REVOKE to review, and never changes role memberships itself.
// It never drops anything, never changes table ownership, policies, memberships or data, and never
// touches DATABASE_URL: switching the app over is a separate, deliberate step (docs). Rerunning it
// is harmless. Exit code: 0 ok (or nothing to change), 1 error, 2 report found problems.
import pg from "pg";
import { accessibleUnprotectedTables, describeMemberships, unsafeMemberships } from "./roleExposure.mjs";

const apply = process.argv.includes("--apply");

if (!process.env.DATABASE_ADMIN_URL) {
  try {
    const mod = await import("@next/env");
    const loadEnvConfig = mod.loadEnvConfig ?? mod.default?.loadEnvConfig;
    if (typeof loadEnvConfig === "function") loadEnvConfig(process.cwd(), true);
  } catch (error) {
    console.error(`Could not read the .env files in ${process.cwd()}: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
const adminUrl = process.env.DATABASE_ADMIN_URL;
const role = process.env.APP_DB_ROLE || "insights_app";
const password = process.env.APP_DB_PASSWORD ?? "";

if (!adminUrl) {
  console.error("DATABASE_ADMIN_URL is not set. Set it to the owner/admin connection the app uses today (see docs/database-roles.md).");
  process.exit(1);
}
if (!/^[a-z][a-z0-9_]{2,62}$/.test(role)) {
  console.error(`APP_DB_ROLE "${role}" is not a plain lowercase role name (letters, digits, underscore).`);
  process.exit(1);
}
if (apply && password.length < 16) {
  console.error("APP_DB_PASSWORD must be set (at least 16 characters) for --apply. It is not printed or stored by this script.");
  process.exit(1);
}

const client = new pg.Client({ connectionString: adminUrl });
const ident = (s) => client.escapeIdentifier(s);

try {
  await client.connect();
  const me = (await client.query("select current_user as name, current_database() as db")).rows[0];
  if (me.name === role) {
    console.error(`DATABASE_ADMIN_URL connects as "${role}" itself. It must be the owner/admin connection, not the app role.`);
    process.exit(1);
  }
  const owners = (
    await client.query(
      `select distinct tableowner as owner from pg_tables where schemaname = 'public' order by 1`,
    )
  ).rows.map((r) => r.owner);
  if (owners.length === 0) {
    console.error(`No tables in schema public of database ${me.db}. Is DATABASE_ADMIN_URL the app's database, with migrations applied?`);
    process.exit(1);
  }
  if (owners.includes(role)) {
    console.error(`Role "${role}" owns tables in public, so the tenant policies would not apply to it. Choose another APP_DB_ROLE.`);
    process.exit(1);
  }
  const hasExtensions = (await client.query(`select 1 from pg_namespace where nspname = 'extensions'`)).rowCount > 0;

  const describe = async () => {
    const r = (
      await client.query(
        `select rolcanlogin, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolreplication
         from pg_roles where rolname = $1`,
        [role],
      )
    ).rows[0];
    if (!r) return { exists: false, problems: [`role "${role}" does not exist`] };
    const problems = [];
    if (!r.rolcanlogin) problems.push("cannot log in");
    if (r.rolsuper) problems.push("is a superuser");
    if (r.rolbypassrls) problems.push("has BYPASSRLS");
    if (r.rolcreatedb || r.rolcreaterole || r.rolreplication) problems.push("has CREATEDB, CREATEROLE or REPLICATION");
    const missing = (
      await client.query(
        `select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity
           and not (has_table_privilege($1, c.oid, 'select') and has_table_privilege($1, c.oid, 'insert')
                    and has_table_privilege($1, c.oid, 'update') and has_table_privilege($1, c.oid, 'delete'))
         order by 1`,
        [role],
      )
    ).rows.map((x) => x.name);
    const memberships = describeMemberships(await unsafeMemberships(client, role));
    if (memberships.length) problems.push(...memberships.map((m) => `unsafe membership: ${m}`));
    const open = await accessibleUnprotectedTables(client, role);
    if (open.length) {
      problems.push(
        `has access to table(s) without row-level security, so across every tenant: ${open.map((t) => `${t.name} (${t.privileges.join(", ")})`).join("; ")}`,
      );
    }
    if (missing.length) problems.push(`lacks read/write grants on ${missing.length} table(s): ${missing.slice(0, 8).join(", ")}${missing.length > 8 ? ", ..." : ""}`);
    const unseq = (
      await client.query(
        `select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind = 'S'
           -- CASE keeps the planner from calling has_sequence_privilege on non-sequence rows
           and (case when c.relkind = 'S' then not has_sequence_privilege($1, c.oid, 'usage') else false end)`,
        [role],
      )
    ).rowCount;
    if (unseq) problems.push(`lacks USAGE on ${unseq} sequence(s)`);
    const noRls = (
      await client.query(
        `select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
           and exists (select 1 from information_schema.columns col where col.table_schema = 'public' and col.table_name = c.relname and col.column_name = 'tenant_id')`,
      )
    ).rows.map((x) => x.name);
    // Reported, not changed: enabling RLS is a schema decision for a migration, not this script.
    if (noRls.length) problems.push(`tenant tables WITHOUT row-level security (fix by migration): ${noRls.join(", ")}`);
    return { exists: true, problems, unsafeMemberships: memberships.length > 0 };
  };

  const before = await describe();
  console.log(`Database ${me.db}, admin connection as ${me.name}; table owners in public: ${owners.join(", ")}.`);
  console.log(
    before.exists && before.problems.length === 0
      ? `Role "${role}" already exists with the restricted attributes and every grant.`
      : `Role "${role}": ${before.problems.join("; ")}.`,
  );
  if (before.unsafeMemberships) {
    // Refused even with --apply: re-granting would report the role "ready" while it can still act
    // as the owner. Memberships may be deliberate in a deployment, so they are not changed here.
    console.log(
      `\nRefused${apply ? ": nothing was changed" : ""}. Remove the membership(s) above (after checking nothing else relies on them), ` +
        "or choose a new APP_DB_ROLE, then run this again. This script never changes role memberships.",
    );
    process.exit(2);
  }
  if (!apply) {
    console.log("\nReport only. Run again with --apply (and APP_DB_PASSWORD set) to create or repair the role.");
    process.exit(before.exists && before.problems.length === 0 ? 0 : 2);
  }

  await client.query("begin");
  try {
    const attrs = "login nosuperuser nobypassrls nocreatedb nocreaterole noreplication";
    const pw = client.escapeLiteral(password);
    await client.query(before.exists ? `alter role ${ident(role)} with ${attrs} password ${pw}` : `create role ${ident(role)} with ${attrs} password ${pw}`);
    await client.query(`grant connect on database ${ident(me.db)} to ${ident(role)}`);
    for (const schema of hasExtensions ? ["public", "extensions"] : ["public"]) {
      await client.query(`grant usage on schema ${ident(schema)} to ${ident(role)}`);
    }
    const tables = (
      await client.query(
        `select c.relname::text as name, c.relrowsecurity as rls from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind in ('r', 'p') order by 1`,
      )
    ).rows;
    const unprotected = [];
    for (const t of tables) {
      if (t.rls) {
        await client.query(`grant select, insert, update, delete on table public.${ident(t.name)} to ${ident(role)}`);
      } else {
        // No tenant filter exists on this table, so any access would be cross-tenant.
        await client.query(`revoke all on table public.${ident(t.name)} from ${ident(role)}`);
        unprotected.push(t.name);
      }
    }
    if (unprotected.length) console.log(`No access granted (access by this role revoked) on table(s) without row-level security: ${unprotected.join(", ")}.`);
    await client.query(`grant usage, select on all sequences in schema public to ${ident(role)}`);
    await client.query(`grant execute on all functions in schema public to ${ident(role)}`);
    for (const owner of owners) {
      // Objects later created by this owner (migrations) get the same grants automatically.
      // Requires the admin connection to be that owner or a member of it; reported if not.
      try {
        await client.query("savepoint dp");
        await client.query(`alter default privileges for role ${ident(owner)} in schema public grant select, insert, update, delete on tables to ${ident(role)}`);
        await client.query(`alter default privileges for role ${ident(owner)} in schema public grant usage, select on sequences to ${ident(role)}`);
        await client.query(`alter default privileges for role ${ident(owner)} in schema public grant execute on functions to ${ident(role)}`);
        await client.query("release savepoint dp");
      } catch (error) {
        await client.query("rollback to savepoint dp");
        console.log(`Note: default privileges for tables created later by "${owner}" could not be set (${error.message}). Rerun this script after each migration.`);
      }
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }

  const after = await describe();
  if (after.problems.length) {
    console.log(`\nApplied, but problems remain: ${after.problems.join("; ")}.`);
    process.exit(2);
  }
  console.log(
    `\nRole "${role}" is ready: can log in; not a superuser; no BYPASSRLS, CREATEDB, CREATEROLE or REPLICATION; owns no tables; no membership that bypasses the policies; read/write on every public table with row-level security and none on tables without it.` +
      "\nNext (docs/database-roles.md): point the app's DATABASE_URL at this role, restart the app, then run node scripts/check-tenant-isolation.mjs.",
  );
  process.exit(0);
} catch (error) {
  console.error(`Could not set up the app role: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}
