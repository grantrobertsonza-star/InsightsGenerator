# Public-release gate (IMP-001 / IMP-016)

Checks to run against the environment being released, before a second user or organisation uses it. Each check either reads only, or works inside a transaction it rolls back, and prints PASS, FAIL or COULD NOT CHECK. "Could not check" never counts as a pass.

Run them from the app folder on a machine that can reach the environment. The cloud workspace and the laptop's Linux shell cannot reach Supabase or a local Docker database.

| Gate | What it shows | Command | Pass |
|---|---|---|---|
| G1 Migrations | Every migration in `supabase/migrations` is applied to the target, judged from the schema | `node .fnd001/tools/compare-migrations.mjs` (local tool, not in git) | Every row reads "applied" for the target |
| G2 Database role | The app connects as a role that row-level security applies to (not an owner, superuser or BYPASSRLS role, and not able to act as one); no tenant-crossing grant on an unprotected table | `node scripts/check-tenant-isolation.mjs` with `DATABASE_URL` set to the URL the deployed app uses | Exit 0, "ENFORCED" |
| G3 Two-tenant matrix | Inside a rolled-back transaction, a tenant that owns nothing sees no rows of any tenant table | part of G2 | as G2 |
| G4 Storage privacy | The `documents` bucket is private; an object cannot be read through its public URL or with the publishable key; a signed link expires | `node scripts/release-gate/check-storage-privacy.mjs` (with `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY` for the target) | Exit 0, "ENFORCED" |
| G5 Backup and restore | A backup of the target restores into a local database | `npm run backup`, then `npm run restore -- backups/<folder>` (Docker) | Restore completes; G1 on the restored copy matches the target |
| G6 Deployed identity | Each request is tied to an authenticated person and their organisation | none: see below | Not available |

## G6: what is missing, not a check

The app has no sign-in. Every request runs as the single organisation in `DEFAULT_TENANT_ID`. Row-level security (G2, G3) stops one tenant's queries from reading another's rows. But nothing yet decides which tenant a request belongs to, because there is no user to decide it from. Before a second organisation uses the app, three things need building:

- authentication;
- a per-request tenant taken from the signed-in user;
- a check that every route and server action uses it.

Until then the release stays limited to one organisation. The gate is not passed by running anything.

## Order

1. G1, after migrations are applied.
2. G5, before any change to the target.
3. G2/G3, after `node scripts/db/setup-app-role.mjs --apply` (see `docs/database-roles.md`) and redeploying with the new role's `DATABASE_URL`.
4. G4.
5. G6, which needs a product decision and an implementation.

## Evidence so far

- The G2/G3 logic is proven on disposable PostgreSQL with a non-owner role: `src/lib/__tests__/tenantIsolation*.db.test.ts`.
- G4 is proven against a stand-in for the Storage API, including failing cases: `src/lib/__tests__/releaseGateStorage.test.ts`.
- None of these has run against a deployed environment from this workspace. That evidence has to come from the machine that can reach it.
