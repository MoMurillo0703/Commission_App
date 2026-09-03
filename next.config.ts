import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["postgres", "@electric-sql/pglite", "unpdf"],
  agentRules: false,
};

export default nextConfig;
