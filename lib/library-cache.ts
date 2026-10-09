import type { AdWithRelations, AppSettings, Campaign, Product, Profile } from "@/lib/types";

/**
 * Short-lived per-user cache for the Creative Library page. It absorbs request pile-ups
 * (multiple tabs, realtime refresh bursts) but must be dropped whenever this server mutates
 * creatives, otherwise the `router.refresh()` that follows a delete / assignment / freeze
 * re-renders stale rows (a deleted card reappearing, then vanishing again on the next refresh).
 *
 * Stored on globalThis so server actions and the page share one instance even when the
 * bundler evaluates this module more than once.
 */
export type CachedLibraryData = {
  timestamp: number;
  ads: AdWithRelations[];
  campaigns: Campaign[];
  products: Product[];
  profiles: Profile[];
  tags: string[];
  editorWorkloads: Record<string, number>;
  settings: AppSettings;
};

export const LIBRARY_CACHE_TTL_MS = 10_000;

const globalLibraryCache = globalThis as typeof globalThis & {
  __adflowLibraryCache?: Map<string, CachedLibraryData>;
};

export const libraryCache: Map<string, CachedLibraryData> = (globalLibraryCache.__adflowLibraryCache ??= new Map());

/** Drop every cached library snapshot so the next render reads fresh data. */
export function invalidateLibraryCache() {
  libraryCache.clear();
}
