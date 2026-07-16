import { type NextRequest, NextResponse } from "next/server";
import { zipSync, strToU8 } from "fflate";
import { getCurrentProfile } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getDriveMedia, getDriveMetadata, getDriveFolderContents } from "@/lib/drive";

const FOLDER_MIME = "application/vnd.google-apps.folder";

/** Google's public download endpoint returns a 200 HTML page (sign-in/permission notice)
 *  instead of a 404 when a file isn't publicly shared. Reject anything that isn't real media
 *  so we never zip up an HTML error page disguised as a video. */
async function fetchPublicFallback(fileId: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(`https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download`);
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("text/html") || contentType.includes("application/json")) {
      console.error(`Drive public fallback for ${fileId} returned ${contentType}, not media — skipping (file is likely not shared publicly)`);
      return null;
    }
    return new Uint8Array(await res.arrayBuffer());
  } catch (err) {
    console.error(`Drive public fallback fetch failed for ${fileId}`, err);
    return null;
  }
}

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
    .select("id, name, script_text, drive_file_id")
    .in("id", ids);

  if (profile.role === "editor") query = query.eq("editor_id", profile.id);
  else if (profile.role === "content_creator") query = query.eq("creator_id", profile.id);

  const { data: ads, error } = await query;
  if (error || !ads?.length) return new NextResponse("Ads not found", { status: 404 });

  const files: Record<string, Uint8Array> = {};

  for (const ad of ads) {
    const folder = ad.name.replace(/[^a-zA-Z0-9_-]/g, "_");

    if (ad.script_text?.trim()) {
      files[`${folder}/script.txt`] = strToU8(ad.script_text);
    }

    if (!ad.drive_file_id) continue;

    try {
      const meta = await getDriveMetadata(ad.drive_file_id);

      if (meta?.mimeType === FOLDER_MIME) {
        // Drive folder — download every file inside it
        const children = await getDriveFolderContents(ad.drive_file_id);
        for (const child of children) {
          if (!child.id || child.mimeType === FOLDER_MIME) continue;
          const safeName = (child.name ?? child.id).replace(/[^a-zA-Z0-9._\- ]/g, "_");
          let bytes: Uint8Array | null = null;
          try {
            const res = await getDriveMedia(child.id);
            if (res?.ok) bytes = new Uint8Array(await res.arrayBuffer());
          } catch (err) {
            console.error(`getDriveMedia failed for child ${child.id} of ad ${ad.id}`, err);
          }
          bytes ??= await fetchPublicFallback(child.id);
          if (bytes) files[`${folder}/${safeName}`] = bytes;
          else console.error(`Could not fetch Drive child ${child.id} (${safeName}) for ad ${ad.id} via service account or public fallback`);
        }
      } else if (meta) {
        // Single file — use Drive filename so the extension is correct
        const safeName = (meta.name ?? ad.name).replace(/[^a-zA-Z0-9._\- ]/g, "_");
        let bytes: Uint8Array | null = null;
        try {
          const res = await getDriveMedia(ad.drive_file_id);
          if (res?.ok) bytes = new Uint8Array(await res.arrayBuffer());
        } catch (err) {
          console.error(`getDriveMedia failed for ad ${ad.id}`, err);
        }
        bytes ??= await fetchPublicFallback(ad.drive_file_id);
        if (bytes) files[`${folder}/${safeName}`] = bytes;
        else console.error(`Could not fetch Drive file for ad ${ad.id} via service account or public fallback`);
      } else {
        console.error(`getDriveMetadata returned null for ad ${ad.id} (drive auth unavailable or file inaccessible) — trying public fallback`);
        const bytes = await fetchPublicFallback(ad.drive_file_id);
        if (bytes) files[`${folder}/${ad.name.replace(/[^a-zA-Z0-9._\- ]/g, "_")}.mp4`] = bytes;
      }
    } catch (err) {
      console.error(`Drive metadata lookup threw for ad ${ad.id}`, err);
      const bytes = await fetchPublicFallback(ad.drive_file_id);
      if (bytes) files[`${folder}/${ad.name.replace(/[^a-zA-Z0-9._\- ]/g, "_")}.mp4`] = bytes;
    }
  }

  if (Object.keys(files).length === 0) {
    return new NextResponse(
      "Could not retrieve any creative files from Google Drive. The service account credentials may be missing or invalid — check server logs.",
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
