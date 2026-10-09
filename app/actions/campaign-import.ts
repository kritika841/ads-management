"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { invalidateLibraryCache } from "@/lib/library-cache";
import { requireProfile } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { MAX_IMPORT_ROWS, scriptTextToHtml } from "@/lib/campaign-import";
import { isRecycleBinReady, liveOnly } from "@/lib/recycle-bin";
import { getNextAdName, saveCreatorItem } from "@/app/actions/ads";
import { getAppSettings } from "@/lib/data";
import { canBulkAddToCampaign } from "@/lib/permissions";

const importRowSchema = z.object({
  line: z.number().int().positive(),
  name: z.string().trim().max(160).optional().default(""),
  scriptText: z.string().trim().min(1, "Script is required."),
  productId: z.string().uuid({ message: "Choose a product." }),
  creatorId: z.string().uuid({ message: "Choose a creator." }),
  platforms: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  notes: z.string().trim().max(4000).optional().default("")
});

const importSchema = z.object({
  campaignId: z.string().uuid({ message: "Choose a campaign." }),
  stage: z.enum(["script_writing", "ready_to_shoot"]),
  rows: z.array(importRowSchema).min(1, "Add at least one creative to import.").max(MAX_IMPORT_ROWS, `Import at most ${MAX_IMPORT_ROWS} creatives at a time.`)
});

export type BulkImportRowResult = { line: number; name: string | null; ok: boolean; message?: string };

/**
 * Creates many creatives inside one campaign. Every row goes through
 * `saveCreatorItem`, so permissions, creator eligibility, product checks, tags,
 * activity logging and the "unresolved changes" guard apply exactly as they do
 * for the single-creative form. Rows are independent: one bad row never blocks the rest.
 */
export async function bulkImportCreatives(payload: z.input<typeof importSchema>) {
  const profile = await requireProfile();
  if (profile.role !== "content_creator" && profile.role !== "admin" && profile.role !== "manager") {
    return { ok: false, message: "Only content creators, managers, and admins can import creatives.", results: [] as BulkImportRowResult[], created: 0, failed: 0 };
  }

  const parsed = importSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid import.", results: [] as BulkImportRowResult[], created: 0, failed: 0 };
  }
  const { campaignId, stage, rows } = parsed.data;

  const admin = createSupabaseAdminClient();
  const binReady = await isRecycleBinReady();
  const { data: campaign, error: campaignError } = await liveOnly(admin.from("campaigns").select("id, name, active").eq("id", campaignId), binReady).maybeSingle();
  if (campaignError || !campaign) {
    return { ok: false, message: campaignError?.message ?? "Campaign not found.", results: [] as BulkImportRowResult[], created: 0, failed: 0 };
  }
  if (campaign.active === false) {
    return { ok: false, message: "This campaign is archived. Reactivate it before importing creatives.", results: [] as BulkImportRowResult[], created: 0, failed: 0 };
  }

  const results: BulkImportRowResult[] = [];
  for (const row of rows) {
    // Sequential on purpose: auto-generated names count previously imported rows.
    try {
      const name = row.name || await getNextAdName(row.creatorId);
      const response = await saveCreatorItem({
        name,
        campaignId,
        productId: row.productId,
        creatorId: row.creatorId,
        scriptText: row.scriptText,
        scriptHtml: scriptTextToHtml(row.scriptText),
        stage,
        editorId: "",
        rawFootageUrl: "",
        platforms: row.platforms,
        tags: row.tags,
        deadline: null,
        notes: row.notes || null
      });
      results.push(response.ok ? { line: row.line, name, ok: true } : { line: row.line, name, ok: false, message: response.message ?? "Unable to save." });
    } catch (error) {
      results.push({ line: row.line, name: row.name || null, ok: false, message: error instanceof Error ? error.message : "Unable to save." });
    }
  }

  const created = results.filter((item) => item.ok).length;
  const failed = results.length - created;
  revalidatePath("/campaigns");
  revalidatePath(`/campaigns/${campaignId}`);
  revalidatePath("/library"); invalidateLibraryCache();
  return {
    ok: created > 0,
    message: failed ? `${created} imported, ${failed} failed.` : `${created} creative${created === 1 ? "" : "s"} imported.`,
    results,
    created,
    failed
  };
}

export type ImportableCreative = {
  id: string;
  name: string;
  status: string;
  production_stage: string;
  campaign_id: string | null;
  campaign_name: string | null;
  creator_id: string | null;
  creator_name: string | null;
  drive_file_id: string | null;
  drive_url: string | null;
  thumbnail_url: string | null;
  tags: string[];
  created_at: string;
  approved_at: string | null;
  final_approved_at: string | null;
};

/**
 * Creatives from the Creative Library that can be pulled into a campaign (everything that is
 * not already in it and not in the Recycle Bin). Same permission as the library's bulk
 * "Add to campaign".
 */
export async function listImportableCreatives(campaignId: string) {
  const profile = await requireProfile();
  const settings = await getAppSettings();
  if (!canBulkAddToCampaign(profile.role, settings)) {
    return { ok: false as const, message: "You do not have permission to add creatives to campaigns.", creatives: [] as ImportableCreative[] };
  }
  if (!z.string().uuid().safeParse(campaignId).success) {
    return { ok: false as const, message: "Choose a campaign.", creatives: [] as ImportableCreative[] };
  }
  const admin = createSupabaseAdminClient();
  const binReady = await isRecycleBinReady();
  const { data, error } = await liveOnly(
    admin
      .from("ads")
      .select("id,name,status,production_stage,campaign_id,creator_id,drive_file_id,drive_url,thumbnail_url,created_at,approved_at,final_approved_at,campaign:campaigns(name),creator:profiles!ads_creator_id_fkey(name),ad_tags(tags(id,name))")
      .or(`campaign_id.is.null,campaign_id.neq.${campaignId}`)
      .order("created_at", { ascending: false })
      .limit(1000),
    binReady
  );
  if (error) return { ok: false as const, message: error.message, creatives: [] as ImportableCreative[] };
  const one = <T,>(value: T | T[] | null | undefined) => (Array.isArray(value) ? value[0] : value) ?? null;
  const creatives = ((data ?? []) as Array<Record<string, unknown>>).map((row) => {
    const rawTags = ((row.ad_tags as Array<{ tags?: { id: string; name: string } | null }>) ?? [])
      .map((item) => item?.tags?.name)
      .filter((n): n is string => typeof n === "string" && n.toLowerCase() !== "downloaded");

    return {
      id: row.id as string,
      name: row.name as string,
      status: (row.status as string) ?? "active",
      production_stage: row.production_stage as string,
      campaign_id: (row.campaign_id as string | null) ?? null,
      campaign_name: one(row.campaign as { name: string } | { name: string }[] | null)?.name ?? null,
      creator_id: (row.creator_id as string | null) ?? null,
      creator_name: one(row.creator as { name: string } | { name: string }[] | null)?.name ?? null,
      drive_file_id: (row.drive_file_id as string | null) ?? null,
      drive_url: (row.drive_url as string | null) ?? null,
      thumbnail_url: (row.thumbnail_url as string | null) ?? null,
      tags: rawTags,
      created_at: row.created_at as string,
      approved_at: (row.approved_at as string | null) ?? null,
      final_approved_at: (row.final_approved_at as string | null) ?? null
    };
  });
  return { ok: true as const, creatives };
}
