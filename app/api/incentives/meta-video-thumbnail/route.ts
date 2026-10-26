import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";

export const runtime = "nodejs";

const GRAPH_VERSION = "v23.0";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MISS_TTL_MS = 10 * 60 * 1000;

// Per-process cache: each video is resolved from Meta at most once per TTL, and concurrent requests share one call.
// This keeps the audit table fast and stops it from burning Meta's application rate limit.
const resolved = new Map<string, { url: string | null; expires: number }>();
const inflight = new Map<string, Promise<string | null>>();

async function resolveThumbnail(videoId: string, token: string): Promise<string | null> {
  const response = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${videoId}?fields=picture&access_token=${encodeURIComponent(token)}`, { cache: "no-store", signal: AbortSignal.timeout(8000) }).catch(() => null);
  const payload = (await response?.json().catch(() => null)) as { picture?: string } | null;
  return payload?.picture ?? null;
}

/** Resolves the thumbnail of one specific Meta video so each creative inside a multi-video ad shows its own frame. */
export async function GET(request: Request) {
  await requireRole(["admin", "manager"]);
  const videoId = new URL(request.url).searchParams.get("videoId") ?? "";
  const token = process.env.META_ACCESS_TOKEN;
  if (!/^\d+$/.test(videoId) || !token) return new NextResponse(null, { status: 404 });

  const cached = resolved.get(videoId);
  let url: string | null;
  if (cached && cached.expires > Date.now()) url = cached.url;
  else {
    let pending = inflight.get(videoId);
    if (!pending) {
      pending = resolveThumbnail(videoId, token).finally(() => inflight.delete(videoId));
      inflight.set(videoId, pending);
    }
    url = await pending;
    resolved.set(videoId, { url, expires: Date.now() + (url ? CACHE_TTL_MS : MISS_TTL_MS) });
  }
  if (!url) return new NextResponse(null, { status: 404, headers: { "Cache-Control": "private, max-age=300" } });
  return NextResponse.redirect(url, { status: 302, headers: { "Cache-Control": "private, max-age=21600" } });
}
