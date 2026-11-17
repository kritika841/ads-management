import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock supabase client
const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockUpsert = vi.fn();

const mockFrom = vi.fn((table: string) => {
  if (table === "campaigns") {
    return {
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: "target-camp-456", name: "Target Campaign", active: true },
            error: null
          })
        })
      })
    };
  }
  if (table === "ads") {
    return {
      select: mockSelect,
      update: mockUpdate,
      insert: mockInsert
    };
  }
  if (table === "ad_campaigns") {
    return { upsert: mockUpsert };
  }

  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        single: vi.fn().mockResolvedValue({ data: null, error: null })
      })
    }),
    insert: mockInsert,
    update: mockUpdate
  };
});


vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn().mockImplementation(() =>
    Promise.resolve({
      from: mockFrom
    })
  )
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn().mockImplementation(() => ({
    from: mockFrom
  }))
}));

vi.mock("@/lib/auth", () => ({
  getCurrentProfile: vi.fn().mockResolvedValue({ id: "user-1", role: "admin", name: "Admin" }),
  requireProfile: vi.fn().mockResolvedValue({ id: "user-1", role: "admin", name: "Admin" }),
  requireRole: vi.fn().mockResolvedValue({ id: "user-1", role: "admin", name: "Admin" }),
  getSessionUser: vi.fn().mockResolvedValue({ id: "user-1" })
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn()
}));

import { bulkAssignCampaign } from "@/app/actions/ads";

describe("bulkAssignCampaign multi-campaign support", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("links assigned creatives without creating another ad", async () => {
    mockSelect.mockReturnValue({ in: vi.fn().mockResolvedValue({ data: [
      { id: "ad-unassigned", campaign_id: null, name: "Unassigned" },
      { id: "ad-assigned", campaign_id: "original-campaign", name: "Assigned" }
    ], error: null }) });
    mockUpdate.mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
    mockUpsert.mockResolvedValue({ error: null });

    const result = await bulkAssignCampaign(["ad-unassigned", "ad-assigned"], "target-camp-456");

    expect(result.ok).toBe(true);
    expect(result.count).toBe(2);
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ campaign_id: "target-camp-456" }));
    expect(mockUpsert).toHaveBeenCalledWith(
      { ad_id: "ad-assigned", campaign_id: "target-camp-456" },
      { onConflict: "ad_id,campaign_id", ignoreDuplicates: true }
    );
    expect(mockInsert).not.toHaveBeenCalledWith(expect.objectContaining({ name: "Assigned" }));
  });
});
