import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  DEFAULT_DOWNLOAD_RETENTION_DAYS,
  DEFAULT_RECYCLE_BIN_RETENTION_DAYS,
  normalizeRetentionDays
} from "@/lib/retention";

export type RetentionSettings = {
  downloadDays: number;
  recycleBinDays: number;
};

const CACHE_TTL_MS = 15_000;
let cached: { value: RetentionSettings; at: number } | null = null;

const defaults = (): RetentionSettings => ({
  downloadDays: DEFAULT_DOWNLOAD_RETENTION_DAYS,
  recycleBinDays: DEFAULT_RECYCLE_BIN_RETENTION_DAYS
});

export function invalidateRetentionCache() {
  cached = null;
}

/**
 * Read the admin-configured retention windows. Falls back to the built-in defaults when
 * Supabase isn't configured or the columns haven't been migrated yet, so callers never fail.
 */
export async function getRetentionSettings(): Promise<RetentionSettings> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return defaults();

  let value = defaults();
  try {
    const { data, error } = await createSupabaseAdminClient()
      .from("app_settings")
      .select("download_retention_days,recycle_bin_retention_days")
      .eq("id", 1)
      .maybeSingle();
    if (!error && data) {
      const row = data as { download_retention_days?: unknown; recycle_bin_retention_days?: unknown };
      value = {
        downloadDays: normalizeRetentionDays(row.download_retention_days, DEFAULT_DOWNLOAD_RETENTION_DAYS),
        recycleBinDays: normalizeRetentionDays(row.recycle_bin_retention_days, DEFAULT_RECYCLE_BIN_RETENTION_DAYS)
      };
    }
  } catch {
    // keep defaults
  }
  cached = { value, at: Date.now() };
  return value;
}
