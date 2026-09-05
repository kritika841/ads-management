import { NextResponse } from "next/server";
import { zipSync } from "fflate";
import { getCurrentProfile } from "@/lib/auth";
import { getDriveMedia, getDriveMetadata } from "@/lib/drive";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveAdMedia } from "@/lib/ad-media-export";

const folderMime = "application/vnd.google-apps.folder";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;
  const requestedFileId = new URL(request.url).searchParams.get("fileId");
  const admin = createSupabaseAdminClient();

  let query = admin.from("ads").select("id, name, drive_file_id").eq("id", id);
  if (profile.role === "editor") query = query.eq("editor_id", profile.id);
  else if (profile.role === "content_creator") query = query.eq("creator_id", profile.id);

  const { data: ad } = await query.maybeSingle();
  if (!ad?.drive_file_id) return new NextResponse("Video not found", { status: 404 });

  let fileId = ad.drive_file_id;
  if (requestedFileId && requestedFileId !== ad.drive_file_id) {
    // A specific (e.g. older) version was requested — only allow file IDs that actually
    // belong to this ad's version history, so a fileId can't be used to fetch arbitrary
    // Drive content the service account happens to have access to.
    const { data: version } = await admin
      .from("ad_versions")
      .select("drive_file_id")
      .eq("ad_id", id)
      .eq("drive_file_id", requestedFileId)
      .maybeSingle();
    if (!version?.drive_file_id) return new NextResponse("Video not found", { status: 404 });
    fileId = version.drive_file_id;
  }

  let metadata: Awaited<ReturnType<typeof getDriveMetadata>> = null;
  try { metadata = await getDriveMetadata(fileId); } catch (cause) { console.error(`Could not read Drive metadata for ${fileId}`, cause); }

  if (metadata?.mimeType !== folderMime) {
    const source = await downloadSource(fileId);
    if (!source) return downloadFailure();
    const extension = fileExtension(metadata?.name, metadata?.mimeType ?? source.headers.get("content-type"));
    const filename = `${safeName(ad.name)}.${extension}`;
    const headers = new Headers({
      "Content-Type": source.headers.get("content-type") ?? metadata?.mimeType ?? "application/octet-stream",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    });
    const length = source.headers.get("content-length");
    if (length) headers.set("Content-Length", length);
    return new NextResponse(source.body, { headers });
  }

  const media = await resolveAdMedia(fileId, ad.name);
  if (!media || media.kind !== "folder") {
    return downloadFailure();
  }

  const zipped = zipSync(media.files, { level: 0 });
  return new NextResponse(zipped, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${safeName(ad.name)}.zip"`,
      "Content-Length": String(zipped.byteLength),
      "Cache-Control": "no-store",
    }
  });
}

async function downloadSource(fileId: string) {
  try {
    const response = await getDriveMedia(fileId);
    if (isDownload(response)) return response;
  } catch (cause) { console.error(`Authenticated Drive download failed for ${fileId}`, cause); }
  try {
    const response = await fetch(`https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download`, { cache: "no-store" });
    return isDownload(response) ? response : null;
  } catch (cause) { console.error(`Public Drive download failed for ${fileId}`, cause); return null; }
}

function isDownload(response: Response | null): response is Response {
  if (!response?.ok || !response.body) return false;
  const contentType = response.headers.get("content-type") ?? "";
  return !contentType.includes("text/html") && !contentType.includes("application/json");
}

function downloadFailure() {
  return new NextResponse("Could not retrieve this creative's video from Google Drive. The service account credentials may be missing or invalid — check server logs.", { status: 502 });
}

function safeName(value: string) { return value.replace(/[^a-zA-Z0-9._\- ]/g, "_"); }

function fileExtension(name: string | null | undefined, contentType: string | null | undefined) {
  return name?.match(/\.([a-zA-Z0-9]+)$/)?.[1]?.toLowerCase() || contentType?.split("/")[1]?.split(";")[0]?.toLowerCase() || "mp4";
}
