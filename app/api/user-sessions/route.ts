import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth";
import {
  startUserSession,
  heartbeatUserSession,
  closeUserSession,
  type UserSessionActivity
} from "@/lib/user-sessions";

export async function POST(req: Request) {
  try {
    const profile = await getCurrentProfile();
    if (!profile) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let body: {
      action?: string;
      sessionId?: string;
      path?: string;
      actionLabel?: string;
      activities?: UserSessionActivity[];
      endReason?: string;
    } = {};
    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      body = await req.json();
    } else {
      const text = await req.text();
      try {
        body = JSON.parse(text);
      } catch {
        body = {};
      }
    }

    const { action, sessionId, path, actionLabel, activities, endReason } = body;

    // Automatically record attendance touch on user activity (login on first touch after 12 AM, logout on latest touch)
    if (profile.role !== "admin") {
      try {
        const { recordActivityTouch } = await import("@/lib/attendance");
        await recordActivityTouch(profile.id, profile.role, Date.now(), profile.name);
      } catch {
        // Non-fatal
      }
    }

    if (action === "start") {
      const session = await startUserSession({
        userId: profile.id,
        userName: profile.name,
        userRole: profile.role,
        initialPath: path || "/dashboard",
        initialAction: actionLabel
      });
      return NextResponse.json({ ok: true, session });
    }

    if (action === "heartbeat" && sessionId) {
      const session = await heartbeatUserSession({
        sessionId,
        userId: profile.id,
        newActivities: activities as UserSessionActivity[] | undefined
      });
      return NextResponse.json({ ok: true, session });
    }

    if (action === "idle_checkout" && sessionId) {
      const session = await heartbeatUserSession({
        sessionId,
        userId: profile.id,
        isIdleCheckout: true,
        endReason: endReason || "idle_5m"
      });
      return NextResponse.json({ ok: true, session });
    }

    if (action === "close" && sessionId) {
      const session = await closeUserSession({
        sessionId,
        userId: profile.id,
        reason: endReason || "page_closed"
      });
      return NextResponse.json({ ok: true, session });
    }

    return NextResponse.json({ error: "Invalid action or missing sessionId" }, { status: 400 });
  } catch (err) {
    console.error("User session API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
