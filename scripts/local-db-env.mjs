// Points `npm run dev` at the local Docker database.
//
//   npx supabase start      (once; leave Docker running)
//   npm run db:local        (writes .env.development.local from the running stack)
//
// Next.js reads .env.development.local before .env.local when running
// `next dev`, so your cloud settings in .env.local stay as they are and
// `npm run build` / `npm start` still use the cloud project. Delete
// .env.development.local to point dev back at the cloud database.
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

let raw;
try {
  raw = execSync("npx supabase status -o env", { encoding: "utf8" });
} catch (error) {
  console.error(
    "Could not read the local stack. Is Docker running, and did you run `npx supabase start`?\n",
    error.message,
  );
  process.exit(1);
}

const env = {};
for (const line of raw.split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)="?(.*?)"?$/.exec(line.trim());
  if (m) env[m[1]] = m[2];
}

const secret = env.SECRET_KEY || env.SERVICE_ROLE_KEY;
const publishable = env.PUBLISHABLE_KEY || env.ANON_KEY;
if (!env.API_URL || !env.DB_URL || !secret) {
  console.error("Unexpected output from `supabase status`:\n", raw);
  process.exit(1);
}

const out = [
  "# Written by `npm run db:local`. Delete this file to use the cloud database again.",
  `NEXT_PUBLIC_SUPABASE_URL=${env.API_URL}`,
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${publishable ?? ""}`,
  `SUPABASE_SECRET_KEY=${secret}`,
  `DATABASE_URL=${env.DB_URL}`,
  "DEFAULT_TENANT_ID=00000000-0000-4000-8000-000000000001",
  "DB_POOL_MAX=30",
  "",
].join("\n");
writeFileSync(".env.development.local", out);
console.log("Wrote .env.development.local. Restart `npm run dev` to use the local database.");
