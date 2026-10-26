// G6: the session layer between the browser and Supabase Auth (email and password).
//
// The browser holds two httpOnly cookies set by the sign-in action: the Supabase access token
// and its refresh token. Nothing on the client can read them, and the publishable key is the only
// key sent to Supabase Auth from here (the secret key is never used for a user's session).
//
// Trust boundary: a request's user is whatever Supabase Auth says the access token belongs to
// (GET /auth/v1/user). The token is never trusted from its own contents, so a forged or revoked
// token fails there. decodeExpiry() reads the unverified expiry ONLY to decide when the proxy
// should refresh ahead of time; it is never used to accept a request.
//
// This module uses fetch directly rather than a client library so the same five endpoints can be
// served by the disposable stand-in in scripts/e2e/local-stack.mjs, with no hidden calls.

export const ACCESS_COOKIE = "ie-access";
export const REFRESH_COOKIE = "ie-refresh";
export const ORGANISATION_COOKIE = "ie-organisation";

// Supabase refresh tokens are long-lived; the cookie lives as long as the app wants a session to
// last without a sign-in. The access token cookie follows the token's own expiry.
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 14;

export type AuthUser = { id: string; email: string | null };
export type AuthTokens = { accessToken: string; refreshToken: string; expiresAt: number | null; user: AuthUser };

/** Supabase Auth refused the credentials or token (wrong password, expired or revoked token). */
export class AuthRejectedError extends Error {}
/** Supabase Auth could not be reached or answered unexpectedly. Never treated as "signed out". */
export class AuthUnavailableError extends Error {}

function authBase(): { url: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new AuthUnavailableError("Sign-in is not configured: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be set.");
  return { url: url.replace(/\/+$/, ""), key };
}

async function authFetch(path: string, init: RequestInit & { bearer?: string }): Promise<Response> {
  const { url, key } = authBase();
  const headers: Record<string, string> = { apikey: key, "content-type": "application/json" };
  if (init.bearer) headers.authorization = `Bearer ${init.bearer}`;
  try {
    return await fetch(`${url}/auth/v1${path}`, { ...init, headers, cache: "no-store" });
  } catch (error) {
    throw new AuthUnavailableError(`The sign-in service could not be reached (${error instanceof Error ? error.message : String(error)}).`);
  }
}

function toUser(value: unknown): AuthUser {
  const v = value as { id?: unknown; email?: unknown } | null;
  if (!v || typeof v.id !== "string" || !/^[0-9a-f-]{36}$/i.test(v.id)) throw new AuthUnavailableError("The sign-in service returned a user without a valid id.");
  return { id: v.id.toLowerCase(), email: typeof v.email === "string" ? v.email : null };
}

function toTokens(body: unknown): AuthTokens {
  const b = body as { access_token?: unknown; refresh_token?: unknown; expires_at?: unknown; expires_in?: unknown; user?: unknown };
  if (typeof b?.access_token !== "string" || typeof b?.refresh_token !== "string") {
    throw new AuthUnavailableError("The sign-in service returned no session.");
  }
  const expiresAt =
    typeof b.expires_at === "number" ? b.expires_at : typeof b.expires_in === "number" ? Math.floor(Date.now() / 1000) + b.expires_in : decodeExpiry(b.access_token);
  return { accessToken: b.access_token, refreshToken: b.refresh_token, expiresAt, user: toUser(b.user) };
}

async function rejectOrFail(response: Response, what: string): Promise<never> {
  // 400/401/403/422 are Supabase Auth's answers for bad credentials and bad or expired tokens.
  if ([400, 401, 403, 422].includes(response.status)) throw new AuthRejectedError(what);
  throw new AuthUnavailableError(`The sign-in service failed (${response.status}).`);
}

export async function signInWithPassword(email: string, password: string): Promise<AuthTokens> {
  const r = await authFetch("/token?grant_type=password", { method: "POST", body: JSON.stringify({ email, password }) });
  if (!r.ok) return rejectOrFail(r, "The email or password is not correct.");
  return toTokens(await r.json());
}

export async function refreshSession(refreshToken: string): Promise<AuthTokens> {
  const r = await authFetch("/token?grant_type=refresh_token", { method: "POST", body: JSON.stringify({ refresh_token: refreshToken }) });
  if (!r.ok) return rejectOrFail(r, "The session has ended.");
  return toTokens(await r.json());
}

/** The user Supabase Auth says this access token belongs to. */
export async function userForAccessToken(accessToken: string): Promise<AuthUser> {
  const r = await authFetch("/user", { method: "GET", bearer: accessToken });
  if (!r.ok) return rejectOrFail(r, "The session has ended.");
  return toUser(await r.json());
}

/** Revokes the session at Supabase Auth. A failure is reported; the caller still clears cookies. */
export async function signOutSession(accessToken: string): Promise<void> {
  const r = await authFetch("/logout?scope=local", { method: "POST", bearer: accessToken });
  if (!r.ok && r.status !== 401 && r.status !== 403) throw new AuthUnavailableError(`Sign-out could not be confirmed (${r.status}).`);
}

/** The access token's `exp` claim, UNVERIFIED: only for deciding when to refresh. */
export function decodeExpiry(token: string): number | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const json = JSON.parse(Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as { exp?: unknown };
    return typeof json.exp === "number" ? json.exp : null;
  } catch {
    return null;
  }
}

/** Cookie attributes for the session cookies: httpOnly, same-site, secure outside plain-http local hosts. */
export function sessionCookieOptions(secure: boolean, maxAge: number) {
  return { httpOnly: true, sameSite: "lax" as const, secure, path: "/", maxAge };
}

/** Plain http is allowed only on a loopback host (local development and the disposable stack). */
export function cookiesMustBeSecure(requestUrl: string): boolean {
  const u = new URL(requestUrl);
  return !(u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname));
}
