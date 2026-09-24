import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth";

export const runtime = "nodejs";

const ATTACHMENT_DIR = path.join(process.cwd(), "storage", "announcements", "attachments");

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const profile = await getCurrentProfile();
    if (!profile) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const { id } = await params;
    if (!id) {
      return new NextResponse("Missing file ID", { status: 400 });
    }

    // Find file starting with `${id}_` in ATTACHMENT_DIR
    let targetFileName: string | null = null;
    try {
      const files = await readdir(ATTACHMENT_DIR);
      targetFileName = files.find((f) => f.startsWith(`${id}_`)) ?? null;
    } catch {
      return new NextResponse("Attachment directory not found", { status: 404 });
    }

    if (!targetFileName) {
      return new NextResponse("Attachment not found", { status: 404 });
    }

    const filePath = path.join(ATTACHMENT_DIR, targetFileName);
    const fileStat = await stat(filePath).catch(() => null);
    if (!fileStat) {
      return new NextResponse("File not found on disk", { status: 404 });
    }

    const url = new URL(request.url);
    const customName = url.searchParams.get("name");
    // If not supplied, extract original name by stripping `${id}_`
    const originalName = customName || targetFileName.substring(id.length + 1);

    // Determine basic mime type or fallback
    const ext = path.extname(originalName).toLowerCase();
    let contentType = "application/octet-stream";
    if (ext === ".pdf") contentType = "application/pdf";
    else if (ext === ".mp3") contentType = "audio/mpeg";
    else if (ext === ".wav") contentType = "audio/wav";
    else if (ext === ".m4a") contentType = "audio/mp4";
    else if (ext === ".mp4") contentType = "video/mp4";
    else if (ext === ".mov") contentType = "video/quicktime";
    else if (ext === ".png") contentType = "image/png";
    else if (ext === ".jpg" || ext === ".jpeg") contentType = "image/jpeg";
    else if (ext === ".gif") contentType = "image/gif";
    else if (ext === ".webp") contentType = "image/webp";
    else if (ext === ".zip") contentType = "application/zip";

    return new NextResponse(Readable.toWeb(createReadStream(filePath)) as ReadableStream, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${encodeURIComponent(originalName)}"`,
        "Content-Length": String(fileStat.size),
        "Cache-Control": "private, max-age=86400"
      }
    });
  } catch (error) {
    console.error("Failed to serve announcement attachment:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
