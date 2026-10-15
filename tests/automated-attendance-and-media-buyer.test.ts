import { describe, it, expect, beforeEach, vi } from "vitest";

const mockRequireProfile = vi.fn();
const mockCurrentProfile = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireProfile: () => mockRequireProfile(),
  getCurrentProfile: () => mockCurrentProfile(),
  canReview: vi.fn().mockReturnValue(true)
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn()
}));

const mockSingle = vi.fn();
const mockSelect = vi.fn(() => ({ eq: vi.fn(() => ({ single: mockSingle, maybeSingle: mockSingle, limit: vi.fn(() => ({ maybeSingle: mockSingle, data: [] })) })) }));
const mockFrom: any = vi.fn((_table?: string) => ({
  select: vi.fn((fields) => ({
    eq: vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve({ data: [] }))
        })),
        limit: vi.fn(() => Promise.resolve({ data: [] }))
      })),
      single: mockSingle,
      maybeSingle: mockSingle
    }))
  })),
  update: vi.fn(() => ({
    eq: vi.fn(() => Promise.resolve({ error: null }))
  })),
  insert: vi.fn(() => Promise.resolve({ error: null })),
  upsert: vi.fn(() => Promise.resolve({ error: null })),
  rpc: vi.fn(() => Promise.resolve({ error: null }))
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: mockFrom,
    rpc: vi.fn(() => Promise.resolve({ error: null }))
  })
}));

import { recordActivityTouch, getTodayIstKey } from "@/lib/attendance";
import { promises as fs } from "fs";
import path from "path";
import { reviewAd } from "@/app/actions/ads";
import { AttendanceHeaderWidget } from "@/components/attendance/attendance-header-widget";
import { AttendancePromptModal } from "@/components/attendance/attendance-prompt-modal";

const LOCAL_STORE_FILE = path.join(process.cwd(), "data", "attendance-logs.json");

describe("Automated Attendance Tracking (12 AM Login & Last Activity Logout)", () => {
  beforeEach(async () => {
    try {
      await fs.writeFile(LOCAL_STORE_FILE, JSON.stringify([], null, 2), "utf-8");
    } catch {
      // safe
    }
  });

  it("automatically creates login and initial checkout on first activity touch after 12 AM", async () => {
    const firstTouchMs = new Date("2026-10-13T19:30:00.000Z").getTime();
    const dateKey = getTodayIstKey(firstTouchMs);
    expect(dateKey).toBe("2026-10-14");

    const record = await recordActivityTouch("user-creator-1", "content_creator", firstTouchMs, "Alice Creator");
    expect(record).not.toBeNull();
    expect(record?.user_id).toBe("user-creator-1");
    expect(record?.user_name).toBe("Alice Creator");
    expect(record?.date).toBe("2026-10-14");
    expect(record?.check_in_at).toBe(new Date(firstTouchMs).toISOString());
    expect(record?.check_out_at).toBe(new Date(firstTouchMs).toISOString());
  });

  it("updates checkout to the latest activity timestamp on subsequent touches throughout the day", async () => {
    const firstTouchMs = new Date("2026-10-13T19:30:00.000Z").getTime();
    const secondTouchMs = new Date("2026-10-14T04:30:00.000Z").getTime();
    const thirdTouchMs = new Date("2026-10-14T12:30:00.000Z").getTime();

    const rec1 = await recordActivityTouch("user-editor-1", "editor", firstTouchMs, "Bob Editor");
    expect(rec1?.check_in_at).toBe(new Date(firstTouchMs).toISOString());
    expect(rec1?.check_out_at).toBe(new Date(firstTouchMs).toISOString());

    const rec2 = await recordActivityTouch("user-editor-1", "editor", secondTouchMs, "Bob Editor");
    expect(rec2?.check_in_at).toBe(new Date(firstTouchMs).toISOString());
    expect(rec2?.check_out_at).toBe(new Date(secondTouchMs).toISOString());

    const rec3 = await recordActivityTouch("user-editor-1", "editor", thirdTouchMs, "Bob Editor");
    expect(rec3?.check_in_at).toBe(new Date(firstTouchMs).toISOString());
    expect(rec3?.check_out_at).toBe(new Date(thirdTouchMs).toISOString());
  });

  it("exempts admins from attendance tracking", async () => {
    const nowMs = Date.now();
    const adminRecord = await recordActivityTouch("admin-user-1", "admin", nowMs, "Boss Admin");
    expect(adminRecord).toBeNull();
  });

  it("rolls over to a new login on the next day after 12:00 AM midnight", async () => {
    const day1TouchMs = new Date("2026-10-13T18:00:00.000Z").getTime();
    const day1Key = getTodayIstKey(day1TouchMs);
    expect(day1Key).toBe("2026-10-13");

    const recDay1 = await recordActivityTouch("user-creator-2", "content_creator", day1TouchMs, "Charlie");
    expect(recDay1?.date).toBe("2026-10-13");
    expect(recDay1?.check_in_at).toBe(new Date(day1TouchMs).toISOString());

    const day2TouchMs = new Date("2026-10-13T19:00:00.000Z").getTime();
    const day2Key = getTodayIstKey(day2TouchMs);
    expect(day2Key).toBe("2026-10-14");

    const recDay2 = await recordActivityTouch("user-creator-2", "content_creator", day2TouchMs, "Charlie");
    expect(recDay2?.date).toBe("2026-10-14");
    expect(recDay2?.check_in_at).toBe(new Date(day2TouchMs).toISOString());
    expect(recDay2?.check_out_at).toBe(new Date(day2TouchMs).toISOString());
  });
});

describe("Attendance UI Removal Verification", () => {
  it("renders null for AttendancePromptModal so users are never prompted to check in", () => {
    const result = AttendancePromptModal({ profile: { id: "u-1", name: "User", role: "editor" } as any });
    expect(result).toBeNull();
  });

  it("renders null for AttendanceHeaderWidget so checkin/checkout buttons are removed", () => {
    const result = AttendanceHeaderWidget({ profile: { id: "u-1", name: "User", role: "editor" } as any });
    expect(result).toBeNull();
  });
});

describe("Media Buyer Review & Change Approval Logic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects change requests targeting media_buyer as they are not primary creators", async () => {
    mockRequireProfile.mockResolvedValue({
      id: "admin-1",
      name: "Admin User",
      role: "admin",
      email: "admin@example.com"
    });

    const result = await reviewAd("00000000-0000-0000-0000-000000000001", "request_changes", "Need fix", "media_buyer" as any);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("not primary creators");
  });

  it("rejects media buyer approving when they have not requested changes", async () => {
    mockRequireProfile.mockResolvedValue({
      id: "mb-new-1",
      name: "New Media Buyer",
      role: "media_buyer",
      email: "mb@example.com"
    });

    mockSingle.mockResolvedValue({
      data: {
        id: "00000000-0000-0000-0000-000000000001",
        name: "Test Ad",
        status: "pending_review",
        production_stage: "final_review"
      },
      error: null
    });

    const result = await reviewAd("00000000-0000-0000-0000-000000000001", "approve", "Approved");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Media buyers cannot make final approvals; they can only approve changes they previously requested");
  });

  it("allows media buyer to approve changes when they previously requested changes on the ad", async () => {
    mockRequireProfile.mockResolvedValue({
      id: "mb-req-1",
      name: "Media Buyer Req",
      role: "media_buyer",
      email: "mbreq@example.com"
    });

    mockSingle.mockResolvedValue({
      data: {
        id: "00000000-0000-0000-0000-000000000001",
        name: "Test Ad With Requested Changes",
        status: "pending_review",
        production_stage: "creator_review"
      },
      error: null
    });

    // Mock previous change request existence
    mockFrom.mockImplementation((table: string) => {
      if (table === "review_actions") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  limit: vi.fn(() => Promise.resolve({ data: [{ id: "rev-action-1" }] }))
                }))
              }))
            }))
          })),
          insert: vi.fn(() => Promise.resolve({ error: null }))
        } as any;
      }
      if (table === "ads") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: () => Promise.resolve({
                data: {
                  id: "00000000-0000-0000-0000-000000000001",
                  name: "Test Ad With Requested Changes",
                  status: "pending_review",
                  production_stage: "creator_review"
                },
                error: null
              })
            }))
          })),
          update: vi.fn(() => ({
            eq: vi.fn(() => Promise.resolve({ error: null }))
          }))
        } as any;
      }
      if (table === "activity_logs") {
        return {
          insert: vi.fn(() => Promise.resolve({ error: null }))
        } as any;
      }
      return {
        select: vi.fn(() => ({
          in: vi.fn(() => ({
            eq: vi.fn(() => Promise.resolve({ data: [] }))
          })),
          eq: vi.fn(() => Promise.resolve({ data: [] }))
        })),
        insert: vi.fn(() => Promise.resolve({ error: null })),
        update: vi.fn(() => ({
          eq: vi.fn(() => Promise.resolve({ error: null }))
        }))
      } as any;
    });

    const result = await reviewAd("00000000-0000-0000-0000-000000000001", "approve", "Looks great now!");
    expect(result.ok).toBe(true);
  });
});
