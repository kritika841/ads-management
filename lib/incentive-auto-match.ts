export type AutoMatchAd = {
  id: string;
  name: string;
  product_id: string | null;
  creator_id: string | null;
  editor_id: string | null;
};

export type AutoMatchCampaign = {
  id: string;
  product_id: string;
  starts_on: string;
  ends_on: string | null;
  active: boolean;
};

export function creativeMetaTag(ad: Pick<AutoMatchAd, "id" | "name">, creatorName?: string | null) {
  return `${ad.name}${creatorName ? ` | ${creatorName}` : ""} | AFLOW:${ad.id}`;
}

export function matchAdFlowCreative(metaName: string, creativeName: string | null | undefined, ads: AutoMatchAd[]) {
  const source = `${metaName} ${creativeName ?? ""}`;
  const explicitIds = [...source.matchAll(/AFLOW\s*:\s*([0-9a-f]{8}-[0-9a-f-]{27,})/gi)].map((match) => match[1].toLowerCase());
  if (explicitIds.length) {
    const matches = ads.filter((ad) => explicitIds.includes(ad.id.toLowerCase()));
    return matches.length === 1 ? { ad: matches[0], source: "explicit_id" as const, tag: `AFLOW:${matches[0].id}` } : null;
  }

  const tokens = new Set(source.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean));
  const matches = ads.filter((ad) => {
    const tag = ad.name.trim().toUpperCase();
    return tag.length >= 5 && /[A-Z]/.test(tag) && /\d/.test(tag) && !/[^A-Z0-9]/.test(tag) && tokens.has(tag);
  });
  return matches.length === 1 ? { ad: matches[0], source: "creative_tag" as const, tag: matches[0].name.trim() } : null;
}

export function selectProductCampaign(campaigns: AutoMatchCampaign[], productId: string | null, launchedOn: string) {
  if (!productId) return null;
  const matches = campaigns.filter((campaign) => campaign.active
    && campaign.product_id === productId
    && campaign.starts_on <= launchedOn
    && (!campaign.ends_on || campaign.ends_on >= launchedOn));
  return matches.length === 1 ? matches[0] : null;
}
