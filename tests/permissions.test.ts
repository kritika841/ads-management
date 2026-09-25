import { describe, expect, it } from "vitest";
import { canBulkAddToCampaign, canDeleteAd } from "@/lib/permissions";

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

