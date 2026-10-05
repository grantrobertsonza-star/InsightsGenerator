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
  },
};

export default nextConfig;
