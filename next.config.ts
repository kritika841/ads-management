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
    },
    async headers() {
      if (phase === PHASE_DEVELOPMENT_SERVER) {
        return [
          {
            source: "/_next/static/:path*",
            headers: [
              {
                key: "Cache-Control",
                value: "no-cache, no-store, must-revalidate"
              }
            ]
          }
        ];
      }
      return [
        {
          source: "/_next/static/:path*",
          headers: [
            {
              key: "Cache-Control",
              value: "public, max-age=31536000, immutable"
            }
          ]
        },
        {
          source: "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff|woff2)).*)",
          headers: [
            {
              key: "Cache-Control",
              value: "no-store, no-cache, must-revalidate, proxy-revalidate"
            },
            {
              key: "Pragma",
              value: "no-cache"
            },
            {
              key: "Expires",
              value: "0"
            }
          ]
        }
      ];
    }
  };
}
