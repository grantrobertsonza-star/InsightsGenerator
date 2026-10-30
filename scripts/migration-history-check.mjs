// Read-only check of the Supabase migration history against the database (2026-10-23).
//
// Why: some migrations were applied outside the Supabase CLI (apply_pending_migrations.mjs and by
// hand), so the CLI's record (supabase_migrations.schema_migrations) is behind the database and
// `supabase migration up` tries to replay old migrations. Replaying them is wrong: 0062, for one,
// sets an older list of allowed finding types and is refused by today's data.
//
// What it does: for every migration file the record does not list, it looks in the database for the
// objects the file creates (tables, columns, indexes, constraints, policies, functions, triggers)
// and reports, per file, whether all, some or none of them exist. It writes nothing: the session is
// read only. It prints, but does not run, the `supabase migration repair` command for the files
// whose objects all exist; a person decides whether to run it.
//
// Limits: a file that only changes data, or only drops or replaces things, has nothing to look for
// and is reported as "nothing to check"; its state must be judged by reading it. An object a later
// migration dropped or renamed shows as missing for the earlier file even though it ran.
//
//   node scripts/migration-history-check.mjs            (uses DATABASE_URL or .env.local)
import pg from "pg";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  if (existsSync(".env.local")) {
    for (const raw of readFileSync(".env.local", "utf8").split("\n")) {
      const m = raw.replace(/\r$/, "").match(/^DATABASE_URL=(.*)$/);
      if (m) return m[1].replace(/^"|"$/g, "");
    }
  }
  throw new Error("DATABASE_URL is not set and not in .env.local.");
}

const strip = (sql) => sql.replace(/--[^\n]*/g, "").replace(/\s+/g, " ");
const ident = String.raw`(?:public\.)?"?([A-Za-z_][A-Za-z0-9_]*)"?`;

/** The objects a migration file creates, as [kind, name, table?]. */
export function objectsCreated(sql) {
  const s = strip(sql);
  const out = [];
  for (const m of s.matchAll(new RegExp(String.raw`create table (?:if not exists )?${ident}`, "gi"))) out.push(["table", m[1]]);
  for (const m of s.matchAll(new RegExp(String.raw`alter table (?:if exists )?(?:only )?${ident}([^;]*)`, "gi"))) {
    const table = m[1];
    for (const c of m[2].matchAll(new RegExp(String.raw`add column (?:if not exists )?${ident}`, "gi"))) out.push(["column", c[1], table]);
    for (const c of m[2].matchAll(new RegExp(String.raw`add constraint ${ident}`, "gi"))) out.push(["constraint", c[1], table]);
  }
  for (const m of s.matchAll(new RegExp(String.raw`create (?:unique )?index (?:concurrently )?(?:if not exists )?${ident}`, "gi"))) out.push(["index", m[1]]);
  for (const m of s.matchAll(new RegExp(String.raw`create policy ${ident} on ${ident}`, "gi"))) out.push(["policy", m[1], m[2]]);
  for (const m of s.matchAll(new RegExp(String.raw`create (?:or replace )?function ${ident}`, "gi"))) out.push(["function", m[1]]);
  for (const m of s.matchAll(new RegExp(String.raw`create (?:or replace )?trigger ${ident}`, "gi"))) out.push(["trigger", m[1]]);
  const seen = new Set();
  return out.filter((o) => {
    const k = o.join("|").toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const EXISTS = {
  table: "select 1 from pg_tables where schemaname = 'public' and tablename = $1",
  column: "select 1 from information_schema.columns where table_schema = 'public' and column_name = $1 and table_name = $2",
  constraint: "select 1 from pg_constraint c join pg_class t on t.oid = c.conrelid where c.conname = $1 and t.relname = $2",
  index: "select 1 from pg_indexes where schemaname = 'public' and indexname = $1",
  policy: "select 1 from pg_policies where policyname = $1 and tablename = $2",
  function: "select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1",
  trigger: "select 1 from pg_trigger where tgname = $1 and not tgisinternal",
};

async function main() {
  const dir = path.resolve("supabase/migrations");
  const files = readdirSync(dir).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    await client.query("begin transaction read only");
    let recorded = new Set();
    // Read under a savepoint: when the record is missing, the failed query is rolled back to it so
    // the read-only transaction can carry on with the object checks (Codex B8-F02).
    await client.query("savepoint read_record");
    try {
      recorded = new Set((await client.query("select version from supabase_migrations.schema_migrations")).rows.map((r) => String(r.version)));
      await client.query("release savepoint read_record");
    } catch (e) {
      await client.query("rollback to savepoint read_record");
      console.log(`The migration record could not be read (${e.message}); every file is treated as unrecorded.`);
    }
    const repair = [];
    const report = [];
    for (const file of files) {
      const version = file.split("_")[0];
      if (recorded.has(version)) continue;
      const objects = objectsCreated(readFileSync(path.join(dir, file), "utf8"));
      if (objects.length === 0) {
        report.push(`${file}: not recorded; nothing to check (read the file to judge it)`);
        continue;
      }
      const missing = [];
      for (const [kind, name, table] of objects) {
        const r = await client.query(EXISTS[kind], table ? [name, table] : [name]);
        if (r.rowCount === 0) missing.push(`${kind} ${table ? `${table}.` : ""}${name}`);
      }
      if (missing.length === 0) {
        report.push(`${file}: not recorded; all ${objects.length} objects it creates exist`);
        repair.push(version);
      } else if (missing.length === objects.length) {
        report.push(`${file}: not recorded; none of its ${objects.length} objects exist (not applied?)`);
      } else {
        report.push(`${file}: not recorded; ${objects.length - missing.length} of ${objects.length} objects exist; missing: ${missing.join(", ")}`);
      }
    }
    await client.query("rollback");
    console.log(`${files.length} migration files; ${recorded.size} recorded by the Supabase CLI.`);
    console.log(report.length ? report.join("\n") : "Every migration file is recorded.");
    if (repair.length) {
      console.log("\nFor the files whose objects all exist, this would mark them applied (it changes only the record, not the schema). Not run:");
      console.log(`npx.cmd supabase migration repair --status applied ${repair.join(" ")}`);
    }
  } finally {
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("migration-history-check.mjs")) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
