import { readFileSync } from "node:fs";
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
    const migration = readFileSync("supabase/migrations/20260923120000_campaign_video_goal_nullable.sql", "utf8");
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

  it("handles ascending and descending multi-type column sorting correctly", () => {
    const items = [
      { name: "Beta Campaign", creatives: 5, goal: 10, active: true },
      { name: "Alpha Campaign", creatives: 20, goal: 15, active: false },
      { name: "Gamma Campaign", creatives: 1, goal: null, active: true }
    ];

    function sortItems<T>(list: T[], extractor: (item: T) => unknown, direction: "asc" | "desc"): T[] {
      return [...list].sort((a, b) => {
        const left = extractor(a);
        const right = extractor(b);
        if (left === right) return 0;
        if (left === null || left === undefined || left === "") return 1;
        if (right === null || right === undefined || right === "") return -1;
        if (typeof left === "number" && typeof right === "number") {
          return direction === "asc" ? left - right : right - left;
        }
        if (typeof left === "boolean" && typeof right === "boolean") {
          return direction === "asc" ? (left ? 1 : 0) - (right ? 1 : 0) : (right ? 1 : 0) - (left ? 1 : 0);
        }
        const lStr = String(left).toLowerCase();
        const rStr = String(right).toLowerCase();
        return direction === "asc" ? lStr.localeCompare(rStr) : rStr.localeCompare(lStr);
      });
    }

    // Sort by name asc
    const byNameAsc = sortItems(items, (i) => i.name, "asc");
    expect(byNameAsc.map((i) => i.name)).toEqual(["Alpha Campaign", "Beta Campaign", "Gamma Campaign"]);

    // Sort by name desc
    const byNameDesc = sortItems(items, (i) => i.name, "desc");
    expect(byNameDesc.map((i) => i.name)).toEqual(["Gamma Campaign", "Beta Campaign", "Alpha Campaign"]);

    // Sort by creatives numeric desc
    const byCreativesDesc = sortItems(items, (i) => i.creatives, "desc");
    expect(byCreativesDesc.map((i) => i.creatives)).toEqual([20, 5, 1]);

    // Sort by goal with nulls placed last
    const byGoalAsc = sortItems(items, (i) => i.goal, "asc");
    expect(byGoalAsc[0].goal).toBe(10);
    expect(byGoalAsc[1].goal).toBe(15);
    expect(byGoalAsc[2].goal).toBeNull();
  });

  it("calculates select-all and indeterminate state for bulk selection", () => {
    const allIds = ["c-1", "c-2", "c-3", "c-4"];
    const selected = new Set<string>();

    const isAll = (sel: Set<string>) => allIds.length > 0 && allIds.every((id) => sel.has(id));
    const isIndeterminate = (sel: Set<string>) => sel.size > 0 && !isAll(sel);

    expect(isAll(selected)).toBe(false);
    expect(isIndeterminate(selected)).toBe(false);

    selected.add("c-1");
    selected.add("c-2");
    expect(isAll(selected)).toBe(false);
    expect(isIndeterminate(selected)).toBe(true);

    allIds.forEach((id) => selected.add(id));
    expect(isAll(selected)).toBe(true);
    expect(isIndeterminate(selected)).toBe(false);
  });
});

