import type { MetaAd } from "@/lib/incentives";

export type MetaIndex = {
  byAdId: Map<string, MetaAd[]>;
  byTag: Map<string, MetaAd[]>;
  byMetaId: Map<string, MetaAd>;
};

export function buildMetaIndex(metaAds: MetaAd[]): MetaIndex {
  const byAdId = new Map<string, MetaAd[]>();
  const byTag = new Map<string, MetaAd[]>();
  const byMetaId = new Map<string, MetaAd>();
  for (const meta of metaAds) {
    byMetaId.set(meta.id, meta);
    if (meta.matched_ad_id) {
      if (!byAdId.has(meta.matched_ad_id)) byAdId.set(meta.matched_ad_id, []);
      byAdId.get(meta.matched_ad_id)!.push(meta);
    }
    const tag = (meta.detected_tag || "").trim().toUpperCase();
    if (tag) {
      if (!byTag.has(tag)) byTag.set(tag, []);
      byTag.get(tag)!.push(meta);
    }
  }
  return { byAdId, byTag, byMetaId };
}

/** All Meta ads that belong to one Creative Library ad (by ID match, AFLOW tag, or explicit Meta id). */
export function metaAdsForLibraryAd(
  index: MetaIndex,
  adId: string,
  adName: string,
  explicitMetaId?: string | null
): MetaAd[] {
  const found = new Map<string, MetaAd>();
  for (const m of index.byAdId.get(adId) ?? []) found.set(m.id, m);
  for (const m of index.byTag.get(adName.trim().toUpperCase()) ?? []) found.set(m.id, m);
  if (explicitMetaId && !explicitMetaId.startsWith("internal:")) {
    const m = index.byMetaId.get(explicitMetaId);
    if (m) found.set(m.id, m);
  }
  return [...found.values()];
}

export function sumMeta(metas: MetaAd[]) {
  let spend = 0;
  let purchases = 0;
  for (const m of metas) {
    spend += Number(m.spend) || 0;
    purchases += Number(m.purchases) || 0;
  }
  return { spend: Math.round(spend), purchases };
}
