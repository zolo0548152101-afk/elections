import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next 16 blocks dev assets when the browser host is 127.0.0.1.
  allowedDevOrigins: ["127.0.0.1"],
  // Keep AGENTS.md as project notes; do not append Next's generated rules.
  agentRules: false,
  async redirects() {
    return [{ source: "/map", destination: "/", permanent: false }];
  },
};

export default nextConfig;
