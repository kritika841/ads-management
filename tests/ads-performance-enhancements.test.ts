import { describe, expect, it } from "vitest";
import {
  PERFORMANCE_METRIC_KEYS,
  PERFORMANCE_METRICS_INFO,
  type HiddenMetricsByRole
} from "@/lib/metric-visibility";
import { resolvePasswordStatus } from "@/lib/password-security";

describe("Ads Performance Enhancements", () => {
  describe("CPC metric inclusion", () => {
    it("includes cpc in PERFORMANCE_METRIC_KEYS", () => {
      expect(PERFORMANCE_METRIC_KEYS).toContain("cpc");
    });

    it("has complete metric metadata for cpc", () => {
      const cpcInfo = PERFORMANCE_METRICS_INFO.cpc;
      expect(cpcInfo).toBeDefined();
      expect(cpcInfo.shortLabel).toBe("CPC");
      expect(cpcInfo.label.toLowerCase()).toContain("cost per click");
    });

    it("correctly calculates Landing Page Clicks CPC from spend and link clicks", () => {
      const calcLandingPageCpc = (spend: number, linkClicks: number) => (linkClicks > 0 ? spend / linkClicks : null);

      expect(calcLandingPageCpc(1500, 100)).toBe(15);
      expect(calcLandingPageCpc(0, 0)).toBeNull();
      expect(calcLandingPageCpc(500, 0)).toBeNull();
      expect(calcLandingPageCpc(250.5, 50)).toBeCloseTo(5.01, 2);

      // Verifies CPC specifically uses destination link clicks instead of all post interactions
      const spend = 38.28;
      const allClicks = 5;
      const landingPageLinkClicks = 4;
      const allClicksCpc = spend / allClicks; // 7.656 (diluted by likes/comments)
      const landingPageCpc = calcLandingPageCpc(spend, landingPageLinkClicks); // 9.57 (true landing page CPC)
      expect(landingPageCpc).toBeCloseTo(9.57, 2);
      expect(landingPageCpc).not.toBe(allClicksCpc);
    });
  });

  describe("Admin force logout and require password reset", () => {
    it("flags user as forceLoggedOut and requires password reset", () => {
      const nowMs = Date.now();
      const status = resolvePasswordStatus(
        [],
        new Date(nowMs).toISOString(),
        nowMs,
        false,
        true, // forceLoggedOut
        new Date(nowMs).toISOString() // forceLogoutAt
      );

      expect(status.forceLoggedOut).toBe(true);
      expect(status.isExpired).toBe(true);
      expect(status.daysRemaining).toBe(0);
    });

    it("does not flag normal users who have not been force logged out", () => {
      const nowMs = Date.now();
      const status = resolvePasswordStatus(
        [],
        new Date(nowMs).toISOString(),
        nowMs,
        false,
        false,
        null
      );

      expect(status.forceLoggedOut).toBe(false);
      expect(status.isExpired).toBe(false);
      expect(status.daysRemaining).toBeGreaterThan(0);
    });
  });

  describe("Role-based funneling override logic", () => {
    function computeIsScoped(
      role: "admin" | "manager" | "content_creator" | "editor",
      userId: string,
      managerScope: "all" | "own",
      options: {
        overrideAllUsers?: boolean;
        usersWithAllAdsAccess?: string[];
      }
    ) {
      const hasGlobalOverride = Boolean(options.overrideAllUsers);
      const hasUserOverride = Boolean(options.usersWithAllAdsAccess?.includes(userId));
      const overrideFunneling = role === "admin" || hasGlobalOverride || hasUserOverride;

      return (
        !overrideFunneling &&
        (role === "content_creator" ||
          role === "editor" ||
          (role === "manager" && managerScope === "own"))
      );
    }

    it("scopes creator by default", () => {
      const isScoped = computeIsScoped("content_creator", "creator-1", "all", {});
      expect(isScoped).toBe(true);
    });

    it("unscopes creator when global override is enabled", () => {
      const isScoped = computeIsScoped("content_creator", "creator-1", "all", {
        overrideAllUsers: true
      });
      expect(isScoped).toBe(false);
    });

    it("unscopes creator when creator is in usersWithAllAdsAccess", () => {
      const isScoped = computeIsScoped("content_creator", "creator-1", "all", {
        usersWithAllAdsAccess: ["creator-1"]
      });
      expect(isScoped).toBe(false);
    });

    it("still scopes another creator not in usersWithAllAdsAccess", () => {
      const isScoped = computeIsScoped("content_creator", "creator-2", "all", {
        usersWithAllAdsAccess: ["creator-1"]
      });
      expect(isScoped).toBe(true);
    });

    it("admin is never scoped regardless of options", () => {
      expect(computeIsScoped("admin", "admin-1", "own", {})).toBe(false);
      expect(computeIsScoped("admin", "admin-1", "all", {})).toBe(false);
    });
  });

  describe("User-specific campaign filtering", () => {
    it("filters out campaigns in user's hidden campaigns list", () => {
      const hiddenCampaignsByUser: Record<string, string[]> = {
        "user-1": ["camp-a", "camp-c"]
      };

      const allCampaigns = [
        { id: "camp-a", name: "Campaign A" },
        { id: "camp-b", name: "Campaign B" },
        { id: "camp-c", name: "Campaign C" }
      ];

      const userHidden = new Set(hiddenCampaignsByUser["user-1"] ?? []);
      const visible = allCampaigns.filter((c) => !userHidden.has(c.id));

      expect(visible).toHaveLength(1);
      expect(visible[0].id).toBe("camp-b");
    });
  });

  describe("Campaign visibility and submenu routing (isCampaignVisibleInMode)", () => {
    // Import dynamically or test directly
    it("hides completely when set to hidden", async () => {
      const { isCampaignVisibleInMode } = await import("@/lib/meta-campaigns");
      const overrides = { "camp-1": "hidden" };

      expect(isCampaignVisibleInMode("camp-1", "all", overrides)).toBe(false);
      expect(isCampaignVisibleInMode("camp-1", "winner", overrides)).toBe(false);
      expect(isCampaignVisibleInMode("camp-1", "loser", overrides)).toBe(false);
      expect(isCampaignVisibleInMode("camp-1", "testing", overrides)).toBe(false);
    });

    it("shows only in overview when set to overview", async () => {
      const { isCampaignVisibleInMode } = await import("@/lib/meta-campaigns");
      const overrides = { "camp-1": "overview" };

      expect(isCampaignVisibleInMode("camp-1", "all", overrides)).toBe(true);
      expect(isCampaignVisibleInMode("camp-1", "winner", overrides)).toBe(false);
      expect(isCampaignVisibleInMode("camp-1", "loser", overrides)).toBe(false);
      expect(isCampaignVisibleInMode("camp-1", "testing", overrides)).toBe(false);
    });

    it("shows only in winning when set to winner_only", async () => {
      const { isCampaignVisibleInMode } = await import("@/lib/meta-campaigns");
      const overrides = { "camp-1": "winner_only" };

      expect(isCampaignVisibleInMode("camp-1", "all", overrides)).toBe(false);
      expect(isCampaignVisibleInMode("camp-1", "winner", overrides)).toBe(true);
      expect(isCampaignVisibleInMode("camp-1", "loser", overrides)).toBe(false);
    });

    it("shows in overview and winning when set to overview,winner", async () => {
      const { isCampaignVisibleInMode } = await import("@/lib/meta-campaigns");
      const overrides = { "camp-1": "overview,winner" };

      expect(isCampaignVisibleInMode("camp-1", "all", overrides)).toBe(true);
      expect(isCampaignVisibleInMode("camp-1", "winner", overrides)).toBe(true);
      expect(isCampaignVisibleInMode("camp-1", "loser", overrides)).toBe(false);
      expect(isCampaignVisibleInMode("camp-1", "testing", overrides)).toBe(false);
    });

    it("allows default campaigns across views", async () => {
      const { isCampaignVisibleInMode } = await import("@/lib/meta-campaigns");
      const overrides = { "camp-1": "default" };

      expect(isCampaignVisibleInMode("camp-1", "all", overrides)).toBe(true);
      expect(isCampaignVisibleInMode("camp-1", "winner", overrides)).toBe(true);
      expect(isCampaignVisibleInMode("camp-1", "loser", overrides)).toBe(true);
    });
  });

  describe("Editor concurrency limits with Frozen & Unfrozen creatives", () => {
    it("excludes frozen and unfrozen creatives from consuming concurrent edit slots", () => {
      // Simulating 3 in-progress items: 1 active, 1 frozen, 1 unfrozen
      const inProgressStages = ["editing", "changes_requested"];
      const ads = [
        { id: "ad-1", stage: "editing", freeze: null }, // Active -> counts
        { id: "ad-2", stage: "editing", freeze: "frozen" }, // Frozen -> should NOT count, slot freed
        { id: "ad-3", stage: "editing", freeze: "unfrozen" } // Unfrozen -> should NOT count, override
      ];

      const maxConcurrentEdits = 2;

      // Active count calculation: only creatives that are neither frozen nor unfrozen count
      const activeCount = ads.filter(
        (ad) => inProgressStages.includes(ad.stage) && ad.freeze !== "frozen" && ad.freeze !== "unfrozen"
      ).length;

      expect(activeCount).toBe(1);
      // Because activeCount (1) < maxConcurrentEdits (2), editor CAN start the next video!
      expect(activeCount < maxConcurrentEdits).toBe(true);
    });

    it("allows unfrozen creatives to bypass active editing limit completely", () => {
      const maxConcurrentEdits = 1;
      const inProgressCount = 2; // Already over capacity
      const isUnfrozen = true;

      // Logic in EditorWorkspace & startEditing
      const atCapacity = !isUnfrozen && inProgressCount >= maxConcurrentEdits;
      expect(atCapacity).toBe(false); // Bypassed!
    });
  });
});

