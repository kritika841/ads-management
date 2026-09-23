import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth";
import { getExportJobSnapshot, deleteExportJob } from "@/lib/export-jobs";
import { deleteDownloadLog, getDownloadLogById } from "@/lib/download-logs";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile) return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await params;
  const job = await getExportJobSnapshot(id, profile);
  return job ? NextResponse.json(job) : new NextResponse("Export job not found or expired.", { status: 404 });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile) return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await params;

  const log = await getDownloadLogById(id);
  if (!log) {
    return new NextResponse("Download log not found.", { status: 404 });
  }

  // Only the creator or admin/manager can delete the log
  if (log.user_id !== profile.id && profile.role !== "admin" && profile.role !== "manager") {
    return new NextResponse("Forbidden", { status: 403 });
  }

  await deleteExportJob(id);
  await deleteDownloadLog(id);
  return NextResponse.json({ success: true, message: "Download log and file deleted." });
}
