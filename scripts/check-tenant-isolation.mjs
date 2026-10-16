// IMP-001 / IMP-016: is tenant isolation actually in effect for the database role this app uses?
// READ-ONLY. Run against the real database before any second user or organisation is added:
//
//   node scripts/check-tenant-isolation.mjs          (reads DATABASE_URL, else the app's .env files)
//
// Run it from the app folder: when DATABASE_URL is not already set, it loads the .env files there
// the same way `next dev` does (@next/env, development mode), and says which files it read.
//
// Why this is needed: every tenant table has a row-level-security policy keyed on
// app.current_tenant_id, and the app sets that per transaction (src/lib/db.ts). But PostgreSQL does
// not apply policies to a table's OWNER (or a superuser, or a BYPASSRLS role) unless the table has
// FORCE ROW LEVEL SECURITY, which no table has. If the app connects as the owning role, the policies
// are never applied to it and isolation rests on application code alone.
//
// Two structural gaps are checked as well (scripts/db/roleExposure.mjs): a role can act as a table
// owner, superuser or BYPASSRLS role through a role it belongs to (inherited or by SET ROLE), and a
// public table without row-level security (the tenants registry) is shared by every tenant, so any
// privilege on it crosses tenants.
//
// The decisive check: inside a transaction that is rolled back, set the tenant to a random id that
// owns nothing and count visible rows in tenant tables. Any row visible means isolation is NOT
// enforced for this role. Nothing is written.
// Exit code: 0 enforced, 2 not enforced, 1 could not check.
import pg from "pg";
import { randomUUID } from "node:crypto";
import { accessibleUnprotectedTables, describeMemberships, unsafeMemberships } from "./db/roleExposure.mjs";

let envFiles = [];
if (!process.env.DATABASE_URL) {
  try {
    // @next/env is CommonJS: imported from an ES module its functions sit on the default export.
    const mod = await import("@next/env");
    const loadEnvConfig = mod.loadEnvConfig ?? mod.default?.loadEnvConfig;
    if (typeof loadEnvConfig !== "function") throw new Error("@next/env does not export loadEnvConfig");
    envFiles = loadEnvConfig(process.cwd(), true).loadedEnvFiles.map((f) => f.path);
  } catch (error) {
    console.error(`Could not read the .env files in ${process.cwd()}: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    `DATABASE_URL is not set, and no .env file in ${process.cwd()} defines it` +
      (envFiles.length ? ` (read: ${envFiles.join(", ")}).` : " (no .env files found; run this from the app folder).") +
      // Next.js (and so @next/env) never reads .env.local when NODE_ENV is "test".
      (process.env.NODE_ENV === "test" ? " NODE_ENV is \"test\", which makes .env.local be ignored." : ""),
  );
  process.exit(1);
}
if (envFiles.length) console.log(`DATABASE_URL read from the app's .env files (${envFiles.join(", ")}).`);

const client = new pg.Client({ connectionString: url });
try {
  await client.connect();
  const role = (
    await client.query(
      `select current_user as role, r.rolsuper as superuser, r.rolbypassrls as bypass_rls
       from pg_roles r where r.rolname = current_user`,
    )
  ).rows[0];
  const tables = (
    await client.query(
      `select c.relname as name, pg_get_userbyid(c.relowner) as owner, c.relrowsecurity as rls, c.relforcerowsecurity as forced
       from pg_class c join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
       where c.relkind = 'r'
         and exists (select 1 from information_schema.columns col
                     where col.table_schema = 'public' and col.table_name = c.relname and col.column_name = 'tenant_id')
       order by 1`,
    )
  ).rows;
  if (tables.length === 0) {
    // Nothing to judge: almost certainly the wrong database (or migrations not applied). Saying
    // "enforced" here would be a pass on no evidence.
    console.error(`Could not check: no tables with a tenant_id column in the public schema of this database (role ${role.role}). Is DATABASE_URL pointing at the app's database?`);
    process.exit(1);
  }
  const owned = tables.filter((t) => t.owner === role.role && !t.forced).map((t) => t.name);
  const noRls = tables.filter((t) => !t.rls).map((t) => t.name);
  // Membership in an exempt role (the owner, a superuser, BYPASSRLS ...) is checked separately
  // from this role's own attributes; the role's own ownership is reported as `owned` above.
  const memberships = (await unsafeMemberships(client, role.role)).filter((m) => !m.self);
  const openTables = await accessibleUnprotectedTables(client, role.role);

  // Behavioural probe on the core tables, rolled back.
  const probeTables = ["runs", "documents", "findings", "synthesized_insights", "recommendations"].filter((n) => tables.some((t) => t.name === n));
  const visible = {};
  await client.query("begin");
  try {
    await client.query("select set_config('app.current_tenant_id', $1, true)", [randomUUID()]);
    for (const t of probeTables) {
      visible[t] = Number((await client.query(`select count(*) from ${t}`)).rows[0].count);
    }
  } finally {
    await client.query("rollback");
  }
  const leaked = Object.entries(visible).filter(([, n]) => n > 0);

  console.log(`Role: ${role.role} (superuser: ${role.superuser}, bypass RLS: ${role.bypass_rls})`);
  console.log(`Tenant tables: ${tables.length}; without RLS: ${noRls.length ? noRls.join(", ") : "none"}`);
  console.log(`Tenant tables owned by this role without FORCE ROW LEVEL SECURITY: ${owned.length}`);
  console.log(`Memberships that bypass the policies: ${memberships.length ? memberships.map((m) => m.path.join(" -> ")).join("; ") : "none"}`);
  console.log(`Tables without row-level security this role can use: ${openTables.length ? openTables.map((t) => `${t.name} (${t.privileges.join(", ")})`).join("; ") : "none"}`);
  console.log(`Rows visible under an unused tenant id: ${Object.entries(visible).map(([t, n]) => `${t}=${n}`).join(", ") || "(no core tables found)"}`);
  // Not enforced if any row leaked, or if the role is structurally exempt from the policies
  // (superuser, BYPASSRLS, or owner of an unforced table) - the latter holds even on an empty
  // database, where the row probe alone would see nothing either way.
  const exempt = role.superuser || role.bypass_rls;
  if (leaked.length > 0 || noRls.length > 0 || exempt || owned.length > 0 || memberships.length > 0 || openTables.length > 0) {
    // The fix depends on WHY policies do not apply. FORCE ROW LEVEL SECURITY only removes a table
    // OWNER's exemption; a superuser or BYPASSRLS role skips every policy regardless, so for that
    // case a separate application role is the only fix.
    const reasons = [];
    const fixes = [];
    if (exempt) {
      reasons.push(`this role is ${role.superuser ? "a superuser" : "allowed to bypass row-level security (BYPASSRLS)"}, so no policy applies to it`);
      fixes.push(
        "Connect the app as a separate role that is not a superuser, has no BYPASSRLS and owns no tables, granted only the table, sequence and function privileges the app needs. " +
          "FORCE ROW LEVEL SECURITY does not help here: it does not apply to superusers or BYPASSRLS roles.",
      );
    } else if (owned.length > 0) {
      reasons.push(`this role owns ${owned.length} tenant table(s) without FORCE ROW LEVEL SECURITY, so their policies do not apply to it`);
      fixes.push(
        "Preferred: connect the app as a separate non-owner role without BYPASSRLS, granted only the privileges it needs. " +
          "Alternative: ALTER TABLE ... FORCE ROW LEVEL SECURITY on every tenant table; then migrations, backup and restore running as the owner are also filtered by the policies and must set a tenant or run as a different, deliberately privileged role.",
      );
    }
    if (memberships.length > 0) {
      reasons.push(`this role belongs to ${memberships.length} role(s) that bypass the policies, so it can act with their rights`);
      fixes.push(...describeMemberships(memberships));
    }
    if (openTables.length > 0) {
      reasons.push(`this role can use ${openTables.length} table(s) that have no row-level security, which every tenant shares`);
      fixes.push(
        `Revoke this role's access to: ${openTables.map((t) => t.name).join(", ")} (node scripts/db/setup-app-role.mjs --apply does this for the app role), or protect the table with a policy if the app needs it.`,
      );
    }
    if (noRls.length > 0) {
      reasons.push(`${noRls.length} tenant table(s) have row-level security switched off`);
      fixes.push(`Enable row-level security with a tenant policy on: ${noRls.join(", ")}.`);
    }
    if (leaked.length > 0 && reasons.length === 0) {
      reasons.push("the policies themselves let rows through for a tenant that owns nothing");
      fixes.push("Inspect the policies on the tables listed above.");
    }
    console.log(
      `\nVERDICT: NOT ENFORCED. ${reasons.join("; ").replace(/^./, (c) => c.toUpperCase())}.` +
        (leaked.length ? ` Rows of other tenants were visible: ${leaked.map(([t, n]) => `${t}=${n}`).join(", ")}.` : "") +
        `\nFix before any second user or organisation:\n- ${fixes.join("\n- ")}`,
    );
    process.exit(2);
  }
  console.log(
    "\nVERDICT: ENFORCED. This role is not exempt from the policies (not a superuser, no BYPASSRLS, owns no unforced tenant table, no membership that bypasses the policies, no access to unprotected tables)" +
      (Object.keys(visible).length ? " and saw no other tenant's rows." : "."),
  );
  process.exit(0);
} catch (error) {
  console.error(`Could not check: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}
