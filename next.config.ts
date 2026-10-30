import type { NextConfig } from "next";

/**
 * SEC2 (audit S3-1): the origin of the Supabase project the browser may reach (storage links shown
 * in the source preview, and any direct storage request), from NEXT_PUBLIC_SUPABASE_URL. In the
 * browser suites this is the local storage stand-in. Missing or malformed: nothing is added, so
 * the policy falls back to this app's own origin only.
 */
function supabaseOrigin(): string | null {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

/**
 * The Content-Security-Policy for every page. It is written to keep the app working as it is today,
 * not to be the strictest possible policy; tightening script-src needs nonces (see the Next guide on
 * content security policy), which would make every page dynamic.
 *   default-src 'self'          anything not listed below loads only from this app's own origin.
 *   script-src                  Next's own scripts are same-origin, but it also inlines small boot
 *                               scripts (and public/home.html has one), hence 'unsafe-inline';
 *                               'unsafe-eval' only in development, where React's dev tooling needs it.
 *   style-src                   Tailwind's stylesheet is same-origin; React style attributes and
 *                               home.html's <style> block are inline.
 *   img-src                     charts are exported as data: and blob: images (chartImageExport.tsx).
 *   font-src                    next/font serves Geist from this origin; data: for inlined fonts.
 *   connect-src                 server actions and route handlers are same-origin (development's
 *                               hot-reload socket is same-origin too); Supabase for storage requests.
 *   frame-src                   the source preview shows a PDF from a Supabase signed link in an iframe.
 *   object-src 'none'           no plugins (<object>, <embed>).
 *   base-uri 'self'             an injected <base> cannot redirect relative links elsewhere.
 *   form-action 'self'          forms (server actions included) only post to this app.
 *   frame-ancestors 'none'      no other site may frame this app (clickjacking); X-Frame-Options
 *                               below says the same to older browsers.
 */
export function contentSecurityPolicy(): string {
  const dev = process.env.NODE_ENV === "development";
  const supabase = supabaseOrigin();
  const withSupabase = supabase ? ` ${supabase}` : "";
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${withSupabase}`,
    `frame-src 'self'${withSupabase}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/** The security headers sent with every response (SEC2, audit S3-1). */
export function securityHeaders(): { key: string; value: string }[] {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy() },
    // Older browsers that ignore frame-ancestors: never render this app inside a frame.
    { key: "X-Frame-Options", value: "DENY" },
    // Use the declared content type; never guess one (a downloaded CSV is not run as a script).
    { key: "X-Content-Type-Options", value: "nosniff" },
    // Other sites see only this app's origin, never a page path (paths carry project ids).
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    // HTTPS only for a year once a browser has seen this over HTTPS. Browsers ignore it over plain
    // http (local development, the browser suites), so it is sent everywhere. No includeSubDomains:
    // other services on sibling subdomains are not this app's to decide for.
    { key: "Strict-Transport-Security", value: "max-age=31536000" },
    // The app uses none of these browser features, so no page (or injected script) may ask for them.
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()" },
  ];
}

const nextConfig: NextConfig = {
  // SEC2: no "X-Powered-By: Next.js" header; it only tells an attacker what to look up.
  poweredByHeader: false,
  experimental: {
    serverActions: {
      // Client reports and raw data tables are the whole point of this app,
      // so the default 1 MB Server Action limit is far too small. Raised
      // again (from 25mb) once raw SPSS/Stata/SAS uploads started arriving:
      // a .sav file carries its full variable/value label dictionary plus
      // SPSS's own storage overhead, so it routinely runs larger than an
      // equivalent CSV of the same case-level data. This only governs the
      // local/dev request-body check -- a real Vercel deployment enforces
      // its own separate, lower platform limit on Serverless Function
      // request bodies (not configurable here), so a raw file anywhere
      // near this size will need a direct-to-storage upload path (bypassing
      // the Server Action entirely for the file bytes) before this import
      // flow can work in production, not just locally. See the engineering
      // brief's open items.
      bodySizeLimit: "100mb",
    },
    // G6: the sign-in proxy (src/proxy.ts) runs on every request, and Next buffers a request body
    // that passes through a proxy up to this size (default 10 MB), cutting longer bodies off. An
    // upload over 10 MB then failed with "Unexpected end of form". It must match bodySizeLimit
    // above, so the proxy never truncates an upload the action itself accepts. Cost: the body is
    // held in memory twice while the proxy runs.
    proxyClientMaxBodySize: "100mb",
    // Development only (Codex's diagnosis, docs/upload-120mb-diagnosis-2026-10-29.md): `next dev` keeps a cache of
    // server fetches across hot reloads, and builds each cache key from the whole request body, including the
    // storage upload of a data file. For a 60 MB file that took about 50 seconds and gigabytes of memory, during
    // which the storage service closed its idle connection; Next then sent the upload on that closed connection and
    // it failed with ECONNRESET. With the cache off the upload is sent at once. `next build`/`next start` never use
    // this cache, so production is unaffected. Cost: in development, server fetches (model calls included) are not
    // reused across hot reloads.
    serverComponentsHmrCache: false,
  },
  // The public landing page is a self-contained HTML file in public/ (inline styles and logo), served
  // at /home without the app shell. src/proxy.ts excludes /home and /home.html from the sign-in
  // redirect so a signed-out visitor can see it; its "Sign in" button links to "/".
  async rewrites() {
    return [{ source: "/home", destination: "/home.html" }];
  },
  // SEC2: every route, pages, route handlers, server actions and public files alike.
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders() }];
  },
};

export default nextConfig;
