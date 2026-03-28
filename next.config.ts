import type { NextConfig } from "next";
import { readFileSync } from "fs";

const pkg = JSON.parse(readFileSync("./package.json", "utf-8"));

const nextConfig: NextConfig = {
  output: "standalone",
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
  },
  allowedDevOrigins: process.env.NEXT_PUBLIC_ALLOWED_DEV_ORIGINS
    ? process.env.NEXT_PUBLIC_ALLOWED_DEV_ORIGINS.split(",").map((s) =>
        s.trim(),
      )
    : ["localhost"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
    ],
  },
};

export default nextConfig;
