"use server";

// G6: sign in, sign out and switch organisation. These are the only server actions that run
// without an established request context (signIn creates it), which is why
// requestTenantCoverage.test.ts lists them by name as its sole exemptions.
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  ACCESS_COOKIE,
  AuthRejectedError,
  ORGANISATION_COOKIE,
  REFRESH_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  cookiesMustBeSecure,
  sessionCookieOptions,
  signInWithPassword,
  signOutSession,
} from "./authSession";
import { loadMemberships, requireRequestContext } from "./requestContext";

export type SignInState = { error: string | null; email: string };

// A placeholder origin that no real request uses. The destination is resolved against it the way a
// browser would resolve it against this app, and anything that ends up anywhere else is refused.
const SAME_SITE_BASE = "http://same-site.invalid";

/**
 * Only a path on this app is followed after sign-in, never another host.
 *
 * Prefix checks alone are not enough: browsers drop tab and newline characters and read a backslash
 * as a slash, so "/\t/evil.example/" or "/\\evil.example" navigate to another host. Control
 * characters and backslashes are therefore refused outright, and what remains is parsed with the
 * same URL rules a browser applies; the result must stay on the placeholder origin. Only the
 * parsed path, query and fragment are returned, so the redirect is always relative.
 */
export async function safeNextPath(value: unknown): Promise<string> {
  const s = typeof value === "string" ? value : "";
  if (!s.startsWith("/") || s.length > 2048 || /[\u0000-\u001f\u007f\\]/.test(s)) return "/";
  let parsed: URL;
  try {
    parsed = new URL(s, SAME_SITE_BASE);
  } catch {
    return "/";
  }
  if (parsed.origin !== SAME_SITE_BASE) return "/";
  const local = parsed.pathname + parsed.search + parsed.hash;
  // Never back to the sign-in page itself (it would loop); "/login" and "/login/..." both count.
  if (local === "/login" || local.startsWith("/login/") || local.startsWith("/login?") || local.startsWith("/login#")) return "/";
  return local;
}

async function requestIsSecure(): Promise<boolean> {
  const h = await headers();
  const host = h.get("host") ?? "localhost";
  const proto = h.get("x-forwarded-proto") ?? (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host) ? "http" : "https");
  return cookiesMustBeSecure(`${proto}://${host}/`);
}

export async function signIn(_previous: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) return { error: "Enter your email address.", email };
  if (!password || password.length > 512) return { error: "Enter your password.", email };

  let tokens;
  try {
    tokens = await signInWithPassword(email, password);
  } catch (error) {
    if (error instanceof AuthRejectedError) return { error: "The email or password is not correct.", email };
    console.error("[signIn] sign-in service failed:", error);
    return { error: "Sign-in is unavailable right now, so you were not signed in. Try again shortly.", email };
  }

  let memberships;
  try {
    memberships = await loadMemberships(tokens.user.id);
  } catch (error) {
    console.error("[signIn] membership lookup failed:", error);
    return { error: "Your organisation could not be looked up, so you were not signed in. Try again shortly.", email };
  }

  const jar = await cookies();
  const secure = await requestIsSecure();
  const accessAge = tokens.expiresAt ? Math.max(60, tokens.expiresAt - Math.floor(Date.now() / 1000)) : 3600;
  jar.set(ACCESS_COOKIE, tokens.accessToken, sessionCookieOptions(secure, accessAge));
  jar.set(REFRESH_COOKIE, tokens.refreshToken, sessionCookieOptions(secure, SESSION_MAX_AGE_SECONDS));
  if (memberships.length === 0) redirect("/no-organisation");
  // Keep an earlier organisation choice only if this user belongs to it.
  const chosen = jar.get(ORGANISATION_COOKIE)?.value;
  if (!memberships.some((m) => m.tenantId === chosen)) jar.set(ORGANISATION_COOKIE, memberships[0].tenantId, sessionCookieOptions(secure, SESSION_MAX_AGE_SECONDS));
  redirect(await safeNextPath(formData.get("next")));
}

export async function signOut(): Promise<void> {
  const jar = await cookies();
  const access = jar.get(ACCESS_COOKIE)?.value;
  if (access) {
    // Revoking at Supabase is best effort: the cookies are cleared either way, so this browser is
    // signed out even if the revocation call fails (the token then lapses at its own expiry).
    await signOutSession(access).catch((error) => console.error("[signOut] revocation failed:", error));
  }
  jar.delete(ACCESS_COOKIE);
  jar.delete(REFRESH_COOKIE);
  redirect("/login");
}

export async function switchOrganisation(formData: FormData): Promise<void> {
  const context = await requireRequestContext();
  const tenantId = String(formData.get("tenantId") ?? "");
  if (!context.memberships.some((m) => m.tenantId === tenantId)) throw new Error("You are not a member of that organisation.");
  const jar = await cookies();
  jar.set(ORGANISATION_COOKIE, tenantId, sessionCookieOptions(await requestIsSecure(), SESSION_MAX_AGE_SECONDS));
  redirect("/");
}
