// Local, disposable stack for the browser smoke test (golden-thread hardening task D). App-owned
// setup: Codex's independent spec (e2e/golden-thread-smoke.spec.mjs) runs against what this starts.
//
//   node scripts/e2e/local-stack.mjs            starts everything, writes the target manifest, waits
//   (Ctrl+C stops the app and drops the database and role; --keep leaves them for inspection)
//
// What it starts, all on 127.0.0.1:
//   - a NEW database ie_e2e_<random> built from supabase/migrations on the LOCAL admin server in
//     E2E_ADMIN_DATABASE_URL (refused unless the host is localhost/127.0.0.1/::1), with one
//     synthetic tenant
//   - a NEW login role ie_e2e_app_<random>: not the table owner, NOSUPERUSER, NOBYPASSRLS, with only
//     table/sequence/function privileges, so row-level security applies to every app query
//   - a local stand-in for the Supabase Storage endpoints the app uses (upload, download, remove,
//     signed URLs), in memory only
//   - an explicit model REPLAY (scripts/e2e/model-replay.mjs) instead of the real model: no key, no
//     paid calls. Replay output is orchestration evidence only, never AI-quality evidence.
//   - the app itself (next dev) with every variable from .env* files overridden, so it cannot reach
//     the development or live database, storage or model
// The manifest (default e2e-results/target-manifest.json) holds no credentials.
import { spawn, spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import pg from "pg";
import { createModelReplay } from "./model-replay.mjs";

const ROOT = process.cwd();
const keep = process.argv.includes("--keep");
const admin = new URL(process.env.E2E_ADMIN_DATABASE_URL ?? process.env.TEST_DATABASE_URL ?? "");
if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(admin.hostname)) {
  throw new Error("E2E_ADMIN_DATABASE_URL must point at a LOCAL PostgreSQL admin connection (disposable target only).");
}
const appPort = Number(process.env.E2E_APP_PORT ?? 3210);
const outDir = path.resolve(process.env.E2E_OUT_DIR ?? "e2e-results");
mkdirSync(outDir, { recursive: true });

const id = randomBytes(5).toString("hex");
const dbName = `ie_e2e_${id}`;
const role = `ie_e2e_app_${id}`;
const rolePassword = randomBytes(18).toString("hex"); // in memory and the child's environment only
const tenantId = randomUUID();

async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url.toString() });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

// ---- database and role
await withClient(admin, (c) => c.query(`create database ${dbName}`));
const dbUrl = new URL(admin.toString());
dbUrl.pathname = `/${dbName}`;
const migrations = readdirSync(path.join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
await withClient(dbUrl, async (c) => {
  for (const f of migrations) {
    try {
      await c.query(readFileSync(path.join(ROOT, "supabase/migrations", f), "utf8"));
    } catch (error) {
      throw new Error(`migration ${f} failed: ${error.message}`);
    }
  }
  await c.query(`insert into tenants (id, name) values ($1, 'Synthetic e2e tenant')`, [tenantId]);
});
// Exercise the deployable setup contract, including withholding the unprotected tenant registry,
// rather than claiming compatibility from a similar hand-written set of grants.
const setupRole = spawnSync(process.execPath, [path.join(ROOT, "scripts/db/setup-app-role.mjs"), "--apply"], {
  cwd: ROOT,
  env: { ...process.env, DATABASE_ADMIN_URL: dbUrl.toString(), APP_DB_ROLE: role, APP_DB_PASSWORD: rolePassword },
  encoding: "utf8",
});
if (setupRole.status !== 0) throw new Error(`Disposable role setup failed: ${setupRole.stdout}${setupRole.stderr}`);
writeFileSync(path.join(outDir, "actual-role-setup.txt"), setupRole.stdout);
const roleFacts = await withClient(dbUrl, async (c) => {
  const r = (await c.query(`select rolsuper, rolbypassrls from pg_roles where rolname = $1`, [role])).rows[0];
  const owned = (await c.query(`select count(*)::int n from pg_tables where schemaname = 'public' and tableowner = $1`, [role])).rows[0].n;
  const grants = (
    await c.query(
      `select table_name, privilege_type from information_schema.role_table_grants where grantee = $1 order by table_name, privilege_type`,
      [role],
    )
  ).rows;
  return { superuser: r.rolsuper, bypassRls: r.rolbypassrls, ownsTables: owned > 0, grants };
});
if (roleFacts.superuser || roleFacts.bypassRls || roleFacts.ownsTables) throw new Error("application role is not a restricted non-owner role");
const grantsArtifact = path.join(outDir, "application-role-grants.json");
writeFileSync(grantsArtifact, JSON.stringify({ role, database: dbName, grants: roleFacts.grants }, null, 1));

// ---- storage stand-in (in memory)
const objects = new Map();
const signTokens = new Map();
const objectReads = new Map();
const storage = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const body = await new Promise((resolve) => {
    const chunks = [];
    req.on("data", (d) => chunks.push(d));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
  const send = (status, value, type = "application/json") => {
    res.writeHead(status, { "content-type": type });
    res.end(type === "application/json" ? JSON.stringify(value) : value);
  };
  const p = decodeURIComponent(url.pathname.replace(/^\/storage\/v1/, ""));
  const readFaultFile = path.join(outDir, "storage-fault.json");
  let m0;
  const fault = existsSync(readFaultFile) ? JSON.parse(readFileSync(readFaultFile, "utf8")) : {};
  if (req.method === "GET" && fault.get === true) {
    return send(503, { message: "Synthetic storage read outage" });
  }
  // Disposable fault fixture only: an object write whose connection drops, which the app's storage
  // client reports as "fetch failed" (the error seen in the IMP-017 v12 run). {"put":"drop"} drops
  // before storing; {"put":"drop-after-store"} stores the bytes and then drops, so the app never
  // learns the write landed.
  if ((req.method === "POST" || req.method === "PUT") && (fault.put === "drop" || fault.put === "drop-after-store") && (m0 = /^\/object\/(?!sign\/)(.+)$/.exec(p))) {
    if (fault.put === "drop-after-store") objects.set(m0[1], { bytes: body, type: req.headers["content-type"] ?? "application/octet-stream" });
    req.socket.destroy();
    return;
  }
  // Disposable inspection only: every stored object key, so a check can prove no orphan remains.
  if (req.method === "GET" && url.pathname === "/__inventory") {
    return send(200, [...objects.keys()].sort());
  }
  // Disposable inspection only: how many times each object's bytes were served (direct or signed
  // download), so a check can see every read of a stored file, whatever the server mode logs.
  if (req.method === "GET" && url.pathname === "/__reads") {
    return send(200, Object.fromEntries([...objectReads].sort()));
  }
  let m;
  if (req.method === "POST" && (m = /^\/object\/sign\/(.+)$/.exec(p))) {
    const token = randomBytes(8).toString("hex");
    signTokens.set(token, m[1]);
    return send(200, { signedURL: `/object/sign/${m[1]}?token=${token}` });
  }
  if (req.method === "GET" && (m = /^\/object\/sign\/(.+)$/.exec(p))) {
    const key = signTokens.get(url.searchParams.get("token"));
    const obj = key && objects.get(key);
    if (obj) objectReads.set(key, (objectReads.get(key) ?? 0) + 1);
    return obj ? send(200, obj.bytes, obj.type) : send(404, { message: "not found" });
  }
  if ((req.method === "POST" || req.method === "PUT") && (m = /^\/object\/(.+)$/.exec(p))) {
    objects.set(m[1], { bytes: body, type: req.headers["content-type"] ?? "application/octet-stream" });
    return send(200, { Key: m[1], Id: randomUUID() });
  }
  if (req.method === "GET" && (m = /^\/object\/(?:authenticated\/)?(.+)$/.exec(p))) {
    const obj = objects.get(m[1]);
    if (obj) objectReads.set(m[1], (objectReads.get(m[1]) ?? 0) + 1);
    return obj ? send(200, obj.bytes, obj.type) : send(404, { message: "not found", statusCode: "404" });
  }
  if (req.method === "DELETE" && (m = /^\/object\/([^/]+)$/.exec(p))) {
    // Disposable fault fixture only: exercise native cleanup recovery without changing app code.
    const faultFile = path.join(outDir, "storage-fault.json");
    if (existsSync(faultFile) && JSON.parse(readFileSync(faultFile, "utf8")).remove === true) {
      return send(503, { message: "Synthetic storage removal outage" });
    }
    const prefixes = JSON.parse(body.toString() || "{}").prefixes ?? [];
    for (const key of prefixes) objects.delete(`${m[1]}/${key}`);
    return send(200, prefixes.map((name) => ({ name })));
  }
  return send(404, { message: `storage stand-in: unsupported ${req.method} ${p}` });
});
// E2E_STORAGE_PORT fixes the stand-in's port, needed with E2E_NEXT_START because NEXT_PUBLIC_*
// values (the storage URL) are inlined into a production build.
await new Promise((r) => storage.listen(Number(process.env.E2E_STORAGE_PORT ?? 0), "127.0.0.1", r));
const storageUrl = `http://127.0.0.1:${storage.address().port}`;

// ---- model replay
const replay = createModelReplay(path.join(outDir, "model-fixture.json"));
await new Promise((r) => replay.server.listen(0, "127.0.0.1", r));
const gateway = process.env.E2E_MODEL_GATEWAY;
if (gateway && gateway !== "http://127.0.0.1:55017") throw new Error("Only the authorised loopback budget gateway is supported for real-model verification.");
const modelUrl = gateway ?? `http://127.0.0.1:${replay.server.address().port}`;

// ---- the app, with every .env* variable overridden
const appDbUrl = new URL(dbUrl.toString());
appDbUrl.username = role;
appDbUrl.password = rolePassword;
const env = {
  ...process.env,
  DATABASE_URL: appDbUrl.toString(),
  DEFAULT_TENANT_ID: tenantId,
  NEXT_PUBLIC_SUPABASE_URL: storageUrl,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "local-stand-in",
  SUPABASE_SECRET_KEY: "local-stand-in",
  ANTHROPIC_API_KEY: gateway ? "local-gateway-only-synthetic-placeholder" : "replay-no-key",
  ANTHROPIC_BASE_URL: modelUrl,
  DB_POOL_MAX: "4",
  NEXT_TELEMETRY_DISABLED: "1",
};
for (const file of readdirSync(ROOT).filter((f) => /^\.env/.test(f))) {
  for (const line of readFileSync(path.join(ROOT, file), "utf8").split(/\r?\n/)) {
    const name = /^\s*([A-Z0-9_]+)\s*=/.exec(line)?.[1];
    if (name && !(name in env && env[name] !== process.env[name])) {
      throw new Error(`${file} defines ${name}, which this stack does not override; refusing to start the app with it.`);
    }
  }
}
// E2E_NEXT_START=<dir>: serve an existing production build (`next build --webpack` already run in
// <dir>) with `next start`, instead of `next dev` in this checkout. Used to measure production
// memory and behaviour; the same disposable database, role, storage stand-in and model replay apply.
const startDir = process.env.E2E_NEXT_START ? path.resolve(process.env.E2E_NEXT_START) : null;
const appDir = startDir ?? ROOT;
const nextArgs = startDir ? ["start"] : ["dev", ...(process.env.E2E_WEBPACK === "1" ? ["--webpack"] : [])];
const app = spawn(process.execPath, [path.join(appDir, "node_modules/next/dist/bin/next"), ...nextArgs, "-p", String(appPort), "-H", "127.0.0.1"], {
  cwd: appDir,
  env,
  stdio: ["ignore", "pipe", "pipe"],
});
const appLog = path.join(outDir, "app.log");
writeFileSync(appLog, "");
for (const s of [app.stdout, app.stderr]) s.on("data", (d) => writeFileSync(appLog, d, { flag: "a" }));
const appUrl = `http://127.0.0.1:${appPort}`;
for (let i = 0; ; i++) {
  if (app.exitCode !== null) throw new Error(`the app exited (${app.exitCode}); see ${appLog}`);
  try {
    const r = await fetch(appUrl);
    if (r.status < 500) break;
  } catch {}
  if (i > 240) throw new Error(`the app did not start; see ${appLog}`);
  await new Promise((r) => setTimeout(r, 1000));
}

const manifestPath = path.resolve(process.env.E2E_MANIFEST ?? path.join(outDir, "target-manifest.json"));
const dbNoCreds = new URL(dbUrl.toString());
dbNoCreds.username = "";
dbNoCreds.password = "";
writeFileSync(
  manifestPath,
  JSON.stringify(
    {
      appUrl,
      databaseUrlWithoutCredentials: dbNoCreds.toString(),
      disposable: true,
      syntheticOnly: true,
      applicationRole: { name: role, owner: false, superuser: roleFacts.superuser, bypassRls: roleFacts.bypassRls },
      grantsArtifact,
      modelMode: gateway ? "real-model" : "explicit-replay",
      modelReplayLog: path.join(outDir, "model-replay-log.json"),
      // Disposable storage stand-in: its object inventory and the fault file its handlers read.
      storageInventoryUrl: `${storageUrl}/__inventory`,
      storageReadsUrl: `${storageUrl}/__reads`,
      storageFaultFile: path.join(outDir, "storage-fault.json"),
      tenantId,
      startedAt: new Date().toISOString(),
    },
    null,
    1,
  ),
);
console.log(`ready: ${appUrl}\nmanifest: ${manifestPath}\nstop with Ctrl+C${keep ? " (--keep: database and role are left in place)" : ""}`);

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  writeFileSync(path.join(outDir, "model-replay-log.json"), JSON.stringify(replay.log, null, 1));
  app.kill("SIGTERM");
  storage.close();
  replay.server.close();
  if (!keep) {
    await new Promise((r) => setTimeout(r, 1500));
    await withClient(admin, async (c) => {
      await c.query(`drop database if exists ${dbName} with (force)`);
      await c.query(`drop role if exists ${role}`);
    }).catch((e) => console.error(`cleanup failed: ${e.message} (database ${dbName}, role ${role})`));
  }
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
if (existsSync(path.join(outDir, ".stop"))) await stop();
