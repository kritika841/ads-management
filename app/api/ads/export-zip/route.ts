import { type NextRequest, NextResponse } from "next/server";
import { zipSync, strToU8 } from "fflate";
import { requireProfile } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getDriveMedia, getDriveMetadata, getDriveThumbnail } from "@/lib/drive";

const mimeToExt: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/x-msvideo": "avi",
  "video/webm": "webm",
  "video/x-matroska": "mkv",
  "video/mpeg": "mpg",
  "video/3gpp": "3gp",
  "video/x-ms-wmv": "wmv",
};

export async function GET(request: NextRequest) {
  const profile = await requireProfile();

  const raw = request.nextUrl.searchParams.get("ids") ?? "";
  const ids = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (!ids.length) return new NextResponse("No IDs provided", { status: 400 });
  if (ids.length > 10) return new NextResponse("Maximum 10 creatives per download", { status: 400 });

  const admin = createSupabaseAdminClient();

  let query = admin
    .from("ads")
    .select(`
      id, name, script_text, drive_file_id, production_stage, deadline, platforms, notes,
      campaign:campaigns(name),
      product:products(name),
      creator:profiles!ads_creator_id_fkey(name),
      editor:profiles!ads_editor_id_fkey(name)
    `)
    .in("id", ids);

  if (profile.role === "editor") query = query.eq("editor_id", profile.id);
  else if (profile.role === "content_creator") query = query.eq("creator_id", profile.id);

  const { data: ads, error } = await query;
  if (error || !ads?.length) return new NextResponse("Ads not found", { status: 404 });

  const files: Record<string, Uint8Array> = {};
  const csvRows = ["Name,Campaign,Product,Creator,Editor,Stage,Deadline,Platforms,Drive URL"];

  for (const ad of ads) {
    const folder = ad.name.replace(/[^a-zA-Z0-9_-]/g, "_");

    // Script
    if (ad.script_text?.trim()) {
      files[`${folder}/script.txt`] = strToU8(ad.script_text);
    }

    const driveUrl = ad.drive_file_id
      ? `https://drive.google.com/file/d/${ad.drive_file_id}/view`
      : "";

    const meta = {
      id: ad.id,
      name: ad.name,
      campaign: (ad.campaign as unknown as { name: string } | null)?.name ?? "",
      product: (ad.product as unknown as { name: string } | null)?.name ?? "",
      creator: (ad.creator as unknown as { name: string } | null)?.name ?? "",
      editor: (ad.editor as unknown as { name: string } | null)?.name ?? "",
      stage: ad.production_stage,
      deadline: ad.deadline ?? "",
      platforms: (ad.platforms as string[] | null) ?? [],
      notes: ad.notes ?? "",
      driveUrl,
    };
    files[`${folder}/metadata.json`] = strToU8(JSON.stringify(meta, null, 2));

    if (ad.drive_file_id) {
      // Fetch file metadata (name + mimeType) to pick the right extension
      let videoExt = "mp4";
      let originalName = ad.name;
      try {
        const driveMeta = await getDriveMetadata(ad.drive_file_id);
        if (driveMeta?.mimeType) {
          videoExt = mimeToExt[driveMeta.mimeType] ?? "mp4";
        }
        if (driveMeta?.name) {
          // Preserve the original Drive filename extension if present
          const dotIdx = driveMeta.name.lastIndexOf(".");
          if (dotIdx !== -1) videoExt = driveMeta.name.slice(dotIdx + 1).toLowerCase();
          originalName = driveMeta.name;
        }
      } catch {
        // fall back to mp4
      }

      // Download the actual video from Google Drive
      try {
        const mediaRes = await getDriveMedia(ad.drive_file_id);
        if (mediaRes?.ok) {
          const videoBuffer = await mediaRes.arrayBuffer();
          files[`${folder}/${originalName.replace(/[^a-zA-Z0-9._-]/g, "_")}`] =
            new Uint8Array(videoBuffer);
        }
      } catch {
        // Video unavailable — include a placeholder note
        files[`${folder}/video_unavailable.txt`] = strToU8(
          `Could not download video.\nDrive URL: ${driveUrl}\n`
        );
      }

      // Thumbnail (best-effort)
      try {
        const thumb = await getDriveThumbnail(ad.drive_file_id);
        if (thumb) {
          const ext = thumb.contentType.includes("png") ? "png" : "jpg";
          files[`${folder}/thumbnail.${ext}`] = new Uint8Array(thumb.bytes);
        }
      } catch {
        // skip
      }
    }

    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    csvRows.push(
      [ad.name, meta.campaign, meta.product, meta.creator, meta.editor,
        ad.production_stage, ad.deadline ?? "",
        (ad.platforms as string[] ?? []).join("|"), driveUrl]
        .map(esc).join(",")
    );
  }

  files["manifest.csv"] = strToU8(csvRows.join("\r\n"));

  // level 0 = store without compression (videos/images don't compress)
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
