import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
};

export default nextConfig;
