"use client";

import type { Profile } from "@/lib/types";

/**
 * Attendance header widget is removed as manual check-in/out buttons are removed:
 * - First login/activity after 12 AM IST is recorded as login.
 * - Last activity touch of the day is recorded as logout.
 */
export function AttendanceHeaderWidget({ profile: _profile }: { profile: Profile }) {
  return null;
}
