// Backs up the database and the uploaded files into a dated folder.
//
//   npm run backup              backs up the CLOUD project (reads .env.local)
//   npm run backup -- --local   backs up the local Docker database instead
//
// Needs Docker running (the Supabase CLI runs pg_dump inside a container).
// Output: backups/<date>/ with schema.sql, data.sql, files/ and manifest.json.
// The backups folder holds client data. It is git-ignored: never commit it.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, existsSync, writeFileSync, statSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

const BUCKET = "documents";
const local = process.argv.includes("--local");

export function loadEnv(file) {
  if (!existsSync(file)) throw new Error(`${file} not found.`);
  const env = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

function run(args) {
  const r = spawnSync("npx", args, {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (r.status !== 0) throw new Error(`npx ${args.join(" ")} failed.`);
}

async function listAll(storage, prefix = "") {
  const out = [];
  const { data, error } = await storage.list(prefix, { limit: 1000 });
  if (error) throw error;
  for (const item of data ?? []) {
    const full = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.id === null) out.push(...(await listAll(storage, full)));
    else out.push(full);
  }
  return out;
}

async function main() {
  const env = loadEnv(local ? ".env.development.local" : ".env.local");
  const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16);
  const dir = path.join("backups", `${local ? "local-" : ""}${stamp}`);
  mkdirSync(path.join(dir, "files"), { recursive: true });
  console.log(`Backing up ${local ? "the LOCAL" : "the CLOUD"} project to ${dir}`);

  const target = local ? ["--local"] : ["--db-url", `"${env.DATABASE_URL}"`];
  run(["supabase", "db", "dump", ...target, "-f", path.join(dir, "schema.sql")]);
  run(["supabase", "db", "dump", ...target, "--data-only", "--use-copy", "-f", path.join(dir, "data.sql")]);

  // Row counts per table, so a restore can prove it got everything back.
  const client = new pg.Client({ connectionString: env.DATABASE_URL });
  await client.connect();
  const tables = (
    await client.query(
      "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1",
    )
  ).rows.map((r) => r.table_name);
  const counts = {};
  for (const t of tables) {
    counts[t] = Number((await client.query(`select count(*) from public."${t}"`)).rows[0].count);
  }
  await client.end();

  // Uploaded files.
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false },
  });
  const storage = supabase.storage.from(BUCKET);
  const objects = await listAll(storage);
  let bytes = 0;
  for (const p of objects) {
    const { data, error } = await storage.download(p);
    if (error) throw new Error(`Could not download ${p}: ${error.message}`);
    const buf = Buffer.from(await data.arrayBuffer());
    const dest = path.join(dir, "files", ...p.split("/"));
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, buf);
    bytes += buf.length;
  }

  writeFileSync(
    path.join(dir, "manifest.json"),
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        source: local ? "local" : "cloud",
        bucket: BUCKET,
        rowCounts: counts,
        fileCount: objects.length,
        fileBytes: bytes,
        dataSqlBytes: statSync(path.join(dir, "data.sql")).size,
      },
      null,
      2,
    ),
  );
  const rows = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(`Done: ${tables.length} tables, ${rows} rows, ${objects.length} files (${(bytes / 1048576).toFixed(1)} MB).`);
  console.log(`Test it: npm run restore -- ${dir}`);
}

main().catch((e) => {
  console.error("Backup failed:", e.message ?? e);
  process.exit(1);
});
