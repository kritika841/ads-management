// Verified against the connected Meta ad account on 17 Sep 2026. IDs, rather
// than mutable campaign names, are the authoritative dashboard grouping keys.
export const metaCampaignGroups = {
  testing: {
    label: "Testing",
    campaignIds: ["120249742823600128"]
  },
  scaling: {
    label: "Scaling / winners",
    campaignIds: ["120250356632220128", "120249817915090128", "120247229221970128"]
  }
} as const;

export function metaCampaignTier(
  campaignId: string | null | undefined,
  destinationOverrides?: Record<string, string>
) {
  if (campaignId && destinationOverrides?.[campaignId]) {
    const dest = destinationOverrides[campaignId].trim().toLowerCase();
    if (dest === "hidden") return "hidden" as const;
    if (dest === "testing" || dest.includes("testing")) return "testing" as const;
    if (dest === "winner" || dest === "scaling" || dest.includes("winner") || dest.includes("winning")) return "scaling" as const;
    if (dest === "loser" || dest.includes("loser") || dest.includes("losing")) return "loser" as const;
    if (dest === "overview") return "overview" as const;
  }
  if (campaignId && metaCampaignGroups.testing.campaignIds.includes(campaignId as never)) return "testing" as const;
  if (campaignId && metaCampaignGroups.scaling.campaignIds.includes(campaignId as never)) return "scaling" as const;
  return "other" as const;
}

/**
 * Determines whether a campaign is visible in the given Ads Performance mode / tab
 * based on admin-configured routing rules and hidden overrides.
 */
export function isCampaignVisibleInMode(
  campaignId: string | null | undefined,
  mode: string, // "all" (overview) | "winner" | "loser" | "testing" | "scaling" | "active" | "paused"
  destinationOverrides?: Record<string, string>
): boolean {
  if (!campaignId || !destinationOverrides?.[campaignId]) {
    return true;
  }
  const raw = destinationOverrides[campaignId].trim().toLowerCase();
  if (raw === "default" || raw === "") return true;
  if (raw === "hidden") return false;

  const tokens = raw.split(",").map((s) => s.trim().toLowerCase());
  if (tokens.includes("hidden")) return false;
  if (tokens.includes("default") || tokens.includes("all")) return true;

  const hasOverview = tokens.includes("overview");
  const hasWinner = tokens.includes("winner") || tokens.includes("winning");
  const hasLoser = tokens.includes("loser") || tokens.includes("losing");
  const hasTesting = tokens.includes("testing");
  const hasActive = tokens.includes("active");
  const hasPaused = tokens.includes("paused");

  if (mode === "all") {
    // Mode "all" is the Overview tab.
    if (tokens.includes("winner_only") || tokens.includes("loser_only") || tokens.includes("testing_only")) {
      return false;
    }
    if (hasOverview) return true;
    // Legacy support: if only "winner", "testing", or "loser" was set in legacy schema
    if (tokens.length === 1 && (tokens[0] === "winner" || tokens[0] === "testing" || tokens[0] === "loser")) {
      return true;
    }
    return false;
  }

  if (mode === "winner" || mode === "scaling") {
    return hasWinner || tokens.includes("winner_only");
  }

  if (mode === "loser") {
    return hasLoser || tokens.includes("loser_only");
  }

  if (mode === "testing") {
    return hasTesting || tokens.includes("testing_only");
  }

  if (mode === "active") {
    return hasActive;
  }

  if (mode === "paused") {
    return hasPaused;
  }

  return true;
}
