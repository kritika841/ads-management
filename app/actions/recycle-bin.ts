"use server";

import { revalidatePath } from "next/cache";
import { invalidateLibraryCache } from "@/lib/library-cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { applyDownloadRetentionDays } from "@/lib/download-logs";
import { syncExportJobExpiry } from "@/lib/export-jobs";
import {
  isRecycleBinReady,
  purgeAd,
  purgeCampaign,
  purgeExpiredRecycleBin,
  restoreAd,
  restoreCampaign,
  resetRecycleBinProbe
} from "@/lib/recycle-bin";
import { MAX_RETENTION_DAYS, MIN_RETENTION_DAYS } from "@/lib/retention";
import { invalidateRetentionCache } from "@/lib/retention-settings";

const idSchema = z.string().uuid();

const retentionSchema = z.object({
  downloadDays: z.number().int().min(MIN_RETENTION_DAYS).max(MAX_RETENTION_DAYS).optional(),
  recycleBinDays: z.number().int().min(MIN_RETENTION_DAYS).max(MAX_RETENTION_DAYS).optional()
});

const MIGRATION_HINT = "Apply the latest database migration (20261006120000_recycle_bin_retention_and_editing_freeze) to enable this.";

function revalidateBinViews() {
  revalidatePath("/admin/settings");
  revalidatePath("/recycle-bin");
  revalidatePath("/campaigns");
  revalidatePath("/dashboard");
  revalidatePath("/library"); invalidateLibraryCache();
  revalidatePath("/analytics");
}

/** Admin only: change how long download archives and Recycle Bin items are kept. */
export async function updateRetentionSettings(payload: { downloadDays?: number; recycleBinDays?: number }) {
  const adminProfile = await requireRole(["admin"]);
  const parsed = retentionSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, message: `Retention must be a whole number of days between ${MIN_RETENTION_DAYS} and ${MAX_RETENTION_DAYS}.` };
  }
  const { downloadDays, recycleBinDays } = parsed.data;
  if (downloadDays === undefined && recycleBinDays === undefined) return { ok: false, message: "Nothing to update." };

  const patch: Record<string, number> = {};
  if (downloadDays !== undefined) patch.download_retention_days = downloadDays;
  if (recycleBinDays !== undefined) patch.recycle_bin_retention_days = recycleBinDays;

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("app_settings").update(patch).eq("id", 1);
  if (error) {
    const missingColumn = error.code === "PGRST204" || error.code === "42703" || /retention_days/.test(error.message);
    return { ok: false, message: missingColumn ? MIGRATION_HINT : error.message };
  }

  invalidateRetentionCache();
  let expiredLogs = 0;
  if (downloadDays !== undefined) {
    syncExportJobExpiry(downloadDays);
    expiredLogs = await applyDownloadRetentionDays(downloadDays);
  }

  await admin.from("audit_logs").insert({
    actor_id: adminProfile.id,
    action: "updated_retention_settings",
    target_type: "app_settings",
    target_id: "1",
    metadata: patch
  });

  revalidateBinViews();
  return { ok: true, expiredLogs };
}

/** Admin/manager: restore a campaign together with the creatives that were deleted with it. */
export async function restoreCampaignFromBin(id: string) {
  const profile = await requireRole(["admin", "manager"]);
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return { ok: false, message: "Invalid campaign id." };
  const result = await restoreCampaign(parsed.data, profile.id);
  revalidateBinViews();
  return result;
}

/** Admin/manager: restore a single creative (and its script) back into its campaign. */
export async function restoreCreativeFromBin(id: string) {
  const profile = await requireRole(["admin", "manager"]);
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return { ok: false, message: "Invalid creative id." };
  const result = await restoreAd(parsed.data, profile.id);
  revalidateBinViews();
  return result;
}

/** Admin only: permanently delete a binned campaign (and the creatives deleted with it). */
export async function purgeCampaignFromBin(id: string) {
  const profile = await requireRole(["admin"]);
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return { ok: false, message: "Invalid campaign id." };
  const result = await purgeCampaign(parsed.data, profile.id);
  revalidateBinViews();
  return result;
}

/** Admin only: permanently delete a binned creative. */
export async function purgeCreativeFromBin(id: string) {
  const profile = await requireRole(["admin"]);
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return { ok: false, message: "Invalid creative id." };
  const result = await purgeAd(parsed.data, profile.id);
  revalidateBinViews();
  return result;
}

/** Admin only: run the retention sweep now. */
export async function sweepRecycleBin() {
  await requireRole(["admin"]);
  resetRecycleBinProbe();
  if (!(await isRecycleBinReady())) return { ok: false, message: MIGRATION_HINT };
  const counts = await purgeExpiredRecycleBin();
  revalidateBinViews();
  return { ok: true, ...counts };
}
