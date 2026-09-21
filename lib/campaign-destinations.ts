import fs from "node:fs";
import path from "node:path";

export type CampaignDestination = "default" | "testing" | "winner" | "loser";

export type CampaignDestinationRecord = {
  campaignId: string;
  campaignName?: string | null;
  destination: CampaignDestination;
  updatedAt: string;
  updatedBy?: string | null;
};

const CONFIG_FILE = path.join(process.cwd(), "data", "campaign-destinations.json");

function ensureDirectory() {
  const dir = path.dirname(CONFIG_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function getCampaignDestinations(): Record<string, CampaignDestinationRecord> {
  try {
    if (!fs.existsSync(CONFIG_FILE)) {
      return {};
    }
    const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
    return JSON.parse(raw);
  } catch (error) {
    console.error("Failed to read campaign destinations config:", error);
    return {};
  }
}

export function saveCampaignDestinationRecord(record: CampaignDestinationRecord): void {
  ensureDirectory();
  const current = getCampaignDestinations();
  current[record.campaignId] = record;
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(current, null, 2), "utf-8");
}

export function getDestinationForCampaign(campaignId: string | null | undefined): CampaignDestination {
  if (!campaignId) return "default";
  const destinations = getCampaignDestinations();
  return destinations[campaignId]?.destination ?? "default";
}
