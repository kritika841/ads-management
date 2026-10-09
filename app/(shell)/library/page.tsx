import { cookies } from "next/headers";
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
import { LIBRARY_CACHE_TTL_MS, libraryCache } from "@/lib/library-cache";
import { LIBRARY_QUEUE_COOKIE, LIBRARY_REVIEW_TAB_COOKIE, parseLibraryReviewTab } from "@/lib/library-tab-state";
import { readDashboardFilters } from "@/lib/dashboard-filter-state";
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

// 10-second cache to prevent multi-tab and concurrent request pileups. Server actions that
// mutate creatives clear it (see lib/library-cache.ts) so refreshes never show stale rows.
const CACHE_TTL_MS = LIBRARY_CACHE_TTL_MS;

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
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [profile, query, cookieStore] = await Promise.all([requireProfile(), searchParams, cookies()]);
  // URL wins (deep links, Home shortcuts); otherwise restore the last opened tab.
  const requestedQueue = (Array.isArray(query.queue) ? query.queue[0] : query.queue) ?? cookieStore.get(LIBRARY_QUEUE_COOKIE)?.value;
  const initialQueue = queueForRole(profile.role, requestedQueue) ?? queuesForRole(profile.role)[0].key;
  const requestedReviewTab = (Array.isArray(query.review) ? query.review[0] : query.review) ?? cookieStore.get(LIBRARY_REVIEW_TAB_COOKIE)?.value;
  const initialReviewTab = parseLibraryReviewTab(requestedReviewTab) ?? "all";

  // Pre-parse filters from query parameters on the server for instant SSR hydration
  const searchParamsObj = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) {
      if (Array.isArray(value)) {
        for (const item of value) searchParamsObj.append(key, item);
      } else {
        searchParamsObj.set(key, value);
      }
    }
  }
  const initialFilters = readDashboardFilters(searchParamsObj.toString());

  const now = Date.now();
  const cacheKey = `${profile.id}:${profile.role}`;
  const cached = libraryCache.get(cacheKey);

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
      libraryCache.set(cacheKey, {
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
      initialReviewTab={initialReviewTab}
      initialFilters={initialFilters}
      mediaTokens={mediaTokens}
      allowManagerFinalApproval={settings.allow_manager_final_approval ?? true}
      settings={settings}
    />
  );
}
