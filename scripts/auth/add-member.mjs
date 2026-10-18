// G6: an administrator adds a person to an organisation. There is no self sign-up in the app.
//
//   node scripts/auth/add-member.mjs <email> [--tenant <tenant id>] [--role owner|member] [--create-tenant "<name>"]
//
// What it does, in order:
//   1. Finds the Supabase Auth user with that email, or creates one with a generated temporary
//      password (Auth admin API, SUPABASE_SECRET_KEY). The temporary password is printed ONCE so
//      you can pass it on; it is not written anywhere. Re-running for an existing user changes
//      nothing about their password.
//   2. Adds the membership row in tenant_memberships with the OWNER/admin database connection
//      (DATABASE_ADMIN_URL). The app's own role cannot create memberships.
// --tenant defaults to DEFAULT_TENANT_ID from the environment or .env files, which is the
// organisation every existing project belongs to, so the first user you add sees today's data.
// --create-tenant "<name>" creates a new organisation instead and prints its id.
//
// Environment (shell first, else the app folder's .env files):
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY   the Supabase project the app signs in against
//   DATABASE_ADMIN_URL                               owner/admin connection to the app database
// Exit code: 0 done, 1 error. Nothing is changed when an argument is invalid.
import { randomBytes } from "node:crypto";
import pg from "pg";

const args = process.argv.slice(2);
const email = (args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1]?.startsWith("--") !== true) ?? "").toLowerCase();
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
if (!process.env.DATABASE_ADMIN_URL || !process.env.SUPABASE_SECRET_KEY) {
  const mod = await import("@next/env");
  (mod.loadEnvConfig ?? mod.default?.loadEnvConfig)(process.cwd(), true);
}
const role = opt("--role") ?? "member";
const createTenant = opt("--create-tenant");
let tenantId = opt("--tenant") ?? (createTenant ? undefined : process.env.DEFAULT_TENANT_ID);
const fail = (m) => {
  console.error(m);
  process.exit(1);
};
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("Usage: node scripts/auth/add-member.mjs <email> [--tenant <id> | --create-tenant \"<name>\"] [--role owner|member]");
if (!["owner", "member"].includes(role)) fail("--role must be owner or member.");
if (tenantId && !/^[0-9a-f-]{36}$/i.test(tenantId)) fail("--tenant must be a tenant id (uuid).");
if (!tenantId && !createTenant) fail("No organisation: pass --tenant <id>, set DEFAULT_TENANT_ID, or use --create-tenant \"<name>\".");
const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
const secret = process.env.SUPABASE_SECRET_KEY;
const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!base || !secret) fail("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set.");
if (!adminUrl) fail("DATABASE_ADMIN_URL must be set to the owner/admin database connection (see docs/database-roles.md).");

const authHeaders = { apikey: secret, authorization: `Bearer ${secret}`, "content-type": "application/json" };

async function findUser() {
  // The admin list endpoint pages; a small project fits in a few pages.
  for (let page = 1; page <= 50; page++) {
    const r = await fetch(`${base}/auth/v1/admin/users?page=${page}&per_page=200`, { headers: authHeaders });
    if (r.status === 404) return null; // stand-in without listing
    if (!r.ok) fail(`Listing Auth users failed (${r.status}).`);
    const body = await r.json();
    const users = body.users ?? [];
    const hit = users.find((u) => (u.email ?? "").toLowerCase() === email);
    if (hit) return hit;
    if (users.length < 200) return null;
  }
  return null;
}

let user = await findUser();
let tempPassword = null;
if (!user) {
  tempPassword = randomBytes(12).toString("base64url");
  const r = await fetch(`${base}/auth/v1/admin/users`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ email, password: tempPassword, email_confirm: true }),
  });
  if (!r.ok) fail(`Creating the Auth user failed (${r.status}): ${(await r.text()).slice(0, 200)}`);
  user = await r.json();
}

const client = new pg.Client({ connectionString: adminUrl });
await client.connect();
try {
  await client.query("begin");
  if (createTenant) {
    tenantId = (await client.query(`insert into tenants (name) values ($1) returning id`, [createTenant])).rows[0].id;
  } else if ((await client.query(`select 1 from tenants where id = $1`, [tenantId])).rowCount !== 1) {
    throw new Error(`No organisation with id ${tenantId}.`);
  }
  await client.query(
    `insert into tenant_memberships (user_id, tenant_id, role) values ($1, $2, $3)
     on conflict (user_id, tenant_id) do update set role = excluded.role`,
    [user.id, tenantId, role],
  );
  await client.query("commit");
} catch (error) {
  await client.query("rollback");
  fail(`No change made: ${error.message}`);
} finally {
  await client.end();
}
console.log(`${email} is a ${role} of organisation ${tenantId}.`);
if (tempPassword) console.log(`New account created. Temporary password (shown once, not stored): ${tempPassword}`);
