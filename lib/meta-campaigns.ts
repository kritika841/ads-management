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
    const dest = destinationOverrides[campaignId];
    if (dest === "testing") return "testing" as const;
    if (dest === "winner") return "scaling" as const;
    if (dest === "loser") return "loser" as const;
  }
  if (campaignId && metaCampaignGroups.testing.campaignIds.includes(campaignId as never)) return "testing" as const;
  if (campaignId && metaCampaignGroups.scaling.campaignIds.includes(campaignId as never)) return "scaling" as const;
  return "other" as const;
}
