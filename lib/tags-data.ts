import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isRecycleBinReady } from "@/lib/recycle-bin";
import type { ProductionStage } from "@/lib/types";

/** Tags that the system manages itself and that can't be deleted from the Tags page. */
export const protectedTagNames = ["downloaded"] as const;

export function isProtectedTag(name: string) {
  return (protectedTagNames as readonly string[]).includes(name.trim().toLowerCase());
}

export type TagCreative = {
  id: string;
  name: string;
  production_stage: ProductionStage;
  campaign_name: string | null;
  creator_name: string | null;
  updated_at: string | null;
};

export type TagOverview = {
  id: string;
  name: string;
  protected: boolean;
  creatives: TagCreative[];
};

type Joined<T> = T | T[] | null | undefined;
const one = <T,>(value: Joined<T>) => (Array.isArray(value) ? value[0] : value) ?? null;

type RawAd = {
  id: string;
  name: string;
  production_stage: ProductionStage;
  updated_at: string | null;
  deleted_at?: string | null;
  campaign: Joined<{ name: string }>;
  creator: Joined<{ name: string }>;
};

/** Every tag with the live (not recycled) creatives that carry it. */
export async function getTagOverview(): Promise<TagOverview[]> {
  const admin = createSupabaseAdminClient();
  const binReady = await isRecycleBinReady();
  const adColumns = `id,name,production_stage,updated_at${binReady ? ",deleted_at" : ""},campaign:campaigns(name),creator:profiles!ads_creator_id_fkey(name)`;
  const { data, error } = await admin
    .from("tags")
    .select(`id,name,ad_tags(ads(${adColumns}))`)
    .order("name", { ascending: true });
  if (error) throw error;

  return ((data ?? []) as unknown as Array<{ id: string; name: string; ad_tags: Array<{ ads: Joined<RawAd> }> | null }>).map((tag) => {
    const creatives = (tag.ad_tags ?? [])
      .map((link) => one(link.ads))
      .filter((ad): ad is RawAd => Boolean(ad) && !ad?.deleted_at)
      .map((ad) => ({
        id: ad.id,
        name: ad.name,
        production_stage: ad.production_stage,
        campaign_name: one(ad.campaign)?.name ?? null,
        creator_name: one(ad.creator)?.name ?? null,
        updated_at: ad.updated_at
      }))
      .sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""));
    return { id: tag.id, name: tag.name, protected: isProtectedTag(tag.name), creatives };
  });
}
