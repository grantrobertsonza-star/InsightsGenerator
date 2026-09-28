import { Pool, type PoolClient } from "pg";

// One shared connection pool for the whole app.
// Next.js can reload this file in dev, so we stash the pool on the global
// object to avoid opening a new pool on every reload.
const globalForDb = globalThis as unknown as { pgPool?: Pool };

export const pool =
  globalForDb.pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
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
    await client.query("begin");
    await client.query("select set_config('app.current_tenant_id', $1, true)", [tenantId]);
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
