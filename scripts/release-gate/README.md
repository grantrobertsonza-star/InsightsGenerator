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
| G6 Deployed identity | Each request is tied to a signed-in person and the organisation they belong to | `src/lib/__tests__/requestTenantCoverage.test.ts` (every entry point) and `signedInTenantAccess.db.test.ts` (behaviour); on the target, the manual check below | All three pass |

## G6: sign-in and organisations

Implemented 2026-10-18 (see `docs/sign-in-and-organisations.md`). Every page, server action and route handler takes its tenant from the signed-in Supabase user and their row in `tenant_memberships` (migration 0104), never from `DEFAULT_TENANT_ID`. A source scan fails the test suite if any entry point skips that. What the local evidence does not show: that the deployed Supabase project, its cookies over HTTPS and its Auth settings behave the same. On the target, after migrations 0104 and 0105 are applied and at least one member is added:

1. Signed out, open the app: it goes to the sign-in page; `/api/runs` answers 401.
2. Sign in as a member of organisation A: only A's projects are listed.
3. Sign in (another browser) as a member of organisation B only: A's project URL answers 404 and its exports return nothing from it.
4. An account with no membership sees only "No organisation yet".

## Order

1. G1, after migrations are applied.
2. G5, before any change to the target.
3. G2/G3, after `node scripts/db/setup-app-role.mjs --apply` (see `docs/database-roles.md`) and redeploying with the new role's `DATABASE_URL`.
4. G4.
5. G6, the manual sign-in check above.

## Evidence so far

- The G2/G3 logic is proven on disposable PostgreSQL with a non-owner role: `src/lib/__tests__/tenantIsolation*.db.test.ts`.
- G4 is proven against a stand-in for the Storage API, including failing cases: `src/lib/__tests__/releaseGateStorage.test.ts`.
- None of these has run against a deployed environment from this workspace. That evidence has to come from the machine that can reach it.
