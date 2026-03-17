import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  experimental: {
    optimizePackageImports: [
      "@anthropic-ai/sdk",
      "@supabase/supabase-js",
      "@tanstack/react-query",
      "streamdown",
    ],
  },
};

export default nextConfig;
