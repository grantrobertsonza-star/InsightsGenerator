// Disposable PostgreSQL for *.db.test.ts files. Builds a fresh database named ie_test_<random>
// from supabase/migrations, hands it to the test, and drops it afterwards.
//
// Safety: only runs when TEST_DATABASE_URL is set, and refuses any host other than localhost /
// 127.0.0.1 / ::1. It never reads DATABASE_URL or .env files, so it cannot reach the app's own
// database. The URL's credentials must be allowed to create and drop databases.
// When TEST_DATABASE_URL is not set the calling suite is skipped with DISPOSABLE_DB_SKIP_REASON,
// which the runner prints: a skipped database test is never reported as a pass.
import { Client, Pool } from "pg";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "";
export const DISPOSABLE_DB_SKIP_REASON =
  "TEST_DATABASE_URL not set: real-database checks NOT RUN (set it to a local PostgreSQL admin URL)";

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

function adminUrl(): URL {
  const url = new URL(TEST_DATABASE_URL);
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)) {
    throw new Error(`refusing TEST_DATABASE_URL host ${url.hostname}: disposable tests run against a local server only`);
  }
  return url;
}

export type DisposableDb = {
  name: string;
  /** Connection URL of this database (local only), e.g. to point the app's own db.ts at it. */
  url: string;
  /** Owner connection (bypasses row-level security, like a migration). */
  pool: Pool;
  /** Applies the named migration files (in order) to this database. */
  apply: (files: string[]) => Promise<void>;
  drop: () => Promise<void>;
};

/** Creates the database and applies every migration whose file name sorts before `stopBefore`
 * (all of them when omitted). */
export async function createDisposableDb(stopBefore?: string): Promise<DisposableDb> {
  const admin = adminUrl();
  const name = `ie_test_${randomBytes(5).toString("hex")}`;
  const adminClient = new Client({ connectionString: admin.toString() });
  await adminClient.connect();
  await adminClient.query(`create database ${name}`);
  await adminClient.end();

  const dbUrl = new URL(admin.toString());
  dbUrl.pathname = `/${name}`;
  const pool = new Pool({ connectionString: dbUrl.toString(), max: 4 });

  const apply = async (files: string[]) => {
    const client = await pool.connect();
    try {
      for (const file of files) {
        try {
          await client.query(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
        } catch (error) {
          throw new Error(`migration ${file} failed: ${(error as Error).message}`);
        }
      }
    } finally {
      client.release();
    }
  };

  await apply(migrationFiles().filter((f) => stopBefore === undefined || f < stopBefore));

  const drop = async () => {
    await pool.end();
    const c = new Client({ connectionString: admin.toString() });
    await c.connect();
    // Give other pools pointed at this database (e.g. the app's own db.ts in a test) a moment to
    // finish closing, so the forced drop does not kill a connection mid-shutdown and surface as
    // an unhandled error in the test run. Forced only for whatever is still open after that.
    for (let i = 0; i < 20; i++) {
      const open = await c.query("select count(*)::int as n from pg_stat_activity where datname = $1", [name]);
      if (open.rows[0].n === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await c.query(`drop database if exists ${name} with (force)`);
    await c.end();
  };
  return { name, url: dbUrl.toString(), pool, apply, drop };
}
