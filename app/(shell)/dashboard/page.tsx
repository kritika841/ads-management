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

type CachedDashboardData = {
  timestamp: number;
  ads: DashboardAdSummaryItem[];
  profiles: Profile[];
  editorWorkloads: Record<string, number>;
  settings: AppSettings;
  timelineData?: EditorTimelinePoint[];
  editorAverageEditTimes?: Record<string, number>;
};

// In-memory short-lived cache (15 seconds) to coalesce concurrent hits and provide instant response
const cacheMap = new Map<string, CachedDashboardData>();
const CACHE_TTL_MS = 15_000;

async function safeQuery<T>(promise: Promise<T>, fallback: T, name: string): Promise<T> {
  try {
    return await promise;
  } catch (err) {
    console.warn(`[Dashboard] Non-fatal issue loading ${name}:`, err instanceof Error ? err.message : err);
    return fallback;
  }
}

async function fetchDashboardAdsWithRetry(fallbackAds: DashboardAdSummaryItem[] = []): Promise<DashboardAdSummaryItem[]> {
  try {
    return await getDashboardAds();
  } catch (firstErr) {
    console.warn("[Dashboard] getDashboardAds timed out or failed; retrying once...", firstErr instanceof Error ? firstErr.message : firstErr);
    try {
      return await getDashboardAds();
    } catch (secondErr) {
      console.error("[Dashboard] getDashboardAds retry failed, using fallback:", secondErr instanceof Error ? secondErr.message : secondErr);
      return fallbackAds;
    }
  }
}

export default async function DashboardPage() {
  const profile = await requireProfile();
  const isReviewer = profile.role === "admin" || profile.role === "manager";
  const cacheKey = `${profile.role}:${isReviewer ? "reviewer" : "member"}`;
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
    const [freshAds, freshProfiles, freshWorkloads, freshSettings, freshTimeline, freshAverages] = await Promise.all([
      fetchDashboardAdsWithRetry(cached?.ads ?? []),
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

    ads = freshAds;
    profiles = freshProfiles;
    editorWorkloads = freshWorkloads;
    settings = freshSettings;
    timelineData = freshTimeline;
    editorAverageEditTimes = freshAverages;

    // Only update cache if we have valid ads
    if (ads.length > 0 || !cached) {
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
    ads,
    profiles,
    editorWorkloads,
    editorCapacity: settings.max_concurrent_edits ?? 5,
    timelineData,
    editorAverageEditTimes
  });

  return <HomeDashboard model={model} />;
}
