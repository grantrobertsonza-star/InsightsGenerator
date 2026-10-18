# Sign-in and organisations (G6)

Implemented 2026-10-18 at Grant's instruction: email and password through Supabase Auth, with memberships assigned by an administrator. There is no self sign-up.

## What changed

- **Who you are.** The sign-in page (`/login`) checks the email and password with Supabase Auth. The session is two httpOnly cookies (access and refresh token). `src/proxy.ts` refreshes the access token shortly before it expires and sends signed-out visitors to the sign-in page. That is convenience only: every request is checked again on the server.
- **Which organisation.** `src/lib/requestContext.ts` asks Supabase Auth who the access token belongs to, then reads that user's rows in `tenant_memberships` (migration 0104). Row-level security limits the read to the user's own rows, and the application role cannot create or change memberships. A user in several organisations can switch in the account panel at the foot of the left rail; a choice naming an organisation they do not belong to is ignored.
- **Every entry point.** All pages, server actions and route handlers now call `requireTenantId` / `requireRequestContext` / `routeRequestContext`. No application code reads `DEFAULT_TENANT_ID` any more. `src/lib/__tests__/requestTenantCoverage.test.ts` scans the source and fails if a new entry point skips the check.
- **Failure behaviour.** Without a session, pages go to sign-in and routes answer 401. A signed-in account without an organisation sees only "No organisation yet" and routes answer 403. If Supabase Auth cannot be reached, the page shows an error and routes answer 503; an outage is never treated as being signed out, and there is no fallback organisation.
- **Conversion function (IMP-001).** The Python function no longer receives the shared secret. Each request is signed (HMAC-SHA256) for one action, bucket and tenant/run/file path, valid for five minutes, so a captured request cannot be replayed later or pointed at another file. `PARSE_STATS_SHARED_SECRET` must still hold the same value in both environments.
- **Uploads over 10 MB.** Next buffers request bodies that pass through the proxy; `proxyClientMaxBodySize` is set to the same 100 MB as the upload limit so uploads are not cut off.

## Setting it up

Apply migrations **0104** and **0105** (0105 is the Research Quality Review tables) to the database the app uses.

Then add yourself, which also keeps every existing project visible to you (they belong to `DEFAULT_TENANT_ID`):

```powershell
$env:DATABASE_ADMIN_URL = "<owner/admin connection to the app database>"
node scripts/auth/add-member.mjs you@example.com --role owner
```

The script creates the Supabase Auth user if needed and prints a temporary password once. It reads `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SECRET_KEY` from `.env.local`. For local development these point at your local Supabase (port 54321), which includes Auth; for the cloud project, run it with the cloud values. To add someone to a new organisation instead: `--create-tenant "Their organisation"`.

Supabase Auth settings to check on the cloud project: email sign-ups disabled (so nobody can create an account outside the script), and the site URL set to the deployed address.

## Evidence (this workspace)

- `requestTenantCoverage.test.ts`: every exported server action (over 100), inline server action, route handler and data page resolves the request context; no source reads `DEFAULT_TENANT_ID`.
- `signedInTenantAccess.db.test.ts` (real PostgreSQL, non-owner role, actual actions and routes): no session, forged token, Auth outage, no membership, forged organisation cookie, cross-organisation finding change, cross-organisation run id, tenantId in a request body, and membership write attempts.
- `authSession.test.ts`, `safeNextPath.test.ts`, `parseRequestSignature.test.ts` (TypeScript signer against the actual Python verifier).
- Browser: `e2e/ui/sign-in-access.check.mjs` on a production build with the stack's Auth stand-in (signed-out redirect, wrong and right password, other-organisation 404, no-organisation page, sign-out, outage), plus the full existing browser suite now running signed in.

Not shown here: the deployed Supabase project's own behaviour (the manual G6 check in `scripts/release-gate/README.md`), and human-edit provenance elsewhere in the app, which still records a time but not the person. Research Quality Review entries do record the signed-in person.
