import { NextResponse, type NextRequest } from "next/server";
import { getCurrentProfile } from "@/lib/auth";
import { createExportJob } from "@/lib/export-jobs";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile) return new NextResponse("Unauthorized", { status: 401 });
  try {
    const body = await request.json();
    const ids = Array.isArray(body?.ids) ? body.ids.filter((id: unknown): id is string => typeof id === "string" && id.trim().length > 0) : [];
    return NextResponse.json(await createExportJob(profile, ids), { status: 202 });
  } catch (cause) {
    return new NextResponse(cause instanceof Error ? cause.message : "Could not create export job.", { status: 400 });
  }
}

