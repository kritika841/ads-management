import { NextResponse } from "next/server";
import { zipSync } from "fflate";
import { getCurrentProfile } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveAdMedia } from "@/lib/ad-media-export";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;
  const admin = createSupabaseAdminClient();

  let query = admin.from("ads").select("id, name, drive_file_id").eq("id", id);
  if (profile.role === "editor") query = query.eq("editor_id", profile.id);
  else if (profile.role === "content_creator") query = query.eq("creator_id", profile.id);

  const { data: ad } = await query.maybeSingle();
  if (!ad?.drive_file_id) return new NextResponse("Video not found", { status: 404 });

  const media = await resolveAdMedia(ad.drive_file_id, ad.name);
  if (!media) {
    return new NextResponse(
      "Could not retrieve this creative's video from Google Drive. The service account credentials may be missing or invalid — check server logs.",
      { status: 502 }
    );
  }

  if (media.kind === "folder") {
    const zipped = zipSync(media.files, { level: 0 });
    return new NextResponse(zipped, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${ad.name.replace(/[^a-zA-Z0-9._\- ]/g, "_")}.zip"`,
        "Content-Length": String(zipped.byteLength)
      }
    });
  }

  return new NextResponse(Buffer.from(media.bytes), {
    headers: {
      "Content-Type": media.contentType,
      "Content-Disposition": `attachment; filename="${media.name}"`,
      "Content-Length": String(media.bytes.byteLength)
    }
  });
}
