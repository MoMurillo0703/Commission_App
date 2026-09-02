import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["postgres", "@electric-sql/pglite"],
  agentRules: false,
};

export default nextConfig;
