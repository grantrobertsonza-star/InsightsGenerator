// Restores a backup into the LOCAL Docker database, then checks the row
// counts and file count against the backup's manifest. It never touches the
// cloud project: restoring into production is a deliberate manual step.
//
//   npm run restore -- backups/2026-10-07-08-00
//
// WARNING: this empties the local database first (the local copy only).
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

const dir = process.argv[2];
if (!dir || !existsSync(path.join(dir, "manifest.json"))) {
  console.error("Usage: npm run restore -- backups/<folder>");
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8"));
const BUCKET = manifest.bucket ?? "documents";

function sh(cmd, args, input) {
  const r = spawnSync(cmd, args, {
    input,
    stdio: input ? ["pipe", "inherit", "inherit"] : "inherit",
    shell: process.platform === "win32",
  });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed.`);
}

function localEnv() {
  const r = spawnSync("npx", ["supabase", "status", "-o", "env"], {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (r.status !== 0) throw new Error("Local stack not running. Run `npm run db:start` first.");
  const env = {};
  for (const line of r.stdout.split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)="?(.*?)"?$/.exec(line.trim());
    if (m) env[m[1]] = m[2];
  }
  return env;
}

function walk(root, rel = "") {
  const out = [];
  for (const name of readdirSync(path.join(root, rel))) {
    const r = rel ? `${rel}/${name}` : name;
    if (statSync(path.join(root, r)).isDirectory()) out.push(...walk(root, r));
    else out.push(r);
  }
  return out;
}

async function main() {
  const env = localEnv();
  const projectId = /project_id\s*=\s*"([^"]+)"/.exec(readFileSync("supabase/config.toml", "utf8"))[1];
  const container = `supabase_db_${projectId}`;

  console.log("1/4 Rebuilding the local schema from the migrations...");
  sh("npx", ["supabase", "db", "reset"]);

  console.log("2/4 Loading the data...");
  const wipe = `do $$ declare t text; begin for t in select tablename from pg_tables where schemaname='public' loop execute 'truncate table public.' || quote_ident(t) || ' cascade'; end loop; end $$;`;
  sh("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"], wipe);
  sh(
    "docker",
    ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"],
    readFileSync(path.join(dir, "data.sql")),
  );

  console.log("3/4 Putting the uploaded files back...");
  const supabase = createClient(env.API_URL, env.SECRET_KEY || env.SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  await supabase.storage.createBucket(BUCKET, { public: false }).catch(() => {});
  const files = walk(path.join(dir, "files"));
  for (const f of files) {
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(f, readFileSync(path.join(dir, "files", ...f.split("/"))), { upsert: true });
    if (error) throw new Error(`Could not upload ${f}: ${error.message}`);
  }

  console.log("4/4 Checking the result against the backup...");
  const client = new pg.Client({ connectionString: env.DB_URL });
  await client.connect();
  let bad = 0;
  for (const [t, want] of Object.entries(manifest.rowCounts)) {
    const got = Number((await client.query(`select count(*) from public."${t}"`)).rows[0].count);
    if (got !== want) {
      bad++;
      console.error(`  MISMATCH ${t}: backup has ${want}, restored ${got}`);
    }
  }
  await client.end();
  if (files.length !== manifest.fileCount) {
    bad++;
    console.error(`  MISMATCH files: backup has ${manifest.fileCount}, restored ${files.length}`);
  }
  if (bad) {
    console.error(`Restore finished with ${bad} mismatch(es). Do not trust this backup yet.`);
    process.exit(1);
  }
  console.log(`Restore verified: every table row count and all ${files.length} files match.`);
}

main().catch((e) => {
  console.error("Restore failed:", e.message ?? e);
  process.exit(1);
});
