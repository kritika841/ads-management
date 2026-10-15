"use client";

import type { Profile } from "@/lib/types";

/**
 * Attendance prompt modal is removed as attendance tracking is now fully automated:
 * - First login/activity after 12 AM IST is recorded as login.
 * - Last activity touch of the day is recorded as logout.
 */
export function AttendancePromptModal({ profile: _profile }: { profile: Profile }) {
  return null;
}
