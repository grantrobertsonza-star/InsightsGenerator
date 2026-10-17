// A throwaway database for `next build` (static generation reads the schema), on a LOCAL server.
//   node scripts/e2e/prepare-build-db.mjs <admin URL> <name>          create <name> and apply supabase/migrations
//   node scripts/e2e/prepare-build-db.mjs <admin URL> <name> --drop   remove it again
// Refuses any host but localhost/127.0.0.1/::1 and any name not starting ie_test_build. Nothing else
// on the server is touched.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const [adminUrl, name, flag] = process.argv.slice(2);
if (!adminUrl || !name) throw new Error("usage: prepare-build-db.mjs <admin URL> <ie_test_build...> [--drop]");
const admin = new URL(adminUrl);
if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(admin.hostname)) throw new Error("The admin URL must point at a LOCAL PostgreSQL server.");
if (!/^ie_test_build[a-z0-9_]*$/.test(name)) throw new Error("The database name must start with ie_test_build (lowercase letters, digits, underscore).");

const server = new pg.Client({ connectionString: adminUrl });
await server.connect();
await server.query(`drop database if exists ${name}`);
if (flag === "--drop") {
  await server.end();
  console.log(`dropped ${name}`);
  process.exit(0);
}
await server.query(`create database ${name}`);
await server.end();
const target = new URL(adminUrl);
target.pathname = `/${name}`;
const db = new pg.Client({ connectionString: target.toString() });
await db.connect();
const dir = path.resolve("supabase/migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
for (const f of files) {
  try {
    await db.query(readFileSync(path.join(dir, f), "utf8"));
  } catch (error) {
    console.error(`FAILED at ${f}: ${error instanceof Error ? error.message : String(error)}`);
    await db.end();
    process.exit(1);
  }
}
await db.end();
console.log(`created ${name} with ${files.length} migrations`);
