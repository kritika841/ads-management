import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";

const GRAPH_VERSION = "v23.0";

type MetaCreative = {
  id?: string;
  thumbnail_url?: string;
  video_id?: string;
  object_story_spec?: unknown;
  asset_feed_spec?: unknown;
};
type MetaAdPayload = { id?: string; name?: string; creative?: MetaCreative };
type MetaVideoPayload = { id?: string; source?: string };

export async function GET(request: NextRequest) {
  await requireRole(["admin", "manager", "content_creator", "editor"]);
  const adId = request.nextUrl.searchParams.get("adId")?.trim() ?? "";
  const expectedCreativeId = request.nextUrl.searchParams.get("creativeId")?.trim() || null;
  const requestedVideoId = request.nextUrl.searchParams.get("videoId")?.trim() || null;
  const stream = request.nextUrl.searchParams.get("stream") === "1";
  const download = request.nextUrl.searchParams.get("download") === "1";
  const token = process.env.META_ACCESS_TOKEN;

  if (!/^\d+$/.test(adId)) return NextResponse.json({ error: "A valid Meta ad ID is required." }, { status: 400 });
  if (expectedCreativeId && !/^\d+$/.test(expectedCreativeId)) return NextResponse.json({ error: "Invalid Meta creative ID." }, { status: 400 });
  if (requestedVideoId && !/^\d+$/.test(requestedVideoId)) return NextResponse.json({ error: "Invalid Meta video ID." }, { status: 400 });
  if (!token) return NextResponse.json({ error: "Meta credentials are not configured." }, { status: 503 });

  try {
    const ad = await graph<MetaAdPayload>(`${adId}?fields=id,name,creative{id,thumbnail_url,video_id,object_story_spec,asset_feed_spec}`, token);
    if (ad.id !== adId) return NextResponse.json({ error: "Meta returned a different ad than requested." }, { status: 409 });
    const creative = ad.creative;
    if (!creative?.id) return NextResponse.json({ error: "This Meta ad has no accessible creative." }, { status: 404 });
    if (expectedCreativeId && creative.id !== expectedCreativeId) {
      return NextResponse.json({ error: `Creative identity mismatch: requested ${expectedCreativeId}, Meta currently reports ${creative.id}. Refresh Meta data before previewing.` }, { status: 409 });
    }

    const videoIds = collectVideoIds(creative);
    const videoId = requestedVideoId ?? creative.video_id ?? (videoIds.length === 1 ? videoIds[0] : null);
    if (requestedVideoId && !videoIds.includes(requestedVideoId)) {
      return NextResponse.json({ error: `Video ${requestedVideoId} is not part of Meta creative ${creative.id}.`, availableVideoIds: videoIds }, { status: 409 });
    }
    if (!videoId && videoIds.length > 1) {
      return NextResponse.json({ error: "This is a multi-video Meta creative. Open an individual atomic video row to play the exact variant.", availableVideoIds: videoIds }, { status: 409 });
    }
    if (!videoId) return NextResponse.json({ error: "Meta does not report a playable video for this creative." }, { status: 404 });

    const video = await resolveVideo(videoId, creative, token);
    if (!video.source) return NextResponse.json({ error: `Meta did not return a playable source for video ${videoId}.` }, { status: 502 });
    if (stream || download) return proxyVideo(request, video.source, adId, videoId, download);

    const identity = { adId, creativeId: creative.id, videoId };
    const mediaUrl = `/api/incentives/meta-preview?${new URLSearchParams({ ...identity, stream: "1" }).toString()}`;
    const downloadUrl = `/api/incentives/meta-preview?${new URLSearchParams({ ...identity, download: "1" }).toString()}`;
    return NextResponse.json({ ...identity, name: ad.name ?? null, mediaType: "video", mediaUrl, downloadUrl, thumbnailUrl: creative.thumbnail_url ?? null, source: "live_meta" }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Meta preview lookup failed." }, { status: 502 });
  }
}

function collectVideoIds(value: unknown) {
  const ids = new Set<string>();
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      if (key === "video_id" && typeof child === "string" && /^\d+$/.test(child)) ids.add(child);
      else visit(child);
    }
  };
  visit(value);
  return [...ids];
}

async function resolveVideo(videoId: string, creative: MetaCreative, token: string) {
  const direct = await graph<MetaVideoPayload>(`${videoId}?fields=id,source`, token).catch(() => null);
  if (direct?.source) return direct;
  const pageId = findPageId(creative);
  if (!pageId) return direct ?? { id: videoId };
  const accounts = await graph<{ data?: Array<{ id?: string; access_token?: string }> }>("me/accounts?fields=id,access_token&limit=100", token).catch(() => null);
  const pageToken = accounts?.data?.find((page) => page.id === pageId)?.access_token;
  if (!pageToken) return direct ?? { id: videoId };
  return graph<MetaVideoPayload>(`${videoId}?fields=id,source`, pageToken).catch(() => direct ?? { id: videoId });
}

function findPageId(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) { const id = findPageId(item); if (id) return id; }
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.page_id === "string" && record.page_id) return record.page_id;
  for (const child of Object.values(record)) { const id = findPageId(child); if (id) return id; }
  return null;
}

async function proxyVideo(request: NextRequest, source: string, adId: string, videoId: string, download: boolean) {
  const headers = new Headers();
  const range = request.headers.get("range");
  if (range) headers.set("range", range);
  const response = await fetch(source, { headers, cache: "no-store" });
  if (!response.ok || !response.body) return NextResponse.json({ error: `Meta video stream failed with HTTP ${response.status}.` }, { status: 502 });
  const output = new Headers({ "Content-Type": response.headers.get("content-type") ?? "video/mp4", "Accept-Ranges": response.headers.get("accept-ranges") ?? "bytes", "Cache-Control": "private, no-store, max-age=0", "X-Meta-Ad-Id": adId, "X-Meta-Video-Id": videoId });
  for (const key of ["content-length", "content-range"]) { const value = response.headers.get(key); if (value) output.set(key, value); }
  if (download) output.set("Content-Disposition", `attachment; filename="meta-ad-${adId}-video-${videoId}.mp4"`);
  return new NextResponse(response.body, { status: response.status, headers: output });
}

async function graph<T>(path: string, token: string): Promise<T> {
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${path}`);
  url.searchParams.set("access_token", token);
  const response = await fetch(url, { cache: "no-store" });
  const payload = await response.json() as T & { error?: { message?: string } };
  if (!response.ok || payload.error) throw new Error(payload.error?.message ?? `Meta returned HTTP ${response.status}.`);
  return payload;
}
