// G6: who is making this request, and which organisation (tenant) it acts for.
//
// This replaces the DEFAULT_TENANT_ID environment variable as the source of a request's tenant. Every page,
// server action and route handler calls requireTenantId() (or routeRequestContext() in a route
// handler) instead; src/lib/__tests__/requestTenantCoverage.test.ts fails if one does not.
//
// How the tenant is decided, per request:
//   1. The access-token cookie is checked with Supabase Auth (authSession.userForAccessToken).
//      A missing, expired or revoked token means "not signed in". An unreachable Auth service is
//      a visible error, never "signed out" and never a fallback organisation; that includes a
//      session whose access token lapsed and could not be renewed during the outage.
//   2. The user's memberships are read from tenant_memberships under app.current_user_id, which
//      row-level security restricts to that user's own rows.
//   3. The organisation cookie picks one of those memberships when the user has several. A cookie
//      naming an organisation the user does not belong to is ignored, not honoured; without a valid
//      choice the earliest membership is used.
// A user with no membership is signed in but has no organisation, and is refused everything.
//
// The result is cached for the request (React cache), so one request makes one Auth call and one
// membership read however many loaders ask.
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { pool } from "./db";
import { ACCESS_COOKIE, AuthRejectedError, AuthUnavailableError, ORGANISATION_COOKIE, REFRESH_COOKIE, userForAccessToken } from "./authSession";

export type Membership = { tenantId: string; organisationName: string; role: "owner" | "member" };
export type RequestContext = {
  userId: string;
  email: string | null;
  tenantId: string;
  organisationName: string;
  role: "owner" | "member";
  memberships: Membership[];
};

export class NotSignedInError extends Error {
  constructor() {
    super("You are not signed in. Sign in to continue.");
  }
}
export class NoOrganisationError extends Error {
  constructor() {
    super("Your account is not a member of any organisation yet. Ask an administrator to add you.");
  }
}

/** The memberships Supabase user `userId` holds, read under row-level security keyed on that user. */
export async function loadMemberships(userId: string): Promise<Membership[]> {
  const client = await pool.connect();
  try {
    await client.query("begin read only");
    await client.query("select set_config('app.current_user_id', $1, true)", [userId]);
    const rows = (await client.query(`select tenant_id, tenant_name, member_role from app_user_memberships()`)).rows as {
      tenant_id: string;
      tenant_name: string | null;
      member_role: "owner" | "member";
    }[];
    await client.query("commit");
    return rows.map((r) => ({ tenantId: r.tenant_id, organisationName: r.tenant_name ?? "Unnamed organisation", role: r.member_role }));
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** Picks the organisation for this request: the requested one if the user belongs to it, else the first. */
export function chooseMembership(memberships: Membership[], requested: string | undefined): Membership | null {
  if (memberships.length === 0) return null;
  return memberships.find((m) => m.tenantId === requested) ?? memberships[0];
}

const loadRequestContext = cache(async (): Promise<RequestContext> => {
  const jar = await cookies();
  const accessToken = jar.get(ACCESS_COOKIE)?.value;
  if (!accessToken) {
    // A refresh token without an access token means the session needed renewing and src/proxy.ts
    // could not renew it: a rejected refresh never gets this far (the proxy signs the visitor out
    // there), so what is left is an Auth service that did not answer. That is an outage, not a
    // sign-out: answer "unavailable" and keep the cookies, so the same request succeeds once Auth
    // is back. Without either cookie the visitor simply is not signed in.
    if (jar.get(REFRESH_COOKIE)?.value) throw new AuthUnavailableError("The session could not be renewed because sign-in is unavailable.");
    throw new NotSignedInError();
  }
  let user;
  try {
    user = await userForAccessToken(accessToken);
  } catch (error) {
    if (error instanceof AuthRejectedError) throw new NotSignedInError();
    throw error;
  }
  const memberships = await loadMemberships(user.id);
  const chosen = chooseMembership(memberships, jar.get(ORGANISATION_COOKIE)?.value);
  if (!chosen) throw new NoOrganisationError();
  return { userId: user.id, email: user.email, tenantId: chosen.tenantId, organisationName: chosen.organisationName, role: chosen.role, memberships };
});

/**
 * For pages and server actions: the signed-in user's context. Sends a request with no valid
 * session to the sign-in page and a user without an organisation to the explanation page; both
 * are navigations, so nothing after this line runs for them.
 */
export async function requireRequestContext(): Promise<RequestContext> {
  try {
    return await loadRequestContext();
  } catch (error) {
    if (error instanceof NotSignedInError) redirect("/login");
    if (error instanceof NoOrganisationError) redirect("/no-organisation");
    throw error;
  }
}

/** For pages and server actions: the tenant this request acts for. */
export async function requireTenantId(): Promise<string> {
  return (await requireRequestContext()).tenantId;
}

/** The signed-in context, or null when there is no valid session. Other failures still throw. */
export async function optionalRequestContext(): Promise<RequestContext | null> {
  try {
    return await loadRequestContext();
  } catch (error) {
    if (error instanceof NotSignedInError || error instanceof NoOrganisationError) return null;
    throw error;
  }
}

/**
 * For route handlers (downloads and JSON endpoints), which answer with a status instead of
 * navigating: 401 without a session, 403 without an organisation, 503 when sign-in cannot be
 * checked. The caller returns the Response as-is.
 */
export async function routeRequestContext(): Promise<RequestContext | Response> {
  try {
    return await loadRequestContext();
  } catch (error) {
    const status = error instanceof NotSignedInError ? 401 : error instanceof NoOrganisationError ? 403 : 503;
    const message =
      status === 503 ? "Sign-in could not be checked right now, so nothing was returned. Try again shortly." : (error as Error).message;
    if (status === 503) console.error("[requestContext] sign-in check failed:", error);
    return Response.json({ error: message }, { status });
  }
}

/** True when run `runId` exists and belongs to tenant `tenantId` (row-level security also applies). */
export async function runBelongsToTenant(tenantId: string, runId: string): Promise<boolean> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(runId)) return false;
  const client = await pool.connect();
  try {
    await client.query("begin read only");
    await client.query("select set_config('app.current_tenant_id', $1, true)", [tenantId]);
    // A project's bin (migration 0115, documentBin.ts) is a run too, but never a project anyone opens.
    // Read through to_jsonb so this works before the column exists.
    const found = (await client.query(`select 1 from runs where id = $1 and tenant_id = $2 and (to_jsonb(runs)->>'bin_of') is null`, [runId, tenantId])).rowCount === 1;
    await client.query("commit");
    return found;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
