// SEC2 (audit S3-1): the security headers next.config.ts sends with every response.
//
// This reads the real config (next.config.ts) and asks it for its headers, as Next does at start,
// and matches the rule's source pattern with Next's own path matcher. It does not start a server;
// the browser suites (e2e/ui) run the whole app with these headers, so a policy that blocked a
// script, style, image or frame the app needs would show there as a failing screen.
import { afterEach, describe, expect, it, vi } from "vitest";
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";

async function loadConfig() {
  vi.resetModules();
  return (await import("../../../next.config")).default;
}
async function headersFor(env: { NODE_ENV?: string; NEXT_PUBLIC_SUPABASE_URL?: string }) {
  vi.stubEnv("NODE_ENV", env.NODE_ENV ?? "production");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", env.NEXT_PUBLIC_SUPABASE_URL ?? "");
  const config = await loadConfig();
  const rules = await config.headers!();
  expect(rules).toHaveLength(1);
  return { rule: rules[0], byKey: Object.fromEntries(rules[0].headers.map((h) => [h.key, h.value])) as Record<string, string> };
}
const directives = (csp: string) => Object.fromEntries(csp.split(";").map((d) => d.trim().split(/\s+/)).map(([name, ...values]) => [name, values]));

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("SEC2 security headers (next.config.ts)", () => {
  it("applies one header rule to every path, including the root, route handlers and public files", async () => {
    const { rule } = await headersFor({});
    const match = getPathMatch(rule.source, { strict: true, removeUnnamedParams: true, regexModifier: (r) => r });
    for (const path of ["/", "/runs/1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed", "/api/runs/x/findings/export", "/home", "/home.html", "/login"]) {
      expect(match(path), path).not.toBe(false);
    }
  });

  it("sends the agreed policy and the other security headers", async () => {
    const { byKey } = await headersFor({ NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co/some/path" });
    const csp = directives(byKey["Content-Security-Policy"]);
    expect(csp).toEqual({
      "default-src": ["'self'"],
      "script-src": ["'self'", "'unsafe-inline'"],
      "style-src": ["'self'", "'unsafe-inline'"],
      "img-src": ["'self'", "data:", "blob:"],
      "font-src": ["'self'", "data:"],
      "connect-src": ["'self'", "https://abc.supabase.co"],
      "frame-src": ["'self'", "https://abc.supabase.co"],
      "object-src": ["'none'"],
      "base-uri": ["'self'"],
      "form-action": ["'self'"],
      "frame-ancestors": ["'none'"],
    });
    expect(byKey["X-Frame-Options"]).toBe("DENY");
    expect(byKey["X-Content-Type-Options"]).toBe("nosniff");
    expect(byKey["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(byKey["Strict-Transport-Security"]).toMatch(/^max-age=\d{8,}$/);
    expect(byKey["Permissions-Policy"]).toContain("camera=()");
    expect(byKey["Permissions-Policy"]).toContain("microphone=()");
    expect(byKey["Permissions-Policy"]).toContain("geolocation=()");
  });

  it("allows eval only in development", async () => {
    expect(directives((await headersFor({ NODE_ENV: "development" })).byKey["Content-Security-Policy"])["script-src"]).toContain("'unsafe-eval'");
    expect(directives((await headersFor({ NODE_ENV: "production" })).byKey["Content-Security-Policy"])["script-src"]).not.toContain("'unsafe-eval'");
    expect(directives((await headersFor({ NODE_ENV: "test" })).byKey["Content-Security-Policy"])["script-src"]).not.toContain("'unsafe-eval'");
  });

  it("adds no outside origin when the Supabase URL is missing or malformed (the local stand-in is used as given)", async () => {
    for (const value of ["", "not a url"]) {
      const csp = directives((await headersFor({ NEXT_PUBLIC_SUPABASE_URL: value })).byKey["Content-Security-Policy"]);
      expect(csp["connect-src"]).toEqual(["'self'"]);
      expect(csp["frame-src"]).toEqual(["'self'"]);
    }
    const local = directives((await headersFor({ NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" })).byKey["Content-Security-Policy"]);
    expect(local["connect-src"]).toEqual(["'self'", "http://127.0.0.1:54321"]);
  });

  it("keeps the existing settings: no X-Powered-By, the upload limits, the /home rewrite", async () => {
    const config = await loadConfig();
    expect(config.poweredByHeader).toBe(false);
    expect(config.experimental).toEqual({
      serverActions: { bodySizeLimit: "100mb" },
      proxyClientMaxBodySize: "100mb",
      serverComponentsHmrCache: false,
    });
    expect(await config.rewrites!()).toEqual([{ source: "/home", destination: "/home.html" }]);
  });
});
