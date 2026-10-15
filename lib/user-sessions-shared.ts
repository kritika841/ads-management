import { workLogDayKey } from "@/lib/work-log";

export const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes inactivity threshold
export const HEARTBEAT_INTERVAL_MS = 30 * 1000; // 30 seconds active heartbeat

export type UserSessionActivityType = "page_view" | "action" | "idle" | "resume" | "attendance";

export type UserSessionActivity = {
  timestamp: string; // ISO
  type: UserSessionActivityType;
  description: string;
  path?: string;
  metadata?: Record<string, unknown>;
};

export type UserTimeSession = {
  id: string;
  user_id: string;
  user_name: string;
  user_role: string;
  date: string; // YYYY-MM-DD (IST)
  session_started_at: string; // ISO
  session_ended_at: string | null; // ISO
  last_active_at: string; // ISO
  duration_seconds: number;
  end_reason: "active" | "idle_5m" | "page_closed" | "manual_logout" | string;
  activities: UserSessionActivity[];
  created_at: string;
  updated_at: string;
};

/** Returns today's date in IST (Asia/Kolkata). */
export function getTodayIstDate(nowMs: number = Date.now()): string {
  return workLogDayKey(nowMs);
}

/** Formats an ISO timestamp to readable 12-hour IST time (e.g. 10:15 AM). */
export function formatTimeShort(isoString: string | null | undefined): string {
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

/** Formats an ISO timestamp to readable IST date & time. */
export function formatDateTimeIST(isoString: string | null | undefined): string {
  if (!isoString) return "—";
  try {
    return new Intl.DateTimeFormat("en-IN", {
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
      timeZone: "Asia/Kolkata"
    }).format(new Date(isoString));
  } catch {
    return isoString;
  }
}

/** Formats seconds into clean hours/minutes string (e.g. 1h 24m or 35m). */
export function formatSessionDuration(seconds: number): string {
  if (seconds < 60) return "< 1m";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}

/** Friendly label for URL routes. */
export function getFriendlyRouteName(pathname: string): string {
  if (!pathname || pathname === "/") return "Home";
  if (pathname === "/dashboard") return "Dashboard";
  if (pathname === "/library") return "Creative Library";
  if (pathname === "/campaigns") return "Campaigns";
  if (pathname === "/targets") return "Daily Targets";
  if (pathname === "/raw-clips-search") return "Ad Library";
  if (pathname.startsWith("/incentives")) return "Ads Performance";
  if (pathname === "/analytics") return "Analytics";
  if (pathname === "/announcements") return "Announcements";
  if (pathname === "/work-log") return "Team Work Log";
  if (pathname === "/tags") return "Tags";
  if (pathname === "/admin/users") return "User Management";
  if (pathname === "/admin/performance") return "Editor Performance";
  if (pathname === "/admin/products") return "Products";
  if (pathname.startsWith("/admin/settings")) return "Admin Settings";
  if (pathname === "/settings") return "Account Settings";
  if (pathname.startsWith("/ads/")) return "Creative Details & Editing";
  if (pathname === "/recycle-bin") return "Recycle Bin";
  return pathname;
}
