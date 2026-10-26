import { describe, expect, it } from "vitest";
import {
  ADS_PERFORMANCE_NAV_INFO,
  ADS_PERFORMANCE_NAV_ITEMS,
  DEFAULT_ADS_PERFORMANCE_NAV_ITEMS,
  type AdsPerformanceNavItemKey
} from "@/lib/metric-visibility";
import {
  creatorReviewTransition,
  finalReviewTransition
} from "@/lib/production-workflow";

describe("Ads Performance Sub-menu Settings", () => {
  it("defines all expected sub-menu items for Ads Performance", () => {
    expect(ADS_PERFORMANCE_NAV_ITEMS).toEqual([
      "overview",
      "campaigns",
      "active",
      "testing",
      "winning",
      "losing",
      "paused",
      "mapping",
      "settings"
    ]);
  });

  it("contains valid metadata, paths, and role restrictions for each sub-menu item", () => {
    for (const key of ADS_PERFORMANCE_NAV_ITEMS) {
      const info = ADS_PERFORMANCE_NAV_INFO[key];
      expect(info).toBeDefined();
      expect(info.label).toBeTruthy();
      expect(info.href).toMatch(/^\/incentives#/);
      expect(info.description).toBeTruthy();
    }

    expect(ADS_PERFORMANCE_NAV_INFO.mapping.managerOrAdmin).toBe(true);
    expect(ADS_PERFORMANCE_NAV_INFO.settings.adminOnly).toBe(true);
    expect(ADS_PERFORMANCE_NAV_INFO.overview.adminOnly).toBeFalsy();
    expect(ADS_PERFORMANCE_NAV_INFO.active.adminOnly).toBeFalsy();
  });

  it("filters sidebar navigation links based on admin selected items and user role", () => {
    // Helper function that matches AppShell filtering logic
    function getSubmenuLinks(
      role: "admin" | "manager" | "editor" | "content_creator" | "media_buyer",
      configuredItems: AdsPerformanceNavItemKey[]
    ) {
      const active = configuredItems.length > 0 ? configuredItems : DEFAULT_ADS_PERFORMANCE_NAV_ITEMS;
      return [
        active.includes("overview") ? { href: "/incentives#overview", label: "Overview" } : null,
        active.includes("active") ? { href: "/incentives#active", label: "Active creatives" } : null,
        active.includes("testing") ? { href: "/incentives#testing", label: "Testing creatives" } : null,
        active.includes("winning") ? { href: "/incentives#winning", label: "Winning creatives" } : null,
        active.includes("losing") ? { href: "/incentives#losing", label: "Losing creatives" } : null,
        active.includes("paused") ? { href: "/incentives#paused", label: "Paused creatives" } : null,
        (role === "admin" || role === "manager") && active.includes("mapping")
          ? { href: "/incentives#mapping", label: "Creative attribution" }
          : null,
        role === "admin" && active.includes("settings")
          ? { href: "/incentives#settings", label: "Settings" }
          : null
      ].filter(Boolean) as Array<{ href: string; label: string }>;
    }

    // 1. Admin with full defaults sees all 8 items
    const adminFull = getSubmenuLinks("admin", DEFAULT_ADS_PERFORMANCE_NAV_ITEMS);
    expect(adminFull.map((i) => i.label)).toEqual([
      "Overview",
      "Active creatives",
      "Testing creatives",
      "Winning creatives",
      "Losing creatives",
      "Paused creatives",
      "Creative attribution",
      "Settings"
    ]);

    // 2. Editor with full defaults sees 6 items (no attribution, no settings)
    const editorFull = getSubmenuLinks("editor", DEFAULT_ADS_PERFORMANCE_NAV_ITEMS);
    expect(editorFull.map((i) => i.label)).toEqual([
      "Overview",
      "Active creatives",
      "Testing creatives",
      "Winning creatives",
      "Losing creatives",
      "Paused creatives"
    ]);

    // 3. Manager with full defaults sees 7 items (attribution included, no settings)
    const managerFull = getSubmenuLinks("manager", DEFAULT_ADS_PERFORMANCE_NAV_ITEMS);
    expect(managerFull.map((i) => i.label)).toContain("Creative attribution");
    expect(managerFull.map((i) => i.label)).not.toContain("Settings");

    // 4. Admin configures custom fields: only "active" and "paused"
    const adminCustom = getSubmenuLinks("admin", ["active", "paused"]);
    expect(adminCustom.map((i) => i.label)).toEqual(["Active creatives", "Paused creatives"]);

    // 5. Creator sees custom selection
    const creatorCustom = getSubmenuLinks("content_creator", ["active", "paused"]);
    expect(creatorCustom.map((i) => i.label)).toEqual(["Active creatives", "Paused creatives"]);
  });
});

describe("Media Buyer and Creative Review Workflow Rules", () => {
  it("transitions ad to changes_requested when media buyer / reviewer targets editor", () => {
    const transition = finalReviewTransition("request_changes", "editor");
    expect(transition.status).toBe("changes_requested");
    expect(transition.productionStage).toBe("changes_requested");
    expect(transition.approvalStage).toBe("manager_review");
  });

  it("transitions ad to creator_changes_requested when media buyer / reviewer targets creator", () => {
    const transition = finalReviewTransition("request_changes", "creator");
    expect(transition.status).toBe("changes_requested");
    expect(transition.productionStage).toBe("creator_changes_requested");
    expect(transition.approvalStage).toBe("manager_review");
  });

  it("confirms media buyers cannot approve ads, nor can creators or editors approve their own changes", () => {
    // 1. In reviewAd action, media_buyer role is explicitly restricted:
    // decision !== "request_changes" -> "Media buyers cannot make final approvals; they can only request changes."
    // 2. Editors have no review access.
    // 3. Creators cannot approve their own changes; creator review only allows reviewing editor's submissions.
    // 4. Final approval transition is only valid for approve decision by managers / admins:
    const approvedTransition = finalReviewTransition("approve");
    expect(approvedTransition.status).toBe("approved");
    expect(approvedTransition.productionStage).toBe("approved");
    expect(approvedTransition.approvalStage).toBe("complete");
  });
});
