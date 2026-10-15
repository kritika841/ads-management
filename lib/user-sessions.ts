import { promises as fs } from "fs";
import path from "path";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  getTodayIstDate,
  getFriendlyRouteName,
  type UserSessionActivity,
  type UserTimeSession
} from "@/lib/user-sessions-shared";

export * from "@/lib/user-sessions-shared";

const LOCAL_STORE_FILE = path.join(process.cwd(), "data", "user-time-sessions.json");

let supabaseTableAvailable: boolean | null = null;

function isSupabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export async function readLocalSessions(): Promise<UserTimeSession[]> {
  try {
    const raw = await fs.readFile(LOCAL_STORE_FILE, "utf-8");
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export async function writeLocalSessions(sessions: UserTimeSession[]): Promise<void> {
  try {
    await fs.mkdir(path.dirname(LOCAL_STORE_FILE), { recursive: true });
    await fs.writeFile(LOCAL_STORE_FILE, JSON.stringify(sessions, null, 2), "utf-8");
  } catch (cause) {
    console.error("Failed to write to local user-time-sessions store:", cause);
  }
}

/**
 * Starts a new user activity session (works for all roles including admin).
 */
export async function startUserSession({
  userId,
  userName,
  userRole,
  initialPath = "/dashboard",
  initialAction,
  nowMs = Date.now()
}: {
  userId: string;
  userName: string;
  userRole: string;
  initialPath?: string;
  initialAction?: string;
  nowMs?: number;
}): Promise<UserTimeSession> {
  const dateKey = getTodayIstDate(nowMs);
  const nowIso = new Date(nowMs).toISOString();

  const activityDesc = initialAction || `Accessed application (${getFriendlyRouteName(initialPath)})`;
  const initialActivities: UserSessionActivity[] = [
    {
      timestamp: nowIso,
      type: "page_view",
      description: activityDesc,
      path: initialPath
    }
  ];

  const newSession: UserTimeSession = {
    id: crypto.randomUUID(),
    user_id: userId,
    user_name: userName || "User",
    user_role: userRole || "creator",
    date: dateKey,
    session_started_at: nowIso,
    session_ended_at: null,
    last_active_at: nowIso,
    duration_seconds: 0,
    end_reason: "active",
    activities: initialActivities,
    created_at: nowIso,
    updated_at: nowIso
  };

  const localList = await readLocalSessions();
  localList.unshift(newSession);
  await writeLocalSessions(localList);

  if (isSupabaseConfigured() && supabaseTableAvailable !== false) {
    try {
      const admin = createSupabaseAdminClient();
      const { error } = await admin.from("user_time_sessions").insert({
        id: newSession.id,
        user_id: newSession.user_id,
        user_name: newSession.user_name,
        user_role: newSession.user_role,
        date: newSession.date,
        session_started_at: newSession.session_started_at,
        session_ended_at: newSession.session_ended_at,
        last_active_at: newSession.last_active_at,
        duration_seconds: newSession.duration_seconds,
        end_reason: newSession.end_reason,
        activities: newSession.activities,
        created_at: newSession.created_at,
        updated_at: newSession.updated_at
      });

      if (error) {
        if (error.code === "PGRST205" || error.message.includes("does not exist")) {
          supabaseTableAvailable = false;
        } else {
          console.warn("Could not insert user_time_sessions in Supabase:", error.message);
        }
      } else {
        supabaseTableAvailable = true;
      }
    } catch (cause) {
      console.warn("Supabase user session insert error:", cause);
    }
  }

  return newSession;
}

/**
 * Updates an ongoing session with heartbeat, page navigation, or 5-min idle checkout.
 */
export async function heartbeatUserSession({
  sessionId,
  userId,
  newActivities = [],
  isIdleCheckout = false,
  endReason,
  nowMs = Date.now()
}: {
  sessionId: string;
  userId: string;
  newActivities?: UserSessionActivity[];
  isIdleCheckout?: boolean;
  endReason?: string;
  nowMs?: number;
}): Promise<UserTimeSession | null> {
  const localList = await readLocalSessions();
  const idx = localList.findIndex((item) => item.id === sessionId && item.user_id === userId);

  let session = idx >= 0 ? localList[idx] : null;

  // If not found locally and Supabase is active, check Supabase
  if (!session && isSupabaseConfigured() && supabaseTableAvailable !== false) {
    try {
      const admin = createSupabaseAdminClient();
      const { data, error } = await admin
        .from("user_time_sessions")
        .select("*")
        .eq("id", sessionId)
        .eq("user_id", userId)
        .maybeSingle();

      if (!error && data) {
        session = data as UserTimeSession;
        localList.unshift(session);
      }
    } catch {
      // Fallback
    }
  }

  if (!session) {
    return null;
  }

  const nowIso = new Date(nowMs).toISOString();
  const startedMs = Date.parse(session.session_started_at);
  const duration = Math.max(0, Math.round((nowMs - startedMs) / 1000));

  const updatedActivities = [...(session.activities || []), ...newActivities];

  if (isIdleCheckout) {
    updatedActivities.push({
      timestamp: nowIso,
      type: "idle",
      description: "Idle on dashboard for 5 minutes — Auto-checked out"
    });
    session = {
      ...session,
      last_active_at: nowIso,
      session_ended_at: nowIso,
      end_reason: endReason || "idle_5m",
      duration_seconds: duration,
      activities: updatedActivities,
      updated_at: nowIso
    };
  } else {
    session = {
      ...session,
      last_active_at: nowIso,
      duration_seconds: duration,
      activities: updatedActivities,
      updated_at: nowIso
    };
  }

  const updatedIdx = localList.findIndex((item) => item.id === sessionId);
  if (updatedIdx >= 0) {
    localList[updatedIdx] = session;
  } else {
    localList.unshift(session);
  }
  await writeLocalSessions(localList);

  if (isSupabaseConfigured() && supabaseTableAvailable !== false) {
    try {
      const admin = createSupabaseAdminClient();
      await admin
        .from("user_time_sessions")
        .update({
          last_active_at: session.last_active_at,
          session_ended_at: session.session_ended_at,
          duration_seconds: session.duration_seconds,
          end_reason: session.end_reason,
          activities: session.activities,
          updated_at: session.updated_at
        })
        .eq("id", sessionId);
    } catch (cause) {
      console.warn("Supabase user session heartbeat error:", cause);
    }
  }

  return session;
}

/**
 * Closes a session cleanly (e.g. tab closed or explicit checkout).
 */
export async function closeUserSession({
  sessionId,
  userId,
  reason = "page_closed",
  nowMs = Date.now()
}: {
  sessionId: string;
  userId: string;
  reason?: string;
  nowMs?: number;
}): Promise<UserTimeSession | null> {
  return heartbeatUserSession({
    sessionId,
    userId,
    isIdleCheckout: true,
    endReason: reason,
    nowMs
  });
}

/**
 * Appends attendance check-in/out to the active session of a user if one exists.
 */
export async function recordAttendanceSessionActivity(
  userId: string,
  action: "check_in" | "check_out",
  description?: string
): Promise<void> {
  const localList = await readLocalSessions();
  const activeSession = localList.find((item) => item.user_id === userId && !item.session_ended_at);
  if (!activeSession) return;

  const nowIso = new Date().toISOString();
  const act: UserSessionActivity = {
    timestamp: nowIso,
    type: "attendance",
    description: description || (action === "check_in" ? "Checked in for daily attendance" : "Checked out of daily attendance")
  };

  await heartbeatUserSession({
    sessionId: activeSession.id,
    userId,
    newActivities: [act]
  });
}

/**
 * Fetches all user sessions within a given date range (YYYY-MM-DD to YYYY-MM-DD).
 */
export async function getUserSessionsForRange(
  from: string,
  to: string,
  userId?: string
): Promise<UserTimeSession[]> {
  if (isSupabaseConfigured() && supabaseTableAvailable !== false) {
    try {
      const admin = createSupabaseAdminClient();
      let query = admin
        .from("user_time_sessions")
        .select("*")
        .gte("date", from)
        .lte("date", to)
        .order("session_started_at", { ascending: true });

      if (userId && userId !== "all") {
        query = query.eq("user_id", userId);
      }

      const { data, error } = await query;
      if (!error && data) {
        supabaseTableAvailable = true;
        return data as UserTimeSession[];
      }
      if (error && (error.code === "PGRST205" || error.message.includes("does not exist"))) {
        supabaseTableAvailable = false;
      }
    } catch {
      // Fallback
    }
  }

  const localList = await readLocalSessions();
  return localList
    .filter((item) => {
      if (userId && userId !== "all" && item.user_id !== userId) return false;
      return item.date >= from && item.date <= to;
    })
    .sort((a, b) => a.session_started_at.localeCompare(b.session_started_at));
}
