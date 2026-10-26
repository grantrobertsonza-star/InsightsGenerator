// G6: the Supabase Auth client's failure semantics and the small rules around sessions.
// fetch is stubbed (the external boundary); the functions under test are the real ones.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AuthRejectedError,
  AuthUnavailableError,
  cookiesMustBeSecure,
  decodeExpiry,
  refreshSession,
  signInWithPassword,
  userForAccessToken,
} from "../authSession";
import { chooseMembership } from "../requestContext";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const USER = { id: "10000000-0000-4000-8000-0000000000a1", email: "a@example.test" };
afterEach(() => vi.unstubAllGlobals());
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://auth.invalid/";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "pk";

const jwt = (exp: number) => `x.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.y`;

describe("authSession", () => {
  it("sends the publishable key, never a secret, and returns tokens with the user", async () => {
    const seen: Record<string, string>[] = [];
    vi.stubGlobal("fetch", async (_u: string, init: RequestInit) => {
      seen.push(init.headers as Record<string, string>);
      return Response.json({ access_token: jwt(2_000_000_000), refresh_token: "r", expires_in: 3600, user: USER });
    });
    const t = await signInWithPassword("a@example.test", "pw");
    expect(t.user).toEqual(USER);
    expect(seen[0].apikey).toBe("pk");
    expect(seen[0].authorization).toBeUndefined();
  });

  it("maps Auth refusals to AuthRejectedError and outages to AuthUnavailableError", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ error: "invalid_grant" }, { status: 400 }));
    await expect(signInWithPassword("a@example.test", "bad")).rejects.toBeInstanceOf(AuthRejectedError);
    vi.stubGlobal("fetch", async () => Response.json({}, { status: 401 }));
    await expect(userForAccessToken("t")).rejects.toBeInstanceOf(AuthRejectedError);
    vi.stubGlobal("fetch", async () => new Response("down", { status: 503 }));
    await expect(refreshSession("r")).rejects.toBeInstanceOf(AuthUnavailableError);
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    await expect(userForAccessToken("t")).rejects.toBeInstanceOf(AuthUnavailableError);
  });

  it("refuses a user answer without a valid id rather than inventing one", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ email: "a@example.test" }));
    await expect(userForAccessToken("t")).rejects.toBeInstanceOf(AuthUnavailableError);
  });

  it("reads the token expiry only as a hint, and tolerates junk", () => {
    expect(decodeExpiry(jwt(1234))).toBe(1234);
    expect(decodeExpiry("not-a-jwt")).toBeNull();
    expect(decodeExpiry("a.@@@.b")).toBeNull();
  });

  it("allows non-secure cookies only on plain-http loopback hosts", () => {
    expect(cookiesMustBeSecure("http://127.0.0.1:3000/x")).toBe(false);
    expect(cookiesMustBeSecure("http://localhost/x")).toBe(false);
    expect(cookiesMustBeSecure("http://insights.example.com/x")).toBe(true);
    expect(cookiesMustBeSecure("https://localhost/x")).toBe(true);
  });

  it("chooses the requested organisation only when the user belongs to it", () => {
    const ms = [
      { tenantId: "t1", organisationName: "One", role: "owner" as const },
      { tenantId: "t2", organisationName: "Two", role: "member" as const },
    ];
    expect(chooseMembership(ms, "t2")?.tenantId).toBe("t2");
    expect(chooseMembership(ms, "someone-else")?.tenantId).toBe("t1");
    expect(chooseMembership([], "t1")).toBeNull();
  });
});
