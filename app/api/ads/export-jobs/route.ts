import { NextResponse, type NextRequest } from "next/server";
import { getCurrentProfile } from "@/lib/auth";
import { createExportJob } from "@/lib/export-jobs";
import { getDownloadLogs } from "@/lib/download-logs";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile) return new NextResponse("Unauthorized", { status: 401 });
  try {
    const body = await request.json();
    const ids = Array.isArray(body?.ids)
      ? body.ids.filter((id: unknown): id is string => typeof id === "string" && id.trim().length > 0)
      : [];

    const metadata = {
      source: body?.source,
      title: typeof body?.title === "string" ? body.title : undefined,
      campaignId: typeof body?.campaignId === "string" ? body.campaignId : undefined,
      campaignName: typeof body?.campaignName === "string" ? body.campaignName : undefined,
    };

    const snapshot = await createExportJob(profile, ids, metadata);
    return NextResponse.json(snapshot, { status: 202 });
  } catch (cause) {
    return new NextResponse(cause instanceof Error ? cause.message : "Could not create export job.", { status: 400 });
  }
}

export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile) return new NextResponse("Unauthorized", { status: 401 });

  try {
    const logs = await getDownloadLogs();
    // Non-admins only see their own logs if applicable, admins and managers see all logs
    const filtered =
      profile.role === "admin" || profile.role === "manager"
        ? logs
        : logs.filter((log) => log.user_id === profile.id);

    return NextResponse.json(filtered);
  } catch (cause) {
    return new NextResponse(
      cause instanceof Error ? cause.message : "Could not fetch download logs.",
      { status: 500 }
    );
  }
}
