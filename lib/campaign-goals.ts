import { promises as fs } from "node:fs";
import path from "node:path";

const CAMPAIGN_GOALS_FILE = path.join(process.cwd(), "data", "campaign-goals.json");

export async function readCampaignGoals(): Promise<Record<string, number>> {
  try {
    const raw = await fs.readFile(CAMPAIGN_GOALS_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

export async function writeCampaignGoal(campaignId: string, goal: number | null): Promise<void> {
  try {
    const existing = await readCampaignGoals();
    if (goal != null && goal > 0) {
      existing[campaignId] = goal;
    } else {
      delete existing[campaignId];
    }
    await fs.mkdir(path.dirname(CAMPAIGN_GOALS_FILE), { recursive: true });
    await fs.writeFile(CAMPAIGN_GOALS_FILE, JSON.stringify(existing, null, 2), "utf-8");
  } catch (error) {
    console.error("Failed to write campaign-goals.json:", error);
  }
}

export async function deleteCampaignGoal(campaignId: string): Promise<void> {
  try {
    const existing = await readCampaignGoals();
    if (existing[campaignId] !== undefined) {
      delete existing[campaignId];
      await fs.mkdir(path.dirname(CAMPAIGN_GOALS_FILE), { recursive: true });
      await fs.writeFile(CAMPAIGN_GOALS_FILE, JSON.stringify(existing, null, 2), "utf-8");
    }
  } catch (error) {
    console.error("Failed to delete from campaign-goals.json:", error);
  }
}
