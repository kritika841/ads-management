import { config } from "dotenv";
config({ path: ".env.local" });
import { describe, expect, it } from "vitest";
import { getIncentiveDashboard } from "@/lib/incentive-data";
import { writeMetricVisibilityFile } from "@/lib/metric-visibility-server";
import type { Profile } from "@/lib/types";

describe("getIncentiveDashboard data scoping integration", () => {
  const tamanna: Profile = {
    id: "6154c289-84bb-4d0d-8543-70bcaf418b9b",
    name: "Tamanna",
    email: "tamanna@example.com",
    role: "content_creator",
    avatar_url: null,
    active: true,
    deleted_at: null,
    updated_at: new Date().toISOString(),
    created_at: new Date().toISOString()
  };

  const nikhil: Profile = {
    id: "3c8db14b-0e23-40e7-8fab-2c9b7664e588",
    name: "Nikhil",
    email: "nikhil@example.com",
    role: "editor",
    avatar_url: null,
    active: true,
    deleted_at: null,
    updated_at: new Date().toISOString(),
    created_at: new Date().toISOString()
  };

  const ishika: Profile = {
    id: "eaf203fc-569b-4735-a7c8-99a3566dc4c3",
    name: "ishika",
    email: "ishika@example.com",
    role: "manager",
    avatar_url: null,
    active: true,
    deleted_at: null,
    updated_at: new Date().toISOString(),
    created_at: new Date().toISOString()
  };

  const admin: Profile = {
    id: "f398fb82-68be-4120-8ecd-150554a8063a",
    name: "Admin",
    email: "admin@example.com",
    role: "admin",
    avatar_url: null,
    active: true,
    deleted_at: null,
    updated_at: new Date().toISOString(),
    created_at: new Date().toISOString()
  };

  it("returns corresponding ads for a content creator (not 0 ads)", async () => {
    const result = await getIncentiveDashboard(tamanna);
    expect(result.eligibleAds.length).toBeGreaterThan(0);
    expect(result.metaAds.length).toBeGreaterThan(0);
    // Tamanna should only see ads matching her ID or tags
    for (const ad of result.metaAds) {
      const matches =
        ad.matched_creator_id === tamanna.id ||
        (ad.name && ad.name.includes("TAM")) ||
        (ad.detected_tag && ad.detected_tag.includes("TAM")) ||
        ad.assets?.some((a) => (a.asset_label || "").toUpperCase().includes("TAM"));
      expect(matches).toBe(true);
    }
  });

  it("returns corresponding ads for an editor (not 0 ads)", async () => {
    const result = await getIncentiveDashboard(nikhil);
    expect(result.eligibleAds.length).toBeGreaterThan(0);
    expect(result.metaAds.length).toBeGreaterThan(0);
  });

  it("supports manager creative scoping: 'all' vs 'own'", async () => {
    // 1. When scope is 'all'
    await writeMetricVisibilityFile({}, "all");
    const resultAll = await getIncentiveDashboard(ishika);
    const totalAllCount = resultAll.metaAds.length;
    expect(totalAllCount).toBeGreaterThan(50);

    // 2. When scope is 'own'
    await writeMetricVisibilityFile({}, "own");
    const resultOwn = await getIncentiveDashboard(ishika);
    expect(resultOwn.metaAds.length).toBeLessThan(totalAllCount);
    expect(resultOwn.metaAds.length).toBeGreaterThan(0);

    // Restore to 'all'
    await writeMetricVisibilityFile({}, "all");
  });

  it("admin always sees all ads", async () => {
    const result = await getIncentiveDashboard(admin);
    expect(result.metaAds.length).toBeGreaterThan(50);
  });
});
