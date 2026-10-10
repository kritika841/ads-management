import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCurrentProfile = vi.fn();
const mockRequireProfile = vi.fn();

vi.mock("@/lib/auth", () => ({
  getCurrentProfile: () => mockCurrentProfile(),
  requireProfile: () => mockRequireProfile()
}));

const mockGetTodayAttendance = vi.fn();
const mockRecordCheckIn = vi.fn();
const mockRecordCheckOut = vi.fn();

vi.mock("@/lib/attendance", () => ({
  getTodayAttendance: (userId: string) => mockGetTodayAttendance(userId),
  recordCheckIn: (userId: string, name: string, role: string) => mockRecordCheckIn(userId, name, role),
  recordCheckOut: (userId: string) => mockRecordCheckOut(userId)
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn()
}));

import {
  getTodayAttendanceStatus,
  checkInAttendance,
  checkOutAttendance
} from "@/app/actions/attendance";

describe("Attendance Server Actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exempts admins from check-in requirement", async () => {
    mockCurrentProfile.mockResolvedValue({
      id: "admin-1",
      name: "Admin Boss",
      role: "admin"
    });

    const status = await getTodayAttendanceStatus();
    expect(status.isRequired).toBe(false);
    expect(status.checkedIn).toBe(true);
    expect(mockGetTodayAttendance).not.toHaveBeenCalled();
  });

  it("requires check-in for non-admin user who has not checked in yet", async () => {
    mockCurrentProfile.mockResolvedValue({
      id: "creator-1",
      name: "Creative Creator",
      role: "content_creator"
    });
    mockGetTodayAttendance.mockResolvedValue(null);

    const status = await getTodayAttendanceStatus();
    expect(status.isRequired).toBe(true);
    expect(status.checkedIn).toBe(false);
    expect(status.isCheckedOut).toBe(false);
    expect(status.record).toBeNull();
  });

  it("reflects checked-in status when a non-admin user has checked in", async () => {
    mockCurrentProfile.mockResolvedValue({
      id: "editor-1",
      name: "Video Editor",
      role: "editor"
    });
    mockGetTodayAttendance.mockResolvedValue({
      id: "att-1",
      user_id: "editor-1",
      user_name: "Video Editor",
      user_role: "editor",
      date: "2026-10-09",
      check_in_at: "2026-10-09T09:30:00+05:30",
      check_out_at: null,
      created_at: "2026-10-09T09:30:00+05:30",
      updated_at: "2026-10-09T09:30:00+05:30"
    });

    const status = await getTodayAttendanceStatus();
    expect(status.isRequired).toBe(true);
    expect(status.checkedIn).toBe(true);
    expect(status.isCheckedOut).toBe(false);
    expect(status.record?.check_in_at).toBe("2026-10-09T09:30:00+05:30");
  });

  it("checks in non-admin user successfully", async () => {
    mockRequireProfile.mockResolvedValue({
      id: "creator-1",
      name: "Creative Creator",
      role: "content_creator"
    });
    mockRecordCheckIn.mockResolvedValue({
      id: "att-new",
      user_id: "creator-1",
      check_in_at: "2026-10-09T10:00:00+05:30"
    });

    const result = await checkInAttendance();
    expect(result.ok).toBe(true);
    expect(mockRecordCheckIn).toHaveBeenCalledWith("creator-1", "Creative Creator", "content_creator");
  });

  it("records checkout successfully", async () => {
    mockRequireProfile.mockResolvedValue({
      id: "creator-1",
      name: "Creative Creator",
      role: "content_creator"
    });
    mockRecordCheckOut.mockResolvedValue({
      id: "att-existing",
      user_id: "creator-1",
      check_out_at: "2026-10-09T19:00:00+05:30"
    });

    const result = await checkOutAttendance();
    expect(result.ok).toBe(true);
    expect(mockRecordCheckOut).toHaveBeenCalledWith("creator-1");
  });
});
