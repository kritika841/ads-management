import { HomeDashboard } from "@/components/dashboard/home-dashboard";
import { requireProfile } from "@/lib/auth";
import {
  getDashboardAds,
  getAppSettings,
  getEditorWorkloads,
  getProfiles,
  getEditorTimelineData,
  getEditorAverageEditTimes,
  type DashboardAdSummaryItem,
  type EditorTimelinePoint
} from "@/lib/data";
import { buildDashboardSummary } from "@/lib/dashboard-summary";
import type { AppSettings, Profile } from "@/lib/types";

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

import { dashboardCache, DASHBOARD_CACHE_TTL_MS } from "@/lib/dashboard-cache";

const cacheMap = dashboardCache;
const CACHE_TTL_MS = DASHBOARD_CACHE_TTL_MS;

async function safeQuery<T>(promise: Promise<T>, fallback: T, name: string): Promise<T> {
  try {
    return await promise;
  } catch (err) {
    console.warn(`[Dashboard] Non-fatal issue loading ${name}:`, err instanceof Error ? err.message : err);
    return fallback;
  }
}

async function fetchDashboardAdsWithRetry(
  profile: Profile,
  fallbackAds: DashboardAdSummaryItem[] = []
): Promise<{ ads: DashboardAdSummaryItem[]; fresh: boolean }> {
  try {
    return { ads: await getDashboardAds(profile), fresh: true };
  } catch (firstErr) {
    console.warn("[Dashboard] getDashboardAds timed out or failed; retrying once...", firstErr instanceof Error ? firstErr.message : firstErr);
    try {
      return { ads: await getDashboardAds(profile), fresh: true };
    } catch (secondErr) {
      console.error("[Dashboard] getDashboardAds retry failed, using fallback:", secondErr instanceof Error ? secondErr.message : secondErr);
      return { ads: fallbackAds, fresh: false };
    }
  }
}

export default async function DashboardPage() {
  const profile = await requireProfile();
  const isReviewer = profile.role === "admin" || profile.role === "manager";
  const cacheKey = `${profile.id}:${profile.role}`;
  const now = Date.now();
  const cached = cacheMap.get(cacheKey);

  let ads: DashboardAdSummaryItem[];
  let profiles: Profile[];
  let editorWorkloads: Record<string, number>;
  let settings: AppSettings;
  let timelineData: EditorTimelinePoint[] | undefined;
  let editorAverageEditTimes: Record<string, number> | undefined;

  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    // Serve from fresh cache
    ads = cached.ads;
    profiles = cached.profiles;
    editorWorkloads = cached.editorWorkloads;
    settings = cached.settings;
    timelineData = cached.timelineData;
    editorAverageEditTimes = cached.editorAverageEditTimes;
  } else {
    // Fetch fresh data with fallback to previous cache if available
    const [freshAdsResult, freshProfiles, freshWorkloads, freshSettings, freshTimeline, freshAverages] = await Promise.all([
      fetchDashboardAdsWithRetry(profile, cached?.ads ?? []),
      safeQuery(getProfiles(), cached?.profiles ?? [], "profiles"),
      safeQuery(getEditorWorkloads(), cached?.editorWorkloads ?? {}, "editorWorkloads"),
      safeQuery(getAppSettings(), cached?.settings ?? defaultSettings, "settings"),
      isReviewer
        ? safeQuery(getEditorTimelineData(90), cached?.timelineData ?? [], "timelineData")
        : Promise.resolve(undefined),
      isReviewer
        ? safeQuery(getEditorAverageEditTimes(), cached?.editorAverageEditTimes ?? {}, "editorAverageEditTimes")
        : Promise.resolve(undefined)
    ]);

    ads = freshAdsResult.ads;
    profiles = freshProfiles;
    editorWorkloads = freshWorkloads;
    settings = freshSettings;
    timelineData = freshTimeline;
    editorAverageEditTimes = freshAverages;

    // Only update cache when getDashboardAds succeeded
    if (freshAdsResult.fresh) {
      cacheMap.set(cacheKey, {
        timestamp: now,
        ads,
        profiles,
        editorWorkloads,
        settings,
        timelineData,
        editorAverageEditTimes
      });
    }
  }

  const model = buildDashboardSummary({
    role: profile.role,
    profileId: profile.id,
    ads,
    profiles,
    editorWorkloads,
    editorCapacity: settings.max_concurrent_edits ?? 5,
    timelineData,
    editorAverageEditTimes
  });

  return <HomeDashboard model={model} />;
}
