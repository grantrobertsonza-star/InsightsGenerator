// G6: keeps sessions alive and sends signed-out visitors to the sign-in page.
//
// This is a convenience layer, NOT the security boundary. It only looks at whether session cookies
// are present and refreshes an access token that is about to expire. Every page, server action
// and route handler still verifies the session with Supabase Auth and resolves the organisation
// itself (src/lib/requestContext.ts), so a request that slips past this proxy gains nothing.
//
// Refreshing here (rather than in a page) is deliberate: a server component cannot set cookies, so
// the renewed tokens are written to the response and also passed on in the request, which lets
// the page that follows see the new access token on this same request.
import { NextResponse, type NextRequest } from "next/server";
import {
  ACCESS_COOKIE,
  AuthRejectedError,
  REFRESH_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  cookiesMustBeSecure,
  decodeExpiry,
  refreshSession,
  sessionCookieOptions,
} from "@/lib/authSession";

// Refresh when the access token has less than this long left, so a page that makes several
// server calls does not see it expire halfway through.
const REFRESH_AHEAD_SECONDS = 120;

function signedOut(request: NextRequest): NextResponse {
  const isPageView = request.method === "GET" && !request.nextUrl.pathname.startsWith("/api/");
  const response = isPageView
    ? NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(request.nextUrl.pathname + request.nextUrl.search)}`, request.url))
    : NextResponse.json({ error: "You are not signed in. Sign in to continue." }, { status: 401 });
  response.cookies.delete(ACCESS_COOKIE);
  response.cookies.delete(REFRESH_COOKIE);
  return response;
}

export async function proxy(request: NextRequest) {
  const access = request.cookies.get(ACCESS_COOKIE)?.value;
  const refresh = request.cookies.get(REFRESH_COOKIE)?.value;
  if (!access && !refresh) return signedOut(request);

  const expiry = access ? decodeExpiry(access) : null;
  const needsRefresh = refresh && (!access || (expiry !== null && expiry - Date.now() / 1000 < REFRESH_AHEAD_SECONDS));
  if (!needsRefresh) return NextResponse.next();

  try {
    const tokens = await refreshSession(refresh);
    request.cookies.set(ACCESS_COOKIE, tokens.accessToken);
    request.cookies.set(REFRESH_COOKIE, tokens.refreshToken);
    const response = NextResponse.next({ request: { headers: request.headers } });
    const secure = cookiesMustBeSecure(request.url);
    const accessAge = tokens.expiresAt ? Math.max(60, tokens.expiresAt - Math.floor(Date.now() / 1000)) : 3600;
    response.cookies.set(ACCESS_COOKIE, tokens.accessToken, sessionCookieOptions(secure, accessAge));
    response.cookies.set(REFRESH_COOKIE, tokens.refreshToken, sessionCookieOptions(secure, SESSION_MAX_AGE_SECONDS));
    return response;
  } catch (error) {
    if (error instanceof AuthRejectedError) return signedOut(request);
    // Auth unreachable: let the request through unchanged. The page's own check then fails
    // visibly (requestContext reports the outage) instead of this proxy signing the user out.
    console.error("[proxy] session refresh failed:", error);
    return NextResponse.next();
  }
}

export const config = {
  // Everything except the sign-in page, Next's own assets and static files. The Python
  // conversion function (/api/parse-stats-file) is a separate deployment target with its own
  // signed-request check and never passes through Next.
  matcher: ["/((?!login|_next/static|_next/image|favicon\\.ico|api/parse-stats-file|.*\\.(?:png|jpg|jpeg|svg|ico|webp|woff2?)$).*)"],
};
