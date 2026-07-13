import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

export default function nextConfig(phase: string): NextConfig {
  return {
    // Keep dev and production artifacts isolated so concurrent checks cannot
    // invalidate a running development server's module manifest.
    distDir: phase === PHASE_DEVELOPMENT_SERVER ? ".next-dev" : ".next",
    images: {
      remotePatterns: [
        {
          protocol: "https",
          hostname: "drive.google.com"
        },
        {
          protocol: "https",
          hostname: "lh3.googleusercontent.com"
        },
        {
          protocol: "https",
          hostname: "*.supabase.co"
        }
      ]
    }
  };
}
