import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth";
import { getExportJob } from "@/lib/export-jobs";
import { getDownloadLogById, recordDownloadAccess } from "@/lib/download-logs";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile) return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await params;

  const job = await getExportJob(id, profile);
  if (!job) return new NextResponse("Export job not found or expired.", { status: 404 });
  if (job.phase !== "ready") return new NextResponse("Export job is not ready yet.", { status: 409 });

  const fileStat = await stat(job.outputPath).catch(() => null);
  if (!fileStat) {
    return new NextResponse("The requested ZIP archive file was not found on disk.", { status: 404 });
  }

  const log = await getDownloadLogById(id);
  const filename = log?.zip_filename || `creatives-${job.createdAt.slice(0, 10)}.zip`;

  // Track download access count asynchronously
  void recordDownloadAccess(id).catch(() => undefined);

  return new NextResponse(Readable.toWeb(createReadStream(job.outputPath)) as ReadableStream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(job.zipSizeBytes),
      "Cache-Control": "private, max-age=86400",
    },
  });
}
