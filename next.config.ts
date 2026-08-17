import type { NextConfig } from "next";
import { execSync } from "child_process";

let gitHash = "dev";
try {
  gitHash = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
    .toString()
    .trim();
} catch { /* not a git repo or git unavailable */ }

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_GIT_HASH: gitHash,
  },
};

export default nextConfig;
