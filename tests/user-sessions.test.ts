import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  startUserSession,
  heartbeatUserSession,
  closeUserSession,
  getUserSessionsForRange,
  recordAttendanceSessionActivity,
  writeLocalSessions
} from "@/lib/user-sessions";
import {
  formatSessionDuration,
  formatTimeShort,
  getFriendlyRouteName
} from "@/lib/user-sessions-shared";

describe("User Sessions & Idle Time Logs", () => {
  const adminUser = {
    id: "admin-uuid-1",
    name: "Aman Admin",
    role: "admin"
  };

  const creatorUser = {
    id: "creator-uuid-2",
    name: "Ria Creator",
    role: "content_creator"
  };

  beforeEach(async () => {
    // Reset local sessions file for tests
    await writeLocalSessions([]);
  });

  it("starts a fresh session for non-admin user on application access", async () => {
    const startMs = Date.parse("2026-10-12T04:30:00.000Z"); // 10:00 AM IST
    const session = await startUserSession({
      userId: creatorUser.id,
      userName: creatorUser.name,
      userRole: creatorUser.role,
      initialPath: "/dashboard",
      nowMs: startMs
    });

    expect(session.id).toBeDefined();
    expect(session.user_id).toBe(creatorUser.id);
    expect(session.user_name).toBe("Ria Creator");
    expect(session.user_role).toBe("content_creator");
    expect(session.date).toBe("2026-10-12");
    expect(session.session_ended_at).toBeNull();
    expect(session.end_reason).toBe("active");
    expect(session.activities.length).toBeGreaterThanOrEqual(1);
    expect(session.activities[0].path).toBe("/dashboard");
    expect(session.activities[0].description).toContain("Dashboard");
  });

  it("records session for admin users too without requiring attendance check-in", async () => {
    const startMs = Date.parse("2026-10-12T05:00:00.000Z"); // 10:30 AM IST
    const adminSession = await startUserSession({
      userId: adminUser.id,
      userName: adminUser.name,
      userRole: adminUser.role,
      initialPath: "/admin/users",
      initialAction: "Accessed User Management",
      nowMs: startMs
    });

    expect(adminSession.user_role).toBe("admin");
    expect(adminSession.activities[0].description).toBe("Accessed User Management");
    expect(adminSession.session_ended_at).toBeNull();
  });

  it("updates last_active_at and tracks activities on heartbeat/navigation", async () => {
    const startMs = Date.parse("2026-10-12T04:30:00.000Z");
    const session = await startUserSession({
      userId: creatorUser.id,
      userName: creatorUser.name,
      userRole: creatorUser.role,
      initialPath: "/dashboard",
      nowMs: startMs
    });

    const navMs = startMs + 2 * 60 * 1000; // 2 minutes later
    const updated = await heartbeatUserSession({
      sessionId: session.id,
      userId: creatorUser.id,
      newActivities: [
        {
          timestamp: new Date(navMs).toISOString(),
          type: "page_view",
          description: "Navigated to Creative Library",
          path: "/library"
        }
      ],
      nowMs: navMs
    });

    expect(updated).not.toBeNull();
    expect(updated!.duration_seconds).toBe(120); // 2 minutes
    expect(updated!.activities.length).toBe(2);
    expect(updated!.activities[1].description).toBe("Navigated to Creative Library");
  });

  it("checks out session automatically when 5 minutes idle without prompting login", async () => {
    const startMs = Date.parse("2026-10-12T04:30:00.000Z");
    const session = await startUserSession({
      userId: creatorUser.id,
      userName: creatorUser.name,
      userRole: creatorUser.role,
      initialPath: "/dashboard",
      nowMs: startMs
    });

    // 5 minutes later idle checkout occurs
    const idleCheckoutMs = startMs + 5 * 60 * 1000;
    const closed = await heartbeatUserSession({
      sessionId: session.id,
      userId: creatorUser.id,
      isIdleCheckout: true,
      endReason: "idle_5m",
      nowMs: idleCheckoutMs
    });

    expect(closed).not.toBeNull();
    expect(closed!.session_ended_at).toBe(new Date(idleCheckoutMs).toISOString());
    expect(closed!.end_reason).toBe("idle_5m");
    expect(closed!.duration_seconds).toBe(300); // 5 minutes
    expect(closed!.activities.some((a) => a.type === "idle")).toBe(true);

    // After idle checkout, when user interacts again, a fresh session is started seamlessly
    const resumeMs = idleCheckoutMs + 10 * 60 * 1000; // 10 minutes later user comes back
    const freshSession = await startUserSession({
      userId: creatorUser.id,
      userName: creatorUser.name,
      userRole: creatorUser.role,
      initialPath: "/dashboard",
      initialAction: "Resumed activity after idle",
      nowMs: resumeMs
    });

    expect(freshSession.id).not.toBe(session.id);
    expect(freshSession.session_ended_at).toBeNull();
    expect(freshSession.activities[0].description).toBe("Resumed activity after idle");
  });

  it("appends daily attendance check-in and check-out to active user session", async () => {
    const startMs = Date.parse("2026-10-12T04:30:00.000Z");
    const session = await startUserSession({
      userId: creatorUser.id,
      userName: creatorUser.name,
      userRole: creatorUser.role,
      initialPath: "/dashboard",
      nowMs: startMs
    });

    await recordAttendanceSessionActivity(creatorUser.id, "check_in");
    await recordAttendanceSessionActivity(creatorUser.id, "check_out");

    const range = await getUserSessionsForRange("2026-10-12", "2026-10-12", creatorUser.id);
    expect(range.length).toBe(1);
    const activities = range[0].activities;
    expect(activities.some((a) => a.description.includes("Checked in for daily attendance"))).toBe(true);
    expect(activities.some((a) => a.description.includes("Checked out of daily attendance"))).toBe(true);
  });

  it("correctly filters sessions by date range and user", async () => {
    // Day 1: Creator session
    await startUserSession({
      userId: creatorUser.id,
      userName: creatorUser.name,
      userRole: creatorUser.role,
      nowMs: Date.parse("2026-10-10T05:00:00Z")
    });

    // Day 2: Admin session
    await startUserSession({
      userId: adminUser.id,
      userName: adminUser.name,
      userRole: adminUser.role,
      nowMs: Date.parse("2026-10-11T05:00:00Z")
    });

    // Day 3: Creator session
    await startUserSession({
      userId: creatorUser.id,
      userName: creatorUser.name,
      userRole: creatorUser.role,
      nowMs: Date.parse("2026-10-12T05:00:00Z")
    });

    const allDay2And3 = await getUserSessionsForRange("2026-10-11", "2026-10-12");
    expect(allDay2And3.length).toBe(2);

    const creatorOnlyDay2And3 = await getUserSessionsForRange("2026-10-11", "2026-10-12", creatorUser.id);
    expect(creatorOnlyDay2And3.length).toBe(1);
    expect(creatorOnlyDay2And3[0].user_name).toBe("Ria Creator");
  });

  it("formats session durations and route names accurately", () => {
    expect(formatSessionDuration(45)).toBe("< 1m");
    expect(formatSessionDuration(120)).toBe("2m");
    expect(formatSessionDuration(3600)).toBe("1h");
    expect(formatSessionDuration(3660)).toBe("1h 1m");
    expect(formatSessionDuration(7200)).toBe("2h");

    expect(getFriendlyRouteName("/dashboard")).toBe("Dashboard");
    expect(getFriendlyRouteName("/library")).toBe("Creative Library");
    expect(getFriendlyRouteName("/targets")).toBe("Daily Targets");
    expect(getFriendlyRouteName("/work-log")).toBe("Team Work Log");
    expect(getFriendlyRouteName("/admin/users")).toBe("User Management");
    expect(getFriendlyRouteName("/ads/123")).toBe("Creative Details & Editing");
  });
});
