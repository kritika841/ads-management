"use server";

import { getCurrentProfile, requireProfile } from "@/lib/auth";
import {
  getUserSessionsForRange,
  startUserSession,
  heartbeatUserSession,
  closeUserSession,
  type UserTimeSession
} from "@/lib/user-sessions";

/**
 * Retrieves user sessions within a date range. Admin-only.
 */
export async function getAdminUserSessions(from: string, to: string, userId?: string): Promise<UserTimeSession[]> {
  const profile = await requireProfile();
  if (profile.role !== "admin") {
    throw new Error("Unauthorized: Only admins can view user time sessions.");
  }

  return getUserSessionsForRange(from, to, userId);
}

/**
 * Server action to record a session start.
 */
export async function recordSessionStart(path: string = "/dashboard", actionLabel?: string) {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Not logged in" };

  try {
    const session = await startUserSession({
      userId: profile.id,
      userName: profile.name,
      userRole: profile.role,
      initialPath: path,
      initialAction: actionLabel
    });
    return { ok: true, session };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to start session" };
  }
}

/**
 * Server action to record 5m idle checkout.
 */
export async function recordIdleCheckout(sessionId: string) {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Not logged in" };

  try {
    const session = await heartbeatUserSession({
      sessionId,
      userId: profile.id,
      isIdleCheckout: true,
      endReason: "idle_5m"
    });
    return { ok: true, session };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to record idle checkout" };
  }
}
