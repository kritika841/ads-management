import { getDriveMedia } from "@/lib/drive";
import { getCachedDriveMediaPrefix, streamDriveMediaPrefix, streamFromCachedPrefix, warmDriveMediaPrefix, type DriveMediaPrefix } from "@/lib/drive-media-cache";
import { verifyMediaAccessToken } from "@/lib/media-token";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const CACHE_CONTROL = "private, max-age=3600";

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

    const rangeHeader = request.headers.get("range");
    const range = parseSingleRange(rangeHeader);

    if (range) {
      // 1. Anything inside the warm prefix is served straight from memory with an
      //    exact, spec-compliant slice.
      const cached = getCachedDriveMediaPrefix(fileId);
      if (cached) {
        // Open-ended request (normal playback) that starts inside the cache: send the cached
        // bytes now and continue with the live Drive tail in the same response, so the browser
        // never hits the end of the cache mid-playback and has to stall for a new request.
        const available = cached.bytes.byteLength;
        if (range.end === null && range.start < available && available < cached.totalSize) {
          return new Response(streamFromCachedPrefix(fileId, cached, range.start), {
            status: 206,
            headers: {
              "Accept-Ranges": "bytes",
              "Cache-Control": CACHE_CONTROL,
              "Content-Length": String(cached.totalSize - range.start),
              "Content-Range": `bytes ${range.start}-${cached.totalSize - 1}/${cached.totalSize}`,
              "Content-Type": cached.contentType
            }
          });
        }
        const slice = cachedRangeResponse(cached, range);
        if (slice) return slice;
      }

      // 2. First open-ended request of a cold file: stream the whole file from Drive right away
      //    and capture the prefix in the background. We never make the browser wait for the
      //    prefix to download before it receives its first byte.
      if (range.start === 0 && range.end === null) {
        const streamed = await streamDriveMediaPrefix(fileId);
        if (streamed) {
          const headers = new Headers({
            "Accept-Ranges": "bytes",
            "Cache-Control": CACHE_CONTROL,
            "Content-Type": streamed.contentType
          });
          if (streamed.contentLength) headers.set("Content-Length", streamed.contentLength);
          if (streamed.contentRange) headers.set("Content-Range", streamed.contentRange);
          return new Response(streamed.body, { status: streamed.status, headers });
        }
      }
    }

    // 3. Everything else (seeks, the moov atom at the end of a file, tail ranges) is a
    //    straight pass-through. The abort signal stops the Drive download as soon as the
    //    browser cancels the request, so seeking never leaves orphaned transfers behind.
    const media = await getDriveMedia(fileId, rangeHeader, request.signal);
    if (media?.ok && media.body) {
      const headers = new Headers();
      for (const name of ["content-type", "content-length", "content-range", "accept-ranges"]) {
        const value = media.headers.get(name);
        if (value) headers.set(name, value);
      }
      if (!headers.has("accept-ranges")) headers.set("Accept-Ranges", "bytes");
      headers.set("Cache-Control", CACHE_CONTROL);
      return new Response(media.body, { status: media.status, headers });
    }
    // Service account unavailable — redirect to public Drive download URL (works for shared files)
    return Response.redirect(
      `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download`,
      302
    );
  } catch {
    // The client navigated away or seeked: nothing is listening, so don't start a redirect.
    if (request.signal.aborted) return new Response(null, { status: 499 });
    return Response.redirect(
      `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download`,
      302
    );
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

type ByteRange = { start: number; end: number | null };

/** Parses a single `bytes=start-end` range. Multi-range and suffix ranges are passed through upstream. */
function parseSingleRange(header: string | null): ByteRange | null {
  const match = /^bytes=(\d+)-(\d*)$/.exec(header?.trim() ?? "");
  if (!match) return null;
  const start = Number(match[1]);
  const end = match[2] === "" ? null : Number(match[2]);
  if (!Number.isSafeInteger(start) || (end !== null && (!Number.isSafeInteger(end) || end < start))) return null;
  return { start, end };
}

function cachedRangeResponse(prefix: DriveMediaPrefix, range: ByteRange) {
  const available = prefix.bytes.byteLength;
  if (range.start >= available) return null;
  const end = Math.min(range.end ?? available - 1, available - 1);
  const body = prefix.bytes.slice(range.start, end + 1);
  return new Response(body, {
    status: 206,
    headers: {
      "Accept-Ranges": "bytes",
      "Cache-Control": CACHE_CONTROL,
      "Content-Length": String(body.byteLength),
      "Content-Range": `bytes ${range.start}-${end}/${prefix.totalSize}`,
      "Content-Type": prefix.contentType
    }
  });
}
