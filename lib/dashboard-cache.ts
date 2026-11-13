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
const MAX_DASHBOARD_CACHE_ENTRIES = 12;
const MAX_STALE_RETENTION_MS = 5 * 60_000;

const globalDashboardCache = globalThis as typeof globalThis & {
  __adflowDashboardCache?: Map<string, CachedDashboardData>;
};

export const dashboardCache: Map<string, CachedDashboardData> = (globalDashboardCache.__adflowDashboardCache ??= new Map());

export function setDashboardCacheEntry(key: string, entry: CachedDashboardData) {
  const now = Date.now();
  for (const [existingKey, existing] of dashboardCache.entries()) {
    if (now - existing.timestamp > MAX_STALE_RETENTION_MS) {
      dashboardCache.delete(existingKey);
    }
  }
  dashboardCache.delete(key);
  dashboardCache.set(key, entry);
  while (dashboardCache.size > MAX_DASHBOARD_CACHE_ENTRIES) {
    const oldestKey = dashboardCache.keys().next().value;
    if (!oldestKey) break;
    dashboardCache.delete(oldestKey);
  }
}

/** Drop every cached dashboard snapshot so the next render reads fresh data. */
export function invalidateDashboardCache() {
  dashboardCache.clear();
}
