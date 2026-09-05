import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth";
import { getExportJobSnapshot } from "@/lib/export-jobs";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile) return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await params;
  const job = getExportJobSnapshot(id, profile.id);
  return job ? NextResponse.json(job) : new NextResponse("Export job not found or expired.", { status: 404 });
}

