// IMP-001 / IMP-016: the one place that decides whether a database role can get around the tenant
// policies. Used by the app-role setup (scripts/db/setup-app-role.mjs), the tenant check
// (scripts/check-tenant-isolation.mjs) and the backup connection guard (scripts/db/adminConnection.mjs),
// so the three cannot disagree about what "restricted" means.
//
// Why attributes alone are not enough: PostgreSQL skips a table's policies for its OWNER, and
// "owner" includes every role that has the owner's privileges through membership (INHERIT), even
// several grants removed. A member that cannot inherit can still `SET ROLE` to the owner, or to a
// superuser/BYPASSRLS role, and act as it. So a role that is NOSUPERUSER, NOBYPASSRLS and owns no
// table can still bypass isolation through a role it belongs to. pg_has_role(..., 'MEMBER') counts
// direct and indirect membership regardless of INHERIT or SET, which covers both paths, on
// PostgreSQL 15 and 16+.
//
// Separately, a public table WITHOUT row-level security (the tenants registry is one) has no
// tenant filter at all, so any privilege on it is cross-tenant. Read-all/write-all predefined roles
// count here too: has_table_privilege includes them.
//
// Every query here only reads the catalogs; nothing is changed.

/** Roles `role` belongs to, directly or indirectly, that would let it bypass the tenant policies,
 * each with the membership chain that reaches it and why it is unsafe. Includes `role` itself
 * (chain of one) when it owns relevant objects or has an unsafe attribute. */
export async function unsafeMemberships(client, role) {
  const rows = (
    await client.query(
      `with recursive chain(roleid, path) as (
         select r.oid, array[r.rolname::text] from pg_roles r where r.rolname = $1
         union
         select m.roleid, c.path || g.rolname::text
         from chain c join pg_auth_members m on m.member = c.roleid join pg_roles g on g.oid = m.roleid
         where not g.rolname::text = any (c.path)
       ),
       reach as (select distinct on (roleid) roleid, path from chain order by roleid, array_length(path, 1))
       select r.rolname::text as name, reach.path,
              r.rolsuper as superuser, r.rolbypassrls as bypass_rls, r.rolcreaterole as create_role,
              (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
                 where n.nspname = 'public' and c.relowner = r.oid and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')) as owned_relations,
              (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proowner = r.oid) as owned_functions,
              exists (select 1 from pg_namespace n where n.nspname = 'public' and n.nspowner = r.oid) as owns_schema,
              exists (select 1 from pg_database d where d.datname = current_database() and d.datdba = r.oid) as owns_database,
              r.rolname in ('pg_read_all_data', 'pg_write_all_data') as all_data
       from reach join pg_roles r on r.oid = reach.roleid
       order by array_length(reach.path, 1), 1`,
      [role],
    )
  ).rows;
  const out = [];
  for (const r of rows) {
    const reasons = [];
    if (r.superuser) reasons.push("is a superuser");
    if (r.bypass_rls) reasons.push("has BYPASSRLS");
    if (r.create_role) reasons.push("has CREATEROLE");
    if (r.owned_relations) reasons.push(`owns ${r.owned_relations} table(s)/view(s)/sequence(s) in public`);
    if (r.owned_functions) reasons.push(`owns ${r.owned_functions} function(s) in public`);
    if (r.owns_schema) reasons.push("owns schema public");
    if (r.owns_database) reasons.push("owns this database");
    if (r.all_data) reasons.push("reads or writes every table regardless of grants");
    if (reasons.length) out.push({ role: r.name, path: r.path, self: r.path.length === 1, reasons });
  }
  return out;
}

/** Public tables with row-level security switched off on which `role` holds any of
 * SELECT/INSERT/UPDATE/DELETE (directly, through PUBLIC, membership or a predefined role). */
export async function accessibleUnprotectedTables(client, role) {
  return (
    await client.query(
      `select c.relname::text as name,
              array_remove(array[
                case when has_table_privilege($1, c.oid, 'select') then 'SELECT' end,
                case when has_table_privilege($1, c.oid, 'insert') then 'INSERT' end,
                case when has_table_privilege($1, c.oid, 'update') then 'UPDATE' end,
                case when has_table_privilege($1, c.oid, 'delete') then 'DELETE' end], null) as privileges
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
       order by 1`,
      [role],
    )
  ).rows.filter((r) => r.privileges.length > 0);
}

/** One line per unsafe membership, with the chain and what to review. Never changes anything. */
export function describeMemberships(found) {
  return found.map((f) =>
    f.self
      ? `"${f.role}" itself ${f.reasons.join(", ")}`
      : `"${f.path[0]}" belongs to "${f.role}" (${f.path.join(" -> ")}), which ${f.reasons.join(", ")}; ` +
        `as a member it can act with that role's rights (inherited, or by SET ROLE). Review, then remove the membership yourself: REVOKE "${f.path[1]}" FROM "${f.path[0]}";`,
  );
}

/** Whether `role` (normally current_user) can read EVERY public table completely: SELECT on it,
 * and either no row-level security on it or a way past it (superuser, BYPASSRLS, or the owner's
 * privileges through membership on a table that does not FORCE row-level security). Returns the
 * tables it would miss rows of, or could not read at all. */
export async function incompletelyReadableTables(client, role) {
  return (
    await client.query(
      `select c.relname::text as name,
              case when not has_table_privilege($1, c.oid, 'select') then 'no SELECT' else 'filtered by row-level security' end as reason
       from pg_class c join pg_namespace n on n.oid = c.relnamespace, pg_roles me
       where me.rolname = $1 and n.nspname = 'public' and c.relkind in ('r', 'p')
         and (not has_table_privilege($1, c.oid, 'select')
              or (c.relrowsecurity and not me.rolsuper and not me.rolbypassrls
                  and (c.relforcerowsecurity or not pg_has_role($1, c.relowner, 'USAGE'))))
       order by 1`,
      [role],
    )
  ).rows;
}
