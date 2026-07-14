import { getDriveMedia } from "@/lib/drive";
import { getCachedDriveMediaPrefix, warmDriveMediaPrefix } from "@/lib/drive-media-cache";
import { verifyMediaAccessToken } from "@/lib/media-token";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);
  const fileId = url.searchParams.get("fileId");
  if (!fileId) return new Response("File not found", { status: 404 });

  let allowed = verifyMediaAccessToken(url.searchParams.get("token"), id, fileId);
  if (!allowed) allowed = await canAccessMedia(id, fileId);
  if (!allowed) return new Response("File not found", { status: 404 });

  try {
    if (url.searchParams.get("warm") === "1") {
      await warmDriveMediaPrefix(fileId);
      return new Response(null, { status: 204, headers: { "Cache-Control": "private, max-age=300" } });
    }

    const range = request.headers.get("range");
    const cached = range?.startsWith("bytes=0-") ? getCachedDriveMediaPrefix(fileId) : null;
    if (cached) return cachedPrefixResponse(cached);

    const media = await getDriveMedia(fileId, range);
    if (!media?.ok || !media.body) return new Response("Video unavailable", { status: media?.status ?? 502 });
    const headers = new Headers();
    for (const name of ["content-type", "content-length", "content-range", "accept-ranges"]) {
      const value = media.headers.get(name);
      if (value) headers.set(name, value);
    }
    headers.set("Cache-Control", "private, max-age=300");
    return new Response(media.body, { status: media.status, headers });
  } catch {
    return new Response("Video unavailable", { status: 502 });
  }
}

async function canAccessMedia(adId: string, fileId: string) {
  const supabase = await createSupabaseServerClient();
  const { data: ad } = await supabase.from("ads").select("drive_file_id").eq("id", adId).maybeSingle();
  if (!ad) return false;
  if (ad.drive_file_id === fileId) return true;

  const { data: version } = await supabase
    .from("ad_versions")
    .select("id")
    .eq("ad_id", adId)
    .eq("drive_file_id", fileId)
    .limit(1)
    .maybeSingle();
  return Boolean(version);
}

function cachedPrefixResponse(prefix: NonNullable<ReturnType<typeof getCachedDriveMediaPrefix>>) {
  return new Response(prefix.bytes.slice(0), {
    status: 206,
    headers: {
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=300",
      "Content-Length": String(prefix.bytes.byteLength),
      "Content-Range": `bytes 0-${prefix.bytes.byteLength - 1}/${prefix.totalSize}`,
      "Content-Type": prefix.contentType
    }
  });
}
