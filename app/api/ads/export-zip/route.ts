import { type NextRequest, NextResponse } from "next/server";
import { zipSync, strToU8 } from "fflate";
import { getCurrentProfile } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getDriveMedia, getDriveMetadata, getDriveFolderContents } from "@/lib/drive";

const FOLDER_MIME = "application/vnd.google-apps.folder";

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

    if (ad.drive_file_id) {
      try {
        const meta = await getDriveMetadata(ad.drive_file_id);

        if (meta?.mimeType === FOLDER_MIME) {
          // Drive folder — download every file inside it
          const children = await getDriveFolderContents(ad.drive_file_id);
          for (const child of children) {
            if (!child.id || child.mimeType === FOLDER_MIME) continue;
            const safeName = (child.name ?? child.id).replace(/[^a-zA-Z0-9._\- ]/g, "_");
            try {
              const res = await getDriveMedia(child.id);
              if (res?.ok) {
                files[`${folder}/${safeName}`] = new Uint8Array(await res.arrayBuffer());
              } else {
                const pub = await fetch(`https://drive.usercontent.google.com/download?id=${encodeURIComponent(child.id)}&export=download`);
                if (pub.ok) files[`${folder}/${safeName}`] = new Uint8Array(await pub.arrayBuffer());
              }
            } catch {
              try {
                const pub = await fetch(`https://drive.usercontent.google.com/download?id=${encodeURIComponent(child.id)}&export=download`);
                if (pub.ok) files[`${folder}/${safeName}`] = new Uint8Array(await pub.arrayBuffer());
              } catch { /* skip */ }
            }
          }
        } else if (meta) {
          // Single file — use Drive filename so the extension is correct
          const safeName = (meta.name ?? ad.name).replace(/[^a-zA-Z0-9._\- ]/g, "_");
          try {
            const res = await getDriveMedia(ad.drive_file_id);
            if (res?.ok) {
              files[`${folder}/${safeName}`] = new Uint8Array(await res.arrayBuffer());
            } else {
              // Fallback: public Drive download URL
              const pub = await fetch(`https://drive.usercontent.google.com/download?id=${encodeURIComponent(ad.drive_file_id)}&export=download`);
              if (pub.ok) files[`${folder}/${safeName}`] = new Uint8Array(await pub.arrayBuffer());
            }
          } catch {
            // Try public URL on any error
            try {
              const pub = await fetch(`https://drive.usercontent.google.com/download?id=${encodeURIComponent(ad.drive_file_id)}&export=download`);
              if (pub.ok) files[`${folder}/${safeName}`] = new Uint8Array(await pub.arrayBuffer());
            } catch { /* skip */ }
          }
        }
      } catch {
        // Drive metadata unavailable — try public URL directly
        try {
          const ext = ".mp4";
          const safeName = `${ad.name.replace(/[^a-zA-Z0-9._\- ]/g, "_")}${ext}`;
          const pub = await fetch(`https://drive.usercontent.google.com/download?id=${encodeURIComponent(ad.drive_file_id!)}&export=download`);
          if (pub.ok) files[`${folder}/${safeName}`] = new Uint8Array(await pub.arrayBuffer());
        } catch { /* skip */ }
      }
    }
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
