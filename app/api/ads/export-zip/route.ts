import { type NextRequest, NextResponse } from "next/server";
import { Zip, ZipPassThrough } from "fflate";
import { getCurrentProfile } from "@/lib/auth";
import { getDriveFolderContents, getDriveMedia, getDriveMetadata } from "@/lib/drive";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 300;

const FOLDER_MIME = "application/vnd.google-apps.folder";

type DriveExportFile = { driveFileId: string; filename: string };

export async function GET(request: NextRequest) {
  const ids = request.nextUrl.searchParams.get("ids")?.split(",").map((id) => id.trim()).filter(Boolean) ?? [];
  return exportZip(request, ids);
}

export async function POST(request: NextRequest) {
  let ids: string[];
  try {
    const body = await request.json();
    ids = Array.isArray(body?.ids) ? body.ids.filter((id: unknown): id is string => typeof id === "string" && id.trim().length > 0) : [];
  } catch {
    return new NextResponse("Invalid JSON body", { status: 400 });
  }
  return exportZip(request, ids);
}

async function exportZip(request: NextRequest, ids: string[]) {
  const profile = await getCurrentProfile();
  if (!profile) return new NextResponse("Unauthorized", { status: 401 });
  if (!ids.length) return new NextResponse("No IDs provided", { status: 400 });

  const ads = await loadAuthorizedAds(createSupabaseAdminClient(), profile, ids);
  if (!ads.length) return new NextResponse("Ads not found", { status: 404 });

  const skipped: string[] = [];
  const names = new Set<string>();
  const files: DriveExportFile[] = [];
  for (const ad of ads) {
    if (!ad.drive_file_id) {
      skipped.push(`${ad.name}: no Google Drive file is attached.`);
      continue;
    }
    try {
      const adFiles = await listDriveExportFiles(ad.drive_file_id, ad.name);
      if (!adFiles.length) {
        skipped.push(`${ad.name}: no downloadable video was found in Google Drive.`);
        continue;
      }
      for (const file of adFiles) files.push({ ...file, filename: uniqueFilename(file.filename, names) });
    } catch (cause) {
      skipped.push(`${ad.name}: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }

  if (!files.length) return new NextResponse("None of the selected creatives could be read from Google Drive.", { status: 502 });

  const filename = `creatives-${new Date().toISOString().slice(0, 10)}.zip`;
  return new NextResponse(createZipStream(files, skipped), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

async function loadAuthorizedAds(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  profile: Awaited<ReturnType<typeof getCurrentProfile>> & {},
  ids: string[]
) {
  const ads: { id: string; name: string; drive_file_id: string | null }[] = [];
  const uniqueIds = [...new Set(ids)];
  for (let index = 0; index < uniqueIds.length; index += 100) {
    let query = admin.from("ads").select("id, name, drive_file_id").in("id", uniqueIds.slice(index, index + 100));
    if (profile.role === "editor") query = query.eq("editor_id", profile.id);
    else if (profile.role === "content_creator") query = query.eq("creator_id", profile.id);
    const { data, error } = await query;
    if (error) throw new Error(`Could not load selected creatives: ${error.message}`);
    ads.push(...(data ?? []));
  }
  return ads;
}

async function listDriveExportFiles(driveFileId: string, adName: string): Promise<DriveExportFile[]> {
  const meta = await getDriveMetadata(driveFileId);
  if (!meta) return [{ driveFileId, filename: `${safeName(adName)}.mp4` }];
  if (meta.mimeType !== FOLDER_MIME) return [{ driveFileId, filename: `${safeName(adName)}.${extensionFrom(meta.name, meta.mimeType)}` }];

  const children = await getDriveFolderContents(driveFileId);
  return children
    .filter((child): child is typeof child & { id: string } => Boolean(child.id) && child.mimeType !== FOLDER_MIME)
    .map((child) => ({ driveFileId: child.id, filename: `${safeName(adName)}_${safeName(child.name ?? child.id)}` }));
}

function createZipStream(files: DriveExportFile[], skipped: string[]): ReadableStream<Uint8Array> {
  let zip: Zip | null = null;
  let cancelled = false;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      zip = new Zip((error, chunk, final) => {
        if (error) return controller.error(error);
        if (chunk) controller.enqueue(chunk);
        if (final) controller.close();
      });
      void (async () => {
        try {
          for (const file of files) {
            if (cancelled) return;
            const response = await fetchDriveMedia(file.driveFileId);
            if (!response?.body) {
              skipped.push(`${file.filename}: Google Drive denied the download or the file no longer exists.`);
              continue;
            }
            const entry = new ZipPassThrough(file.filename);
            zip!.add(entry);
            const reader = response.body.getReader();
            while (!cancelled) {
              const { done, value } = await reader.read();
              if (done) break;
              entry.push(value);
            }
            reader.releaseLock();
            if (cancelled) return;
            entry.push(new Uint8Array(), true);
          }
          if (skipped.length) {
            const report = new ZipPassThrough("DOWNLOAD_REPORT.txt");
            zip!.add(report);
            report.push(new TextEncoder().encode(`The following selected items could not be included:\n\n${skipped.map((item) => `- ${item}`).join("\n")}\n`), true);
          }
          zip!.end();
        } catch (cause) {
          controller.error(cause);
        }
      })();
    },
    cancel() {
      cancelled = true;
      zip?.terminate();
    },
  });
}

async function fetchDriveMedia(fileId: string): Promise<Response | null> {
  try {
    const response = await getDriveMedia(fileId);
    if (isMediaResponse(response)) return response;
  } catch (cause) {
    console.error(`Google Drive service-account download failed for ${fileId}`, cause);
  }
  try {
    const response = await fetch(`https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download`, { cache: "no-store" });
    return isMediaResponse(response) ? response : null;
  } catch (cause) {
    console.error(`Google Drive public download failed for ${fileId}`, cause);
    return null;
  }
}

function isMediaResponse(response: Response | null): response is Response {
  if (!response?.ok || !response.body) return false;
  const contentType = response.headers.get("content-type") ?? "";
  return !contentType.includes("text/html") && !contentType.includes("application/json");
}

function safeName(value: string) { return value.replace(/[^a-zA-Z0-9._\- ]/g, "_"); }

function extensionFrom(name: string | null | undefined, mimeType: string | null | undefined) {
  const fromName = name?.match(/\.([a-zA-Z0-9]+)$/)?.[1];
  return fromName?.toLowerCase() || mimeType?.split("/")[1]?.toLowerCase() || "mp4";
}

function uniqueFilename(filename: string, names: Set<string>) {
  if (!names.has(filename)) { names.add(filename); return filename; }
  const match = filename.match(/^(.*?)(\.[^.]+)?$/);
  const stem = match?.[1] || filename;
  const extension = match?.[2] || "";
  let index = 2;
  let candidate = `${stem} (${index})${extension}`;
  while (names.has(candidate)) candidate = `${stem} (${++index})${extension}`;
  names.add(candidate);
  return candidate;
}
