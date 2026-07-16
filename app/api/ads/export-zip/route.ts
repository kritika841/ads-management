import { type NextRequest, NextResponse } from "next/server";
import { zipSync } from "fflate";
import { getCurrentProfile } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveAdMedia } from "@/lib/ad-media-export";

export async function GET(request: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile) return new NextResponse("Unauthorized", { status: 401 });

  const raw = request.nextUrl.searchParams.get("ids") ?? "";
  const ids = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (!ids.length) return new NextResponse("No IDs provided", { status: 400 });
  if (ids.length > 10) return new NextResponse("Maximum 10 creatives per download", { status: 400 });

  const admin = createSupabaseAdminClient();

  let query = admin
    .from("ads")
    .select("id, name, drive_file_id")
    .in("id", ids);

  if (profile.role === "editor") query = query.eq("editor_id", profile.id);
  else if (profile.role === "content_creator") query = query.eq("creator_id", profile.id);

  const { data: ads, error } = await query;
  if (error || !ads?.length) return new NextResponse("Ads not found", { status: 404 });

  const files: Record<string, Uint8Array> = {};

  for (const ad of ads) {
    if (!ad.drive_file_id) continue;
    const folder = ad.name.replace(/[^a-zA-Z0-9_-]/g, "_");

    const media = await resolveAdMedia(ad.drive_file_id, ad.name);
    if (!media) continue;

    if (media.kind === "folder") {
      for (const [name, bytes] of Object.entries(media.files)) {
        files[`${folder}/${name}`] = bytes;
      }
    } else {
      files[`${folder}/${media.name}`] = media.bytes;
    }
  }

  if (Object.keys(files).length === 0) {
    return new NextResponse(
      "Could not retrieve any creative videos from Google Drive. The service account credentials may be missing or invalid — check server logs.",
      { status: 502 }
    );
  }

  const zipped = zipSync(files, { level: 0 });
  const filename = `creatives-${new Date().toISOString().slice(0, 10)}.zip`;

  return new NextResponse(zipped, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(zipped.byteLength),
    },
  });
}
