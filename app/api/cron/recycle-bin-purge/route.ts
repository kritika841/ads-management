import { NextResponse, type NextRequest } from "next/server";
import { purgeExpiredRecycleBin } from "@/lib/recycle-bin";

/** Daily retention sweep: permanently removes Recycle Bin items older than the admin-set window. */
export async function GET(request: NextRequest) {
  const configuredSecret = process.env.CRON_SECRET;
  if (!configuredSecret) {
    return NextResponse.json({ error: "Recycle Bin purge is not configured." }, { status: 503 });
  }

  const authorization = request.headers.get("authorization");
  const suppliedSecret = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : null;
  if (suppliedSecret !== configuredSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const purged = await purgeExpiredRecycleBin();
  return NextResponse.json({ purged });
}
