# Database roles: making tenant isolation apply to the app

Every tenant table has a row-level-security policy, but PostgreSQL skips those policies for the table owner, a superuser and any BYPASSRLS role. The app currently connects as `postgres`, which on Supabase has BYPASSRLS, so isolation rests on application code alone. `node scripts/check-tenant-isolation.mjs` reports this as NOT ENFORCED.

The fix is for the app to connect as its own role: it can log in, is not a superuser, has no BYPASSRLS, owns no tables, belongs to no role that could bypass the policies, and has read and write grants only on tables protected by row-level security. Migrations, backups and other admin work keep using the owner connection.

## One-time switch (about 10 minutes)

Run every command from the app folder. Commands are shown for PowerShell, using `npm.cmd`/`node` as on this machine.

1. **Keep the current connection as the admin connection.** In `.env.local`, add a line `DATABASE_ADMIN_URL=` holding the same value as your current `DATABASE_URL`. Leave `DATABASE_URL` as it is for now.
2. **Choose a password for the app role** (at least 16 characters, for example from a password manager) and set it for this shell only:
   `$env:APP_DB_PASSWORD="<the password>"`
   The scripts never print or store it.
3. **Check what will change.** This makes no changes:
   `node scripts/db/setup-app-role.mjs`
   It reports that the role `insights_app` does not exist yet (exit code 2).
4. **Create the role:**
   `node scripts/db/setup-app-role.mjs --apply`
   Expect "Role "insights_app" is ready". The role gets read and write grants on every table that has row-level security, plus default privileges, so tables added by later migrations are granted automatically. It gets no access to tables without row-level security (today only `tenants`, which the app never reads or writes).
   - If the role already exists and belongs to another role that owns app tables, is a superuser, has BYPASSRLS or CREATEROLE, or can read or write all data, the script refuses and changes nothing. A member can use that role's rights, either inherited or by `SET ROLE`, so isolation would not hold. The message shows the chain (for example `insights_app -> team -> postgres`) and the `REVOKE` to review. The script never changes memberships itself, because something else may rely on them.
5. **Point the app at the role.** In `.env.local`, change `DATABASE_URL` to the same connection with a different user and password:
   - Supabase pooler hosts (`*.pooler.supabase.com`) expect the user name as `insights_app.<project-ref>`, the same suffix your current `postgres.<project-ref>` user has. A direct connection uses plain `insights_app`. Check against the connection string Supabase shows for your project.
   - Use the password from step 2. Percent-encode any `@ : / ? #` characters in it.
6. **Verify:**
   `node scripts/check-tenant-isolation.mjs`
   Expect `VERDICT: ENFORCED`. Then restart `npm.cmd run dev` and open a project to confirm it loads as before.

**To undo:** put the old `DATABASE_URL` back and restart. The role can stay; it grants nothing to anyone else.

## After the switch

- **Migrations** keep running as the owner, as now. Rerunning `node scripts/db/setup-app-role.mjs --apply` after a migration is harmless, and it repairs grants if default privileges could not be set.
- **Backups:** `npm run backup` uses `DATABASE_ADMIN_URL` (else `DATABASE_URL`). Whichever it uses, it first checks that the connection can read every public table completely, and refuses otherwise, naming the tables. Setting `DATABASE_ADMIN_URL` to the app role is refused just like `DATABASE_URL` would be; it does not fall back to the other variable.
- **New tables:** a later migration's table is granted automatically. If it is created without row-level security, `node scripts/check-tenant-isolation.mjs` reports NOT ENFORCED and the setup report lists it; rerun `--apply` to remove the app role's access, or add a policy.
- **Local Docker development** (`npm run db:local`) still connects as the local superuser. Run the same steps against the local database if you want local runs to enforce isolation too.
- **Not covered by this change:**
  - Other roles' access to `tenants`. This setup only governs the app role. On Supabase, the API roles (`anon`, `authenticated`) normally receive grants on new public tables, and `tenants` has no row-level security, so check in the dashboard that the Data API cannot reach it (or that those grants are removed). This has not been tested here.
  - Authentication, and how a signed-in user maps to a tenant, is still the separate pre-release security gate.
