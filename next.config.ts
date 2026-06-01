import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    /**
     * Browser-side CORS bypass: route all provider calls through same-origin.
     *
     * Usage:
     * - /api/proxy/deepseek/v1/...  -> https://api.deepseek.com/v1/...（客户端路径须含 v1）
     * - /api/proxy/openai/v1/...    -> https://api.openai.com/v1/...
     * - /api/proxy/anthropic/v1/... -> https://api.anthropic.com/v1/...
     * - /api/proxy/google/v1beta/...-> https://generativelanguage.googleapis.com/v1beta/...
     * - /api/proxy/tavily/...       -> https://api.tavily.com/...
     * - /api/proxy/serper/...       -> https://google.serper.dev/...
     */
    return [
      {
        source: "/api/proxy/deepseek/:path*",
        destination: "https://api.deepseek.com/:path*",
      },
      {
        source: "/api/proxy/openai/:path*",
        destination: "https://api.openai.com/:path*",
      },
      {
        source: "/api/proxy/anthropic/:path*",
        destination: "https://api.anthropic.com/:path*",
      },
      {
        source: "/api/proxy/google/:path*",
        destination: "https://generativelanguage.googleapis.com/:path*",
      },
      {
        source: "/api/proxy/tavily/:path*",
        destination: "https://api.tavily.com/:path*",
      },
      {
        source: "/api/proxy/serper/:path*",
        destination: "https://google.serper.dev/:path*",
      },
    ];
  },
};

export default nextConfig;
