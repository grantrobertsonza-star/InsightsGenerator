// Which connection an ADMIN script (backup) must use once the app connects as its own restricted
// role (scripts/db/setup-app-role.mjs). A backup or row count made through a connection that
// row-level security filters, or that lacks SELECT on a table, would silently be incomplete.
//
// The connection is chosen by name (DATABASE_ADMIN_URL when set, else DATABASE_URL), but it is
// accepted on what the DATABASE says about it, never on the variable's name: whichever one is
// chosen must be able to read every public table completely (SELECT on it, and either no
// row-level security, or superuser, BYPASSRLS, or the owner's rights on a table that does not FORCE
// it; scripts/db/roleExposure.mjs). DATABASE_ADMIN_URL pointing at the app's restricted role is
// refused exactly like DATABASE_URL would be. There is no fallback from a refused
// DATABASE_ADMIN_URL to DATABASE_URL: an explicit setting that is wrong is reported, not replaced.
//
// Scope: the public schema, which holds every app table. Storage files are backed up separately
// with the service key and are not judged here.
import pg from "pg";
import { incompletelyReadableTables } from "./roleExposure.mjs";

export async function resolveAdminUrl(env) {
  const source = env.DATABASE_ADMIN_URL ? "DATABASE_ADMIN_URL" : env.DATABASE_URL ? "DATABASE_URL" : null;
  if (!source) throw new Error("Neither DATABASE_ADMIN_URL nor DATABASE_URL is set.");
  const url = env[source];
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const me = (await client.query("select current_user as name")).rows[0].name;
    const tableCount = Number(
      (await client.query(`select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p')`))
        .rows[0].count,
    );
    if (tableCount === 0) {
      // Nothing to back up is far more likely a wrong database than an empty app.
      throw new Error(`${source} connects as "${me}" to a database with no tables in schema public. Is it the app's database?`);
    }
    const missed = await incompletelyReadableTables(client, me);
    if (missed.length === 0) return { url, source };
    const list = missed.slice(0, 6).map((t) => `${t.name} (${t.reason})`).join(", ") + (missed.length > 6 ? ", ..." : "");
    throw new Error(
      `${source} connects as "${me}", which cannot read ${missed.length} table(s) completely: ${list}. A backup through it would be incomplete. ` +
        (source === "DATABASE_ADMIN_URL"
          ? "Set DATABASE_ADMIN_URL to the owner/admin connection, not the app's restricted role (docs/database-roles.md)."
          : "Set DATABASE_ADMIN_URL to the owner/admin connection (docs/database-roles.md)."),
    );
  } finally {
    await client.end().catch(() => {});
  }
}
