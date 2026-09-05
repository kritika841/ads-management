import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth";
import { getExportJob } from "@/lib/export-jobs";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile) return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await params;
  const job = getExportJob(id, profile.id);
  if (!job) return new NextResponse("Export job not found or expired.", { status: 404 });
  if (job.phase !== "ready" || !job.zipSizeBytes) return new NextResponse("Export job is not ready.", { status: 409 });

  return new NextResponse(Readable.toWeb(createReadStream(job.outputPath)) as ReadableStream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="creatives-${job.createdAt.slice(0, 10)}.zip"`,
      "Content-Length": String(job.zipSizeBytes),
      "Cache-Control": "private, no-store",
    },
  });
}

