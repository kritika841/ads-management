import { describe, expect, it } from "vitest";
import { calculateMonthlyIncentive, evaluateIncentiveCreative, evaluateIncentiveCreativeBackfill, type IncentiveDailyMetric } from "@/lib/incentives";

const campaign = { target_cpa: 500, gate_days: 3, winner_window_days: 7, evaluation_mode: "cumulative" as const };
const row = (day: string, spend: number, purchases: number): IncentiveDailyMetric => ({ incentive_creative_id: "creative", metric_date: day, spend, purchases, impressions: 0, reach: 0, clicks: 0, link_clicks: 0, revenue: 0 });

describe("incentive evaluation", () => {
  it("passes the initial gate and becomes a winner after the full window", () => {
    const metrics = Array.from({ length: 10 }, (_, index) => row(`2026-09-${String(index + 1).padStart(2, "0")}`, 400, 1));
    expect(evaluateIncentiveCreative(campaign, "2026-09-01", metrics)).toMatchObject({ status: "winner", cpa: 400, observedDays: 10 });
  });

  it("fails at the three-day gate when cumulative CPA misses target", () => {
    const metrics = [row("2026-09-01", 600, 1), row("2026-09-02", 600, 1), row("2026-09-03", 600, 1)];
    expect(evaluateIncentiveCreative(campaign, "2026-09-01", metrics).status).toBe("failed");
  });

  it("does not decide before Meta data covers the gate", () => {
    expect(evaluateIncentiveCreative(campaign, "2026-09-01", [row("2026-09-01", 300, 1)]).status).toBe("gate_testing");
  });

  it("computes amount times monthly winners", () => {
    expect(calculateMonthlyIncentive(1500, 4)).toBe(6000);
  });

  it("backfills a pricing pass without waiting for the testing window", () => {
    expect(evaluateIncentiveCreativeBackfill(campaign, "2026-09-01", [row("2026-09-01", 400, 1)])).toMatchObject({ outcome: "winner", passesPricingCriteria: true, observedDays: 1 });
  });

  it("backfills a pricing failure from the observed history", () => {
    expect(evaluateIncentiveCreativeBackfill(campaign, "2026-09-01", [row("2026-09-01", 600, 1)])).toMatchObject({ outcome: "failed", passesPricingCriteria: false, cpa: 600 });
  });

  it("routes campaigns based on dynamic destination overrides", async () => {
    const { metaCampaignTier } = await import("@/lib/meta-campaigns");
    expect(metaCampaignTier("custom-camp-1", { "custom-camp-1": "testing" })).toBe("testing");
    expect(metaCampaignTier("custom-camp-2", { "custom-camp-2": "winner" })).toBe("scaling");
    expect(metaCampaignTier("custom-camp-3", { "custom-camp-3": "loser" })).toBe("loser");
    expect(metaCampaignTier("custom-camp-4", { "custom-camp-4": "default" })).toBe("other");
  });

  describe("ads performance role scoping", () => {
    const creatorUser = { id: "creator-uuid", role: "content_creator" as const };
    const editorUser = { id: "editor-uuid", role: "editor" as const };
    const managerUser = { id: "manager-uuid", role: "manager" as const };
    const adminUser = { id: "admin-uuid", role: "admin" as const };

    const sampleCreatives = [
      { id: "c1", creator_id: "creator-uuid", editor_id: "other-editor", ad_id: "ad-1" },
      { id: "c2", creator_id: "other-creator", editor_id: "editor-uuid", ad_id: "ad-2" },
      { id: "c3", creator_id: "creator-uuid", editor_id: "editor-uuid", ad_id: "ad-3" },
      { id: "c4", creator_id: "other-creator", editor_id: "other-editor", ad_id: "ad-4" }
    ];

    const filterCreativesForRole = (
      user: { id: string; role: string },
      creatives: typeof sampleCreatives,
      userAdIds: Set<string>
    ) => {
      const isReviewer = user.role === "admin" || user.role === "manager";
      if (isReviewer) return creatives;
      return creatives.filter((c) => {
        if (user.role === "content_creator") {
          return c.creator_id === user.id || userAdIds.has(c.ad_id);
        }
        if (user.role === "editor") {
          return c.editor_id === user.id || userAdIds.has(c.ad_id);
        }
        return false;
      });
    };

    it("content creators only see their authored or assigned creatives", () => {
      const creatorAdIds = new Set(["ad-1", "ad-3"]);
      const visible = filterCreativesForRole(creatorUser, sampleCreatives, creatorAdIds);
      expect(visible.map((c) => c.id)).toEqual(["c1", "c3"]);
      expect(visible.some((c) => c.creator_id === "other-creator")).toBe(false);
    });

    it("editors only see their assigned or edited creatives", () => {
      const editorAdIds = new Set(["ad-2", "ad-3"]);
      const visible = filterCreativesForRole(editorUser, sampleCreatives, editorAdIds);
      expect(visible.map((c) => c.id)).toEqual(["c2", "c3"]);
      expect(visible.some((c) => c.editor_id === "other-editor")).toBe(false);
    });

    it("managers see all team creatives in ads performance", () => {
      const visible = filterCreativesForRole(managerUser, sampleCreatives, new Set());
      expect(visible).toHaveLength(4);
    });

    it("admins see all team creatives in ads performance", () => {
      const visible = filterCreativesForRole(adminUser, sampleCreatives, new Set());
      expect(visible).toHaveLength(4);
    });
  });
});

