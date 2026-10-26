import type { NextRequest } from "next/server";

export function getPublicOrigin(request: NextRequest): string {
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const hostHeader = request.headers.get("host")?.split(",")[0]?.trim();
  const candidateHost = forwardedHost || hostHeader || "";
  const isLocalHost =
    candidateHost.startsWith("localhost") ||
    candidateHost.startsWith("127.0.0.1") ||
    candidateHost.startsWith("[::1]");

  if (candidateHost && (!isLocalHost || process.env.NODE_ENV !== "production")) {
    const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const proto = forwardedProto || (isLocalHost ? "http" : "https");
    return `${proto}://${candidateHost}`;
  }

  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
  if (configured && (!configured.includes("localhost") || process.env.NODE_ENV !== "production")) {
    return configured;
  }

  return process.env.NODE_ENV === "production" ? "https://ads.satmi.in" : new URL(request.url).origin;
}
