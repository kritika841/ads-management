import type { AppSettings, Profile } from "@/lib/types";
import type { DashboardAdSummaryItem, EditorTimelinePoint } from "@/lib/data";

export type CachedDashboardData = {
  timestamp: number;
  ads: DashboardAdSummaryItem[];
  profiles: Profile[];
  editorWorkloads: Record<string, number>;
  settings: AppSettings;
  timelineData?: EditorTimelinePoint[];
  editorAverageEditTimes?: Record<string, number>;
};

export const DASHBOARD_CACHE_TTL_MS = 15_000;

const globalDashboardCache = globalThis as typeof globalThis & {
  __adflowDashboardCache?: Map<string, CachedDashboardData>;
};

export const dashboardCache: Map<string, CachedDashboardData> = (globalDashboardCache.__adflowDashboardCache ??= new Map());

/** Drop every cached dashboard snapshot so the next render reads fresh data. */
export function invalidateDashboardCache() {
  dashboardCache.clear();
}
