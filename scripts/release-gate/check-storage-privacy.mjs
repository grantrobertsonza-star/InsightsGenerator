// Release gate (IMP-001 / IMP-016): are uploaded files private in the deployed Supabase Storage?
// READ-ONLY for stored data. Run from the app folder against the environment being released:
//
//   node scripts/release-gate/check-storage-privacy.mjs [--path <object path>] [--no-sign]
//
// Environment (the shell, else the app folder's .env files, as `next dev` reads them):
//   NEXT_PUBLIC_SUPABASE_URL              the project URL
//   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY  the public (anon) key the browser bundle carries
//   SUPABASE_SECRET_KEY                   the server key (used only for the bucket read and signing)
//   DATABASE_URL                          only to pick one real object path when --path is not given
// Keys are sent as request headers only; nothing here prints, logs or writes them.
//
// Checks, each PASS / FAIL / COULD NOT CHECK:
//   1. the `documents` bucket is not public (bucket read with the server key)
//   2. a stored object cannot be read through the public URL, with no credentials
//   3. the same object cannot be read with only the publishable (anon) key, the key any visitor has
//   4. a signed link works when fresh and is refused after it expires (2 s), unless --no-sign.
//      Signing creates a token, not stored data. --no-sign records the expiry check as SKIPPED,
//      so the summary cannot read ENFORCED without it.
// How an answer is read (classifyRead below; Codex formal verdict 2026-10-18 found the earlier
// version treated every non-200 as a refusal):
//   - any 2xx, including 206 partial content, means bytes were served: FAIL
//   - 400, 401, 403 and 404 are Supabase Storage's refusals (an unknown object and an object the
//     key may not read look alike by design), and count as refused only because the server key
//     has just read the same object; for the expired link, 400/401/403 only (a 404 there could
//     mean the object vanished, which says nothing about expiry)
//   - anything else (no answer, a redirect, 408, 429, 5xx, an unexpected status) proves nothing
//     about authorization: COULD NOT CHECK, never PASS
// Exit code: 0 all pass, 2 any fail, 1 could not check or skipped (nothing failed).
import pg from "pg";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  try {
    const mod = await import("@next/env");
    (mod.loadEnvConfig ?? mod.default?.loadEnvConfig)(process.cwd(), true);
  } catch {
    /* reported below as missing variables */
  }
}
const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const secret = process.env.SUPABASE_SECRET_KEY ?? "";
const BUCKET = "documents";
const results = [];
const record = (name, status, detail) => {
  results.push({ name, status, detail });
  console.log(`${status.padEnd(15)} ${name}${detail ? `: ${detail}` : ""}`);
};
const authHeaders = (key) => (key ? { apikey: key, Authorization: `Bearer ${key}` } : {});

async function get(url, headers = {}) {
  try {
    const r = await fetch(url, { headers, redirect: "manual" });
    return { status: r.status, body: await r.text().catch(() => "") };
  } catch (error) {
    return { status: 0, body: error instanceof Error ? error.message : String(error) };
  }
}

/** PASS / FAIL / COULD NOT CHECK for a read that should have been refused. */
function classifyRead(status, refusals) {
  if (status >= 200 && status < 300) return "FAIL";
  if (refusals.includes(status)) return "PASS";
  return "COULD NOT CHECK";
}
const OBJECT_REFUSALS = [400, 401, 403, 404];
const EXPIRY_REFUSALS = [400, 401, 403];
const answered = (r) => (r.status ? `answered ${r.status}` : `no answer (${r.body})`);

if (!base || !anon || !secret) {
  console.error("NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY must be set (shell or .env files).");
  process.exit(1);
}

// 1. Bucket visibility.
{
  const r = await get(`${base}/storage/v1/bucket/${BUCKET}`, authHeaders(secret));
  if (r.status !== 200) record("bucket is private", "COULD NOT CHECK", `bucket read answered ${r.status || r.body}`);
  else {
    let pub = null;
    try {
      pub = JSON.parse(r.body).public;
    } catch {
      /* unreadable */
    }
    if (pub === false) record("bucket is private", "PASS");
    else if (pub === true) record("bucket is private", "FAIL", `the "${BUCKET}" bucket is public: anyone with a path can read files`);
    else record("bucket is private", "COULD NOT CHECK", "the bucket answer did not say");
  }
}

// One real object to probe.
let objectPath = option("--path");
if (!objectPath && process.env.DATABASE_URL) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    await client.query("begin read only");
    objectPath = (await client.query("select storage_path from documents where storage_path is not null order by uploaded_at desc limit 1")).rows[0]?.storage_path;
    await client.query("rollback");
  } catch (error) {
    console.log(`(could not pick an object from the database: ${error instanceof Error ? error.message : String(error)})`);
  } finally {
    await client.end().catch(() => {});
  }
}
if (!objectPath) {
  record("object reads", "COULD NOT CHECK", "no object path (pass --path, or set DATABASE_URL to a database with an uploaded document)");
} else {
  const encoded = objectPath.split("/").map(encodeURIComponent).join("/");
  // The object must exist for a refusal to mean anything: confirm with the server key first.
  const owner = await get(`${base}/storage/v1/object/authenticated/${BUCKET}/${encoded}`, authHeaders(secret));
  if (owner.status !== 200) {
    record("object reads", "COULD NOT CHECK", `the server key could not read the sample object (${owner.status || owner.body}), so a refusal would prove nothing`);
  } else {
    const pub = await get(`${base}/storage/v1/object/public/${BUCKET}/${encoded}`);
    record("no read through the public URL", classifyRead(pub.status, OBJECT_REFUSALS), answered(pub));
    const viaAnon = await get(`${base}/storage/v1/object/authenticated/${BUCKET}/${encoded}`, authHeaders(anon));
    record("no read with the publishable key", classifyRead(viaAnon.status, OBJECT_REFUSALS), answered(viaAnon));
    if (flag("--no-sign")) {
      record("signed link expires", "SKIPPED", "--no-sign: expiry was not checked");
    } else {
      let signed = null;
      try {
        const r = await fetch(`${base}/storage/v1/object/sign/${BUCKET}/${encoded}`, {
          method: "POST",
          headers: { ...authHeaders(secret), "content-type": "application/json" },
          body: JSON.stringify({ expiresIn: 2 }),
        });
        const json = await r.json().catch(() => ({}));
        signed = json.signedURL ?? json.signedUrl ?? null;
      } catch {
        signed = null;
      }
      if (!signed) record("signed link expires", "COULD NOT CHECK", "could not create a signed link");
      else {
        const link = signed.startsWith("http") ? signed : `${base}/storage/v1${signed.startsWith("/") ? "" : "/"}${signed}`;
        const fresh = await get(link);
        await new Promise((r) => setTimeout(r, 4000));
        const stale = await get(link);
        if (fresh.status !== 200) record("signed link expires", "COULD NOT CHECK", `a fresh signed link ${answered(fresh)}, so a later refusal would prove nothing`);
        else record("signed link expires", classifyRead(stale.status, EXPIRY_REFUSALS), `fresh 200, after expiry ${answered(stale)}`);
      }
    }
  }
}

const failed = results.some((r) => r.status === "FAIL");
const unknown = results.some((r) => r.status === "COULD NOT CHECK" || r.status === "SKIPPED");
console.log(failed ? "STORAGE PRIVACY: NOT ENFORCED" : unknown ? "STORAGE PRIVACY: NOT FULLY CHECKED" : "STORAGE PRIVACY: ENFORCED");
// exitCode rather than process.exit(): exiting while fetch sockets are still closing aborted the
// process on Windows (Codex, 2026-10-18: exit 3221226505 instead of 1), losing the real result.
process.exitCode = failed ? 2 : unknown ? 1 : 0;
