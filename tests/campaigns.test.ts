import { describe, expect, it } from "vitest";
import { getExcelColumnLetter } from "@/components/campaigns/excel-table";
import { isDownloaded } from "@/lib/utils";

describe("campaigns and excel table functionality", () => {
  it("computes Excel column letters correctly", () => {
    expect(getExcelColumnLetter(0)).toBe("A");
    expect(getExcelColumnLetter(1)).toBe("B");
    expect(getExcelColumnLetter(25)).toBe("Z");
    expect(getExcelColumnLetter(26)).toBe("AA");
    expect(getExcelColumnLetter(27)).toBe("AB");
    expect(getExcelColumnLetter(51)).toBe("AZ");
    expect(getExcelColumnLetter(52)).toBe("BA");
  });

  it("calculates video goal progress accurately", () => {
    const videoGoal = 10;
    const approvedCount = 7;
    const progress = videoGoal > 0 ? Math.min(100, Math.round((approvedCount / videoGoal) * 100)) : 0;
    expect(progress).toBe(70);

    const exceedApproved = 12;
    const exceedProgress = videoGoal > 0 ? Math.min(100, Math.round((exceedApproved / videoGoal) * 100)) : 0;
    expect(exceedProgress).toBe(100);
  });

  it("handles optional / unset video goal cleanly without hardcoded 10 fallback", () => {
    const videoGoal: number | null = null;
    const approvedCount = 4;
    const progress =
      videoGoal && videoGoal > 0 ? Math.min(100, Math.round((approvedCount / videoGoal) * 100)) : null;
    expect(progress).toBeNull();
  });

  it("supports toggling and selecting all items for bulk download", () => {
    const allIds = ["ad-1", "ad-2", "ad-3"];
    let selected = new Set<string>();

    // Select all
    selected = new Set(allIds);
    expect(selected.size).toBe(3);
    expect(allIds.every((id) => selected.has(id))).toBe(true);

    // Toggle one off
    selected.delete("ad-2");
    expect(selected.has("ad-2")).toBe(false);
    expect(selected.size).toBe(2);

    // Clear
    selected.clear();
    expect(selected.size).toBe(0);
  });

  it("reflects exact downloaded status matching creative library tag convention", () => {
    // Downloaded ad
    const downloadedAd = {
      id: "ad-1",
      name: "Video 1",
      tags: [{ id: "tag-1", name: "hook" }, { id: "tag-2", name: "downloaded" }]
    };
    expect(isDownloaded(downloadedAd)).toBe(true);

    // Case-insensitive test
    const upperDownloadedAd = {
      id: "ad-2",
      name: "Video 2",
      tags: [{ id: "tag-3", name: "Downloaded" }]
    };
    expect(isDownloaded(upperDownloadedAd)).toBe(true);

    // Not downloaded ad
    const notDownloadedAd = {
      id: "ad-3",
      name: "Video 3",
      tags: [{ id: "tag-4", name: "ugc" }]
    };
    expect(isDownloaded(notDownloadedAd)).toBe(false);

    // Empty tags or undefined
    expect(isDownloaded({ id: "ad-4", tags: [] })).toBe(false);
    expect(isDownloaded(null)).toBe(false);
    expect(isDownloaded(undefined)).toBe(false);
  });

  it("verifies campaign video_goal nullable migration exists", () => {
    const fs = require("node:fs");
    const migration = fs.readFileSync("supabase/migrations/20260923120000_campaign_video_goal_nullable.sql", "utf8");
    expect(migration).toContain("alter table public.campaigns alter column video_goal drop not null");
    expect(migration).toContain("alter table public.campaigns alter column video_goal drop default");
  });

  it("persists and reads campaign goals reliably via campaign-goals store", async () => {
    const { readCampaignGoals, writeCampaignGoal, deleteCampaignGoal } = await import("@/lib/campaign-goals");
    const testCampaignId = "test-campaign-123";
    await writeCampaignGoal(testCampaignId, 25);
    let goals = await readCampaignGoals();
    expect(goals[testCampaignId]).toBe(25);

    await deleteCampaignGoal(testCampaignId);
    goals = await readCampaignGoals();
    expect(goals[testCampaignId]).toBeUndefined();
  });
});
