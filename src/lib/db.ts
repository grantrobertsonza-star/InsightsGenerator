import { Pool, type PoolClient } from "pg";

// One shared connection pool for the whole app.
// Next.js can reload this file in dev, so we stash the pool on the global
// object to avoid opening a new pool on every reload.
const globalForDb = globalThis as unknown as { pgPool?: Pool };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const pool =
  globalForDb.pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    // Supabase session mode allows 15 clients in total; stay well under it so a
    // dev-server reload that briefly holds an old pool does not hit the cap.
    max: Number(process.env.DB_POOL_MAX) || 10,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.pgPool = pool;
}

/**
 * Runs `callback` with a database client that has been scoped to a single
 * tenant for the duration of one transaction, per the engineering brief's
 * row-level-security design (Section 3): every tenant-scoped table's RLS
 * policy checks `app.current_tenant_id`, so this is the one place in the
 * codebase responsible for setting it correctly before any query runs.
 *
 * `set local` only affects the current transaction, so it can never leak
 * into a different request that happens to reuse the same pooled connection.
 */
export async function withTenant<T>(
  tenantId: string,
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    if (UUID.test(tenantId)) {
      // One round trip instead of two. Safe to inline: the value is checked
      // to be a bare UUID, which cannot carry a quote or a statement.
      await client.query(
        `begin; select set_config('app.current_tenant_id', '${tenantId}', true)`,
      );
    } else {
      await client.query("begin");
      await client.query("select set_config('app.current_tenant_id', $1, true)", [tenantId]);
    }
    const result = await callback(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

// The tenant each pooled connection was last set to for reads, so a read
// only pays for the set_config round trip the first time a connection is used.
const readTenantOfClient = new WeakMap<PoolClient, string>();

/**
 * For read-only loaders. withTenant wraps each call in a transaction (begin,
 * set_config, work, commit), which is three extra round trips to the database.
 * Reads do not need that: at the default READ COMMITTED level every statement
 * already sees its own snapshot, so a transaction around reads changes
 * nothing. This sets the tenant once per connection instead, so a read costs
 * one round trip per query. Never use it for anything that writes; writes
 * keep using withTenant.
 */
export async function withTenantRead<T>(
  tenantId: string,
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    if (readTenantOfClient.get(client) !== tenantId) {
      await client.query("select set_config('app.current_tenant_id', $1, false)", [tenantId]);
      readTenantOfClient.set(client, tenantId);
    }
    return await callback(client);
  } finally {
    client.release();
  }
}
