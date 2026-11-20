import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/auth";
import {
  getManualTodayAttendance,
  manualCheckInWithTasks,
  manualCheckOutWithTasks
} from "@/lib/attendance";

export async function GET() {
  try {
    const profile = await getCurrentProfile();
    if (!profile) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const status = await getManualTodayAttendance(profile.id);
    return NextResponse.json({ ok: true, ...status }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("GET /api/attendance error:", err);
    return NextResponse.json({ error: "Failed to load attendance status" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const profile = await getCurrentProfile();
    if (!profile) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "").trim().toLowerCase();

    if (action !== "checkin" && action !== "checkout") {
      return NextResponse.json(
        { error: "Invalid action. Expected checkin or checkout." },
        { status: 400 }
      );
    }

    const result =
      action === "checkin"
        ? await manualCheckInWithTasks(profile.id, profile.name, profile.role)
        : await manualCheckOutWithTasks(profile.id, profile.name, profile.role);

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    try {
      const { recordAttendanceSessionActivity } = await import("@/lib/user-sessions");
      await recordAttendanceSessionActivity(
        profile.id,
        action === "checkin" ? "check_in" : "check_out"
      );
    } catch {
      // non-fatal
    }

    revalidatePath("/work-log");
    revalidatePath("/dashboard");

    return NextResponse.json(
      { ok: true, ...result.status },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("POST /api/attendance error:", err);
    return NextResponse.json({ error: "Failed to update attendance" }, { status: 500 });
  }
}
