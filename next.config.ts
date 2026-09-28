import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Client reports and raw data tables are the whole point of this app,
      // so the default 1 MB Server Action limit is far too small.
      bodySizeLimit: "25mb",
    },
  },
};

export default nextConfig;
