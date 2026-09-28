import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || "",
  experimental: { cpus: 1 },
  // LLM/search proxy: use Route Handler at src/app/api/proxy/[provider]/[...path]/route.ts
  // (auth + rate limit). Do not re-add transparent rewrites here.
};

export default nextConfig;
