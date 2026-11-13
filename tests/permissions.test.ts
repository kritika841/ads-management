import { describe, expect, it } from "vitest";
import { canBulkAddToCampaign, canDeleteAd, canViewAdInLibrary, filterAdsForProfile } from "@/lib/permissions";
import type { Profile } from "@/lib/types";

describe("canDeleteAd", () => {
  it.each(["admin", "manager"] as const)("allows %s users to delete ads", (role) => {
    expect(canDeleteAd(role)).toBe(true);
  });

  it.each(["content_creator", "editor"] as const)("prevents %s users from deleting ads", (role) => {
    expect(canDeleteAd(role)).toBe(false);
  });
});

describe("canBulkAddToCampaign", () => {
  it("always allows admin users even without settings", () => {
    expect(canBulkAddToCampaign("admin")).toBe(true);
    expect(canBulkAddToCampaign("admin", null)).toBe(true);
    expect(canBulkAddToCampaign("admin", { bulk_add_to_campaign_roles: [] })).toBe(true);
  });

  it("denies creator, editor, and manager by default", () => {
    expect(canBulkAddToCampaign("content_creator")).toBe(false);
    expect(canBulkAddToCampaign("editor")).toBe(false);
    expect(canBulkAddToCampaign("manager")).toBe(false);
    expect(canBulkAddToCampaign("content_creator", { bulk_add_to_campaign_roles: ["admin"] })).toBe(false);
    expect(canBulkAddToCampaign("editor", { bulk_add_to_campaign_roles: ["admin"] })).toBe(false);
  });

  it("allows creator or editor when admin grants permission in settings", () => {
    const settings = {
      bulk_add_to_campaign_roles: ["admin", "content_creator", "editor"]
    };
    expect(canBulkAddToCampaign("content_creator", settings)).toBe(true);
    expect(canBulkAddToCampaign("editor", settings)).toBe(true);
    expect(canBulkAddToCampaign("manager", settings)).toBe(false);
  });

  it("allows manager when granted in settings", () => {
    const settings = {
      bulk_add_to_campaign_roles: ["admin", "manager"]
    };
    expect(canBulkAddToCampaign("manager", settings)).toBe(true);
    expect(canBulkAddToCampaign("content_creator", settings)).toBe(false);
  });
});

describe("filterAdsForProfile & canViewAdInLibrary", () => {
  const himikProfile: Profile = {
    id: "360a1a7a-258a-4591-aee1-7bce60eaee4b",
    name: "Himik",
    email: "himik@satmi.in",
    role: "content_creator",
    avatar_url: null,
    active: true,
    created_at: "2026-01-01T00:00:00Z"
  };

  const editorProfile: Profile = {
    id: "editor-1",
    name: "Editor One",
    email: "editor@satmi.in",
    role: "editor",
    avatar_url: null,
    active: true,
    created_at: "2026-01-01T00:00:00Z"
  };

  const sampleAds = [
    { id: "ad-himik", creator_id: himikProfile.id, editor_id: "editor-1", collaborator_ids: [] },
    { id: "ad-tamanna", creator_id: "6154c289-84bb-4d0d-8543-70bcaf418b9b", editor_id: "editor-1", collaborator_ids: [] },
    { id: "ad-ishika", creator_id: "5c6c462f-ef95-404b-adca-6044c271819c", editor_id: "editor-2", collaborator_ids: [] },
    { id: "ad-collab", creator_id: "5c6c462f-ef95-404b-adca-6044c271819c", editor_id: "editor-2", collaborator_ids: [himikProfile.id] }
  ];

  it("restricts content creators to their own ads or ads where they are a collaborator", () => {
    const visibleToHimik = filterAdsForProfile(sampleAds, himikProfile);
    expect(visibleToHimik.map((ad) => ad.id)).toEqual(["ad-himik", "ad-collab"]);
    expect(canViewAdInLibrary(sampleAds[1], himikProfile)).toBe(false);
  });

  it("restricts editors to ads assigned to them or where they are a collaborator", () => {
    const visibleToEditor = filterAdsForProfile(sampleAds, editorProfile);
    expect(visibleToEditor.map((ad) => ad.id)).toEqual(["ad-himik", "ad-tamanna"]);
  });
});


