import { promises as fs } from "fs";
import path from "path";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export * from "@/lib/attendance-shared";
import { getTodayIstKey, type AttendanceRecord } from "@/lib/attendance-shared";


const LOCAL_STORE_FILE = path.join(process.cwd(), "data", "attendance-logs.json");

let supabaseTableAvailable: boolean | null = null;

function isSupabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export async function readLocalAttendance(): Promise<AttendanceRecord[]> {
  try {
    const raw = await fs.readFile(LOCAL_STORE_FILE, "utf-8");
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export async function writeLocalAttendance(logs: AttendanceRecord[]): Promise<void> {
  try {
    await fs.mkdir(path.dirname(LOCAL_STORE_FILE), { recursive: true });
    await fs.writeFile(LOCAL_STORE_FILE, JSON.stringify(logs, null, 2), "utf-8");
  } catch (cause) {
    console.error("Failed to write to local attendance-logs store:", cause);
  }
}


/**
 * Gets attendance record for a user for a specific date (defaults to today in IST).
 */
export async function getTodayAttendance(userId: string, dateKey?: string): Promise<AttendanceRecord | null> {
  const targetDate = dateKey || getTodayIstKey();

  // Try Supabase first if available
  if (isSupabaseConfigured() && supabaseTableAvailable !== false) {
    try {
      const admin = createSupabaseAdminClient();
      const { data, error } = await admin
        .from("attendance_logs")
        .select("*")
        .eq("user_id", userId)
        .eq("date", targetDate)
        .maybeSingle();

      if (error) {
        if (error.code === "PGRST205" || error.message.includes("does not exist")) {
          supabaseTableAvailable = false;
        } else {
          console.warn("Could not query attendance_logs from Supabase:", error.message);
        }
      } else if (data) {
        supabaseTableAvailable = true;
        return data as AttendanceRecord;
      }
    } catch (cause) {
      console.warn("Supabase attendance query error:", cause);
    }
  }

  // Fallback to local store
  const localList = await readLocalAttendance();
  return localList.find((item) => item.user_id === userId && item.date === targetDate) ?? null;
}

/**
 * Records check-in for a user on today's date in IST.
 */
export async function recordCheckIn(
  userId: string,
  userName: string,
  userRole: string,
  nowMs: number = Date.now()
): Promise<AttendanceRecord> {
  const dateKey = getTodayIstKey(nowMs);
  const nowIso = new Date(nowMs).toISOString();

  // Check existing in local store
  const localList = await readLocalAttendance();
  const existingIdx = localList.findIndex((item) => item.user_id === userId && item.date === dateKey);

  let record: AttendanceRecord;

  if (existingIdx >= 0) {
    record = {
      ...localList[existingIdx],
      user_name: userName || localList[existingIdx].user_name,
      user_role: userRole || localList[existingIdx].user_role,
      check_in_at: localList[existingIdx].check_in_at || nowIso,
      check_out_at: null, // Clear checkout if re-checking in
      updated_at: nowIso
    };
    localList[existingIdx] = record;
  } else {
    record = {
      id: crypto.randomUUID(),
      user_id: userId,
      user_name: userName || "User",
      user_role: userRole || "creator",
      date: dateKey,
      check_in_at: nowIso,
      check_out_at: null,
      created_at: nowIso,
      updated_at: nowIso
    };
    localList.unshift(record);
  }

  await writeLocalAttendance(localList);

  // Try Supabase upsert
  if (isSupabaseConfigured() && supabaseTableAvailable !== false) {
    try {
      const admin = createSupabaseAdminClient();
      const { error } = await admin
        .from("attendance_logs")
        .upsert(
          {
            id: record.id,
            user_id: record.user_id,
            user_name: record.user_name,
            user_role: record.user_role,
            date: record.date,
            check_in_at: record.check_in_at,
            check_out_at: record.check_out_at,
            updated_at: record.updated_at
          },
          { onConflict: "user_id,date" }
        );

      if (error) {
        if (error.code === "PGRST205" || error.message.includes("does not exist")) {
          supabaseTableAvailable = false;
        } else {
          console.warn("Could not upsert attendance to Supabase:", error.message);
        }
      } else {
        supabaseTableAvailable = true;
      }
    } catch (cause) {
      console.warn("Supabase attendance upsert error:", cause);
    }
  }

  return record;
}

/**
 * Records check-out for a user on today's date in IST.
 */
export async function recordCheckOut(
  userId: string,
  nowMs: number = Date.now()
): Promise<AttendanceRecord | null> {
  const dateKey = getTodayIstKey(nowMs);
  const nowIso = new Date(nowMs).toISOString();

  const localList = await readLocalAttendance();
  const existingIdx = localList.findIndex((item) => item.user_id === userId && item.date === dateKey);

  if (existingIdx === -1) {
    // If not checked in yet, create record with check-in and check-out at the same time
    const newRecord: AttendanceRecord = {
      id: crypto.randomUUID(),
      user_id: userId,
      user_name: "User",
      user_role: "creator",
      date: dateKey,
      check_in_at: nowIso,
      check_out_at: nowIso,
      created_at: nowIso,
      updated_at: nowIso
    };
    localList.unshift(newRecord);
    await writeLocalAttendance(localList);
    return newRecord;
  }

  const updatedRecord: AttendanceRecord = {
    ...localList[existingIdx],
    check_out_at: nowIso,
    updated_at: nowIso
  };
  localList[existingIdx] = updatedRecord;
  await writeLocalAttendance(localList);

  if (isSupabaseConfigured() && supabaseTableAvailable !== false) {
    try {
      const admin = createSupabaseAdminClient();
      await admin
        .from("attendance_logs")
        .update({
          check_out_at: updatedRecord.check_out_at,
          updated_at: updatedRecord.updated_at
        })
        .eq("user_id", userId)
        .eq("date", dateKey);
    } catch (cause) {
      console.warn("Supabase attendance check-out error:", cause);
    }
  }

  return updatedRecord;
}

/**
 * Updates a user's check-out time to the latest activity timestamp before 12 AM.
 * Admins are exempt from tracking.
 */
export async function recordActivityTouch(
  userId: string,
  userRole?: string | null,
  nowMs: number = Date.now()
): Promise<AttendanceRecord | null> {
  if (userRole === "admin") {
    return null;
  }

  const dateKey = getTodayIstKey(nowMs);
  const nowIso = new Date(nowMs).toISOString();

  const localList = await readLocalAttendance();
  const existingIdx = localList.findIndex((item) => item.user_id === userId && item.date === dateKey);

  // If user is not checked in today, do not auto-checkout; they must check in first
  if (existingIdx === -1) {
    return null;
  }

  const existing = localList[existingIdx];
  const existingCheckInMs = Date.parse(existing.check_in_at);
  const existingCheckOutMs = existing.check_out_at ? Date.parse(existing.check_out_at) : 0;

  // Advance checkout if this activity is >= check-in time and >= existing checkout timestamp
  if (nowMs >= existingCheckInMs && nowMs >= existingCheckOutMs) {
    const updatedRecord: AttendanceRecord = {
      ...existing,
      check_out_at: nowIso,
      updated_at: nowIso
    };
    localList[existingIdx] = updatedRecord;
    await writeLocalAttendance(localList);

    if (isSupabaseConfigured() && supabaseTableAvailable !== false) {
      try {
        const admin = createSupabaseAdminClient();
        await admin
          .from("attendance_logs")
          .update({
            check_out_at: updatedRecord.check_out_at,
            updated_at: updatedRecord.updated_at
          })
          .eq("user_id", userId)
          .eq("date", dateKey);
      } catch (cause) {
        console.warn("Supabase attendance activity touch error:", cause);
      }
    }

    return updatedRecord;
  }

  return existing;
}

/**
 * Retrieves attendance records within a date range (YYYY-MM-DD to YYYY-MM-DD).

 */
export async function getAttendanceForRange(
  from: string,
  to: string,
  userId?: string
): Promise<AttendanceRecord[]> {
  // Query Supabase if available
  if (isSupabaseConfigured() && supabaseTableAvailable !== false) {
    try {
      const admin = createSupabaseAdminClient();
      let query = admin
        .from("attendance_logs")
        .select("*")
        .gte("date", from)
        .lte("date", to)
        .order("date", { ascending: true });

      if (userId) {
        query = query.eq("user_id", userId);
      }

      const { data, error } = await query;
      if (!error && data) {
        supabaseTableAvailable = true;
        return data as AttendanceRecord[];
      }
      if (error && (error.code === "PGRST205" || error.message.includes("does not exist"))) {
        supabaseTableAvailable = false;
      }
    } catch {
      // Fall through to local
    }
  }

  // Fallback to local store
  const localList = await readLocalAttendance();
  return localList.filter((item) => {
    if (userId && item.user_id !== userId) return false;
    return item.date >= from && item.date <= to;
  });
}
