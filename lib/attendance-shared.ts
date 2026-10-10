import { workLogDayKey } from "@/lib/work-log";

export type AttendanceRecord = {
  id: string;
  user_id: string;
  user_name: string;
  user_role: string;
  date: string; // YYYY-MM-DD (IST)
  check_in_at: string; // ISO
  check_out_at: string | null; // ISO
  created_at: string;
  updated_at: string;
};

/** Returns the today date string in Asia/Kolkata (IST) timezone. */
export function getTodayIstKey(nowMs: number = Date.now()): string {
  return workLogDayKey(nowMs);
}

/** Formats an ISO timestamp into a readable 12-hour IST time string (e.g. 09:30 AM). */
export function formatAttendanceTime(isoString: string | null | undefined): string {
  if (!isoString) return "—";
  try {
    return new Intl.DateTimeFormat("en-IN", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: "Asia/Kolkata"
    }).format(new Date(isoString));
  } catch {
    return isoString;
  }
}

/** Formats an ISO timestamp into full date and time in IST (e.g. 9 Oct 2026, 09:30 AM). */
export function formatAttendanceDateTime(isoString: string | null | undefined): string {
  if (!isoString) return "—";
  try {
    return new Intl.DateTimeFormat("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: "Asia/Kolkata"
    }).format(new Date(isoString));
  } catch {
    return isoString;
  }
}
