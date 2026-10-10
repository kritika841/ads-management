"use server";

import { revalidatePath } from "next/cache";
import { getCurrentProfile, requireProfile } from "@/lib/auth";
import {
  getTodayAttendance,
  recordCheckIn,
  recordCheckOut,
  type AttendanceRecord
} from "@/lib/attendance";

export type TodayAttendanceStatus = {
  isRequired: boolean;
  checkedIn: boolean;
  isCheckedOut: boolean;
  record: AttendanceRecord | null;
  role: string | null;
  userName: string | null;
};

/**
 * Returns attendance status for the current session user for today.
 * Admins are exempt from check-in (isRequired = false).
 */
export async function getTodayAttendanceStatus(): Promise<TodayAttendanceStatus> {
  const profile = await getCurrentProfile();
  if (!profile) {
    return {
      isRequired: false,
      checkedIn: false,
      isCheckedOut: false,
      record: null,
      role: null,
      userName: null
    };
  }

  // Admin does not need to check in
  if (profile.role === "admin") {
    return {
      isRequired: false,
      checkedIn: true,
      isCheckedOut: false,
      record: null,
      role: profile.role,
      userName: profile.name
    };
  }

  const record = await getTodayAttendance(profile.id);
  const checkedIn = Boolean(record?.check_in_at);
  const isCheckedOut = Boolean(record?.check_out_at);

  return {
    isRequired: true,
    checkedIn,
    isCheckedOut,
    record,
    role: profile.role,
    userName: profile.name
  };
}

/**
 * Checks in the current user for today. Non-dismissable for non-admins.
 */
export async function checkInAttendance() {
  const profile = await requireProfile();

  if (profile.role === "admin") {
    return { ok: true, message: "Admin users do not need to check in." };
  }

  try {
    const record = await recordCheckIn(profile.id, profile.name, profile.role);
    revalidatePath("/work-log");
    revalidatePath("/dashboard");
    return { ok: true, record };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Check-in failed" };
  }
}

/**
 * Checks out the current user for today.
 */
export async function checkOutAttendance() {
  const profile = await requireProfile();

  try {
    const record = await recordCheckOut(profile.id);
    revalidatePath("/work-log");
    revalidatePath("/dashboard");
    return { ok: true, record };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Check-out failed" };
  }
}

/**
 * Updates current non-admin user's check-out time with their latest activity timestamp before 12 AM.
 * Admins are exempt from tracking.
 */
export async function recordAttendanceActivityTouch() {
  const profile = await getCurrentProfile();
  if (!profile || profile.role === "admin") {
    return { ok: true, skipped: true };
  }

  try {
    const { recordActivityTouch } = await import("@/lib/attendance");
    const record = await recordActivityTouch(profile.id, profile.role);
    return { ok: true, record };
  } catch {
    return { ok: false };
  }
}

