import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock supabase client
const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockEq = vi.fn();
const mockIn = vi.fn();

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
  if (table === "ad_tags") {
    return {
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({
          data: [{ tag_id: "tag-1" }],
          error: null
        }),
        in: vi.fn().mockResolvedValue({
          data: [{ ad_id: "ad-with-campaign", tag_id: "tag-1" }],
          error: null
        })
      }),
      insert: vi.fn().mockResolvedValue({ error: null })
    };
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

  it("assigns unassigned ads directly and clones already assigned ads into the new campaign", async () => {
    // Mock existing ads
    const mockInFn = vi.fn().mockResolvedValue({
      data: [
        {
          id: "ad-unassigned",
          campaign_id: null,
          name: "Unassigned Creative",
          product_id: "prod-1",
          creator_id: "c-1",
          editor_id: "e-1",
          production_stage: "script_writing",
          script_text: "Script content",
          script_html: "<p>Script content</p>",
          notes: "Note",
          drive_link: "https://drive.google.com/test",
          asset_type: "hook",
          format: "video_9_16",
          caption: "Caption",
          headline: "Headline",
          primary_text: "Text",
          target_audience: "Target",
          angle: "Angle",
          hook_type: "Visual",
          concept_source: "manual",
          created_by: "user-1",
          platforms: ["Meta Ads"],
          final_video_url: null,
          final_approved_at: null,
          raw_footage_link: null
        },
        {
          id: "ad-with-campaign",
          campaign_id: "existing-camp-123",
          name: "Already Assigned Creative",
          product_id: "prod-1",
          creator_id: "c-1",
          editor_id: "e-1",
          production_stage: "ready_for_edit",
          script_text: "Assigned Script",
          script_html: "<p>Assigned Script</p>",
          notes: "Note 2",
          drive_link: "https://drive.google.com/test2",
          asset_type: "hook",
          format: "video_9_16",
          caption: "Caption 2",
          headline: "Headline 2",
          primary_text: "Text 2",
          target_audience: "Target 2",
          angle: "Angle 2",
          hook_type: "Problem",
          concept_source: "manual",
          created_by: "user-1",
          platforms: ["Meta Ads", "Google Ads"],
          final_video_url: "https://final.url",
          final_approved_at: "2026-10-08T00:00:00Z",
          raw_footage_link: "https://raw.footage"
        }
      ],
      error: null
    });

    const sampleSourceAd = {
      id: "ad-with-campaign",
      campaign_id: "existing-camp-123",
      name: "Already Assigned Creative",
      product_id: "prod-1",
      creator_id: "c-1",
      editor_id: "e-1",
      production_stage: "ready_for_edit",
      script_text: "Assigned Script",
      script_html: "<p>Assigned Script</p>",
      notes: "Note 2",
      drive_link: "https://drive.google.com/test2",
      asset_type: "hook",
      format: "video_9_16",
      caption: "Caption 2",
      headline: "Headline 2",
      primary_text: "Text 2",
      target_audience: "Target 2",
      angle: "Angle 2",
      hook_type: "Problem",
      concept_source: "manual",
      created_by: "user-1",
      platforms: ["Meta Ads", "Google Ads"],
      final_video_url: "https://final.url",
      final_approved_at: "2026-10-08T00:00:00Z",
      raw_footage_link: "https://raw.footage"
    };

    const chainableEq = vi.fn().mockReturnValue({
      ilike: vi.fn().mockReturnValue({
        neq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null })
        })
      }),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      single: vi.fn().mockResolvedValue({ data: sampleSourceAd, error: null })
    });

    mockSelect.mockImplementation(() => ({
      in: mockInFn,
      eq: chainableEq
    }));



    const mockUpdateEq = vi.fn().mockReturnValue({
      in: vi.fn().mockResolvedValue({ error: null })
    });
    mockUpdate.mockReturnValue({
      eq: mockUpdateEq
    });

    mockInsert.mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: { id: "cloned-ad-new-id" },
          error: null
        })
      })
    });


    const result = await bulkAssignCampaign(["ad-unassigned", "ad-with-campaign"], "target-camp-456");

    expect(result.ok).toBe(true);
    expect(result.count).toBe(2);
    // Directly assigned ads: updated with campaign_id: target-camp-456
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ campaign_id: "target-camp-456" })
    );

    // Ads already in another campaign: cloned into target-camp-456
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        campaign_id: "target-camp-456",
        name: "Already Assigned Creative",
        product_id: "prod-1",
        script_text: "Assigned Script"
      })
    );
  });
});

