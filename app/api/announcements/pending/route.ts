import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth";
import { getUnacknowledgedAnnouncements } from "@/lib/announcements";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const profile = await getCurrentProfile();
    if (!profile) {
      return NextResponse.json(
        { ok: false, announcements: [] },
        {
          status: 401,
          headers: {
            "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate"
          }
        }
      );
    }

    const announcements = await getUnacknowledgedAnnouncements({
      id: profile.id,
      role: profile.role
    });

    return NextResponse.json(
      { ok: true, announcements },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate"
        }
      }
    );
  } catch (error) {
    console.error("Error in GET /api/announcements/pending:", error);
    return NextResponse.json(
      { ok: false, announcements: [] },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate"
        }
      }
    );
  }
}
