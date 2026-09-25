import { DashboardClient } from "@/components/dashboard/dashboard-client";
import { requireProfile } from "@/lib/auth";
import {
  getAds,
  getAppSettings,
  getCampaigns,
  getEditorWorkloads,
  getProducts,
  getProfiles,
  getTags
} from "@/lib/data";
import { createMediaAccessToken } from "@/lib/media-token";
import { queueForRole, queuesForRole } from "@/lib/work-queues";
import type { AdWithRelations, AppSettings, Campaign, Product, Profile } from "@/lib/types";

export const dynamic = "force-dynamic";

const defaultSettings: AppSettings = {
  id: 1,
  max_concurrent_edits: 5,
  allow_manager_final_approval: true,
  manager_creative_scope: "all",
  two_step_approval: false,
  email_notifications: true,
  deadline_reminder_days: 2,
  assignment_start_sla_hours: 24,
  editing_sla_hours: 48,
  creator_review_sla_hours: 24,
  final_review_sla_hours: 24,
  revision_sla_hours: 24,
  hidden_metrics_by_role: {
    content_creator: [],
    editor: [],
    manager: []
  },
  updated_at: new Date().toISOString()
};

type CachedLibraryData = {
  timestamp: number;
  ads: AdWithRelations[];
  campaigns: Campaign[];
  products: Product[];
  profiles: Profile[];
  tags: string[];
  editorWorkloads: Record<string, number>;
  settings: AppSettings;
};

// 10-second cache to prevent multi-tab and concurrent request pileups
const libraryCache = new Map<string, CachedLibraryData>();
const CACHE_TTL_MS = 10_000;

async function safeQuery<T>(promise: Promise<T>, fallback: T, name: string): Promise<T> {
  try {
    return await promise;
  } catch (err) {
    console.warn(`[LibraryPage] Non-fatal issue loading ${name}:`, err instanceof Error ? err.message : err);
    return fallback;
  }
}

async function fetchAdsWithRetry(fallbackAds: AdWithRelations[] = []): Promise<AdWithRelations[]> {
  try {
    return await getAds();
  } catch (firstErr) {
    console.warn("[LibraryPage] getAds encountered an issue, retrying once...", firstErr instanceof Error ? firstErr.message : firstErr);
    try {
      return await getAds();
    } catch (secondErr) {
      console.error("[LibraryPage] getAds retry failed, using fallback:", secondErr instanceof Error ? secondErr.message : secondErr);
      if (fallbackAds.length > 0) return fallbackAds;
      throw secondErr;
    }
  }
}

export default async function LibraryPage({
  searchParams
}: {
  searchParams: Promise<{ queue?: string | string[] }>;
}) {
  const [profile, query] = await Promise.all([requireProfile(), searchParams]);
  const requestedQueue = Array.isArray(query.queue) ? query.queue[0] : query.queue;
  const initialQueue = queueForRole(profile.role, requestedQueue) ?? queuesForRole(profile.role)[0].key;

  const now = Date.now();
  const cached = libraryCache.get(profile.role);

  let ads: AdWithRelations[];
  let campaigns: Campaign[];
  let products: Product[];
  let profiles: Profile[];
  let tags: string[];
  let editorWorkloads: Record<string, number>;
  let settings: AppSettings;

  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    ads = cached.ads;
    campaigns = cached.campaigns;
    products = cached.products;
    profiles = cached.profiles;
    tags = cached.tags;
    editorWorkloads = cached.editorWorkloads;
    settings = cached.settings;
  } else {
    const [freshAds, freshCampaigns, freshProducts, freshProfiles, freshTags, freshWorkloads, freshSettings] =
      await Promise.all([
        fetchAdsWithRetry(cached?.ads ?? []),
        safeQuery(getCampaigns(), cached?.campaigns ?? [], "campaigns"),
        safeQuery(getProducts(), cached?.products ?? [], "products"),
        safeQuery(getProfiles(), cached?.profiles ?? [], "profiles"),
        safeQuery(getTags(), cached?.tags ?? [], "tags"),
        safeQuery(getEditorWorkloads(), cached?.editorWorkloads ?? {}, "editorWorkloads"),
        safeQuery(getAppSettings(), cached?.settings ?? defaultSettings, "settings")
      ]);

    ads = freshAds;
    campaigns = freshCampaigns;
    products = freshProducts;
    profiles = freshProfiles;
    tags = freshTags;
    editorWorkloads = freshWorkloads;
    settings = freshSettings;

    if (ads.length > 0) {
      libraryCache.set(profile.role, {
        timestamp: now,
        ads,
        campaigns,
        products,
        profiles,
        tags,
        editorWorkloads,
        settings
      });
    }
  }

  const mediaTokens = Object.fromEntries(
    ads.flatMap((ad) => (ad.drive_file_id ? [[ad.id, createMediaAccessToken(ad.id, ad.drive_file_id)]] : []))
  );

  return (
    <DashboardClient
      profile={profile}
      ads={ads}
      campaigns={campaigns}
      products={products}
      profiles={profiles}
      availableTags={tags}
      editorWorkloads={editorWorkloads}
      initialQueue={initialQueue}
      mediaTokens={mediaTokens}
      allowManagerFinalApproval={settings.allow_manager_final_approval ?? true}
      settings={settings}
    />
  );
}
