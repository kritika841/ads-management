import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { deleteCampaignGoal } from "@/lib/campaign-goals";
import { DAY_MS } from "@/lib/retention";
import { getRetentionSettings } from "@/lib/retention-settings";

/**
 * Recycle Bin (soft delete) for campaigns and creatives.
 *
 * Deleting a campaign stamps `deleted_at` on the campaign only. Its creatives are NOT deleted:
 * they stay live and simply lose their campaign link (`campaign_id` becomes null), remembering
 * the old campaign in `previous_campaign_id` so a restore can re-link them. Deleting a single
 * creative stamps `deleted_at` on that creative, keeping every child record (versions, comments,
 * reviews, scripts, activity...) so a restore is lossless. Rows are only hard-deleted once the
 * admin-configured retention window has elapsed, or when an admin empties them manually.
 *
 * Everything degrades gracefully: until the `deleted_at` columns exist (migration not applied)
 * `isRecycleBinReady()` is false, deletes keep their legacy hard-delete behaviour and no read
 * query adds the `deleted_at` filter.
 */

const PROBE_TTL_MS = 30_000;
let probe: { ready: boolean; at: number } | null = null;

export async function isRecycleBinReady(): Promise<boolean> {
  if (probe && Date.now() - probe.at < PROBE_TTL_MS) return probe.ready;
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return false;
  let ready = false;
  try {
    const admin = createSupabaseAdminClient();
    const [ads, campaigns] = await Promise.all([
      admin.from("ads").select("deleted_at,previous_campaign_id").limit(1),
      admin.from("campaigns").select("deleted_at").limit(1)
    ]);
    ready = !ads.error && !campaigns.error;
  } catch {
    ready = false;
  }
  probe = { ready, at: Date.now() };
  return ready;
}

export function resetRecycleBinProbe() {
  probe = null;
}

/** Hide binned rows from a read query. Synchronous so a query builder is never awaited by accident. */
export function liveOnly<Q>(query: Q, ready: boolean): Q {
  if (!ready) return query;
  return (query as unknown as { is: (column: string, value: null) => Q }).is("deleted_at", null);
}

export type BinnedCreative = {
  id: string;
  name: string;
  /** Campaign the creative was in when it was deleted (null if it had none). */
  campaignName: string | null;
  productionStage: string;
  hasScript: boolean;
  hasVideo: boolean;
  deletedAt: string;
  deletedByName: string | null;
  expiresAt: string;
};

export type BinnedCampaign = {
  id: string;
  name: string;
  description: string | null;
  deletedAt: string;
  deletedByName: string | null;
  expiresAt: string;
  /** Live creatives that were in this campaign. They are not deleted; restoring re-links them. */
  unlinkedCreatives: { id: string; name: string; productionStage: string; hasScript: boolean; hasVideo: boolean }[];
};

export type RecycleBinSnapshot = {
  ready: boolean;
  retentionDays: number;
  campaigns: BinnedCampaign[];
  creatives: BinnedCreative[];
};

type Result = { ok: true; message?: string } | { ok: false; message: string };
const fail = (message: string): Result => ({ ok: false, message });

function expiryFor(deletedAt: string, days: number) {
  return new Date(new Date(deletedAt).getTime() + days * DAY_MS).toISOString();
}

async function audit(actorId: string | null, action: string, targetType: string, targetId: string, metadata: Record<string, unknown>) {
  try {
    await createSupabaseAdminClient().from("audit_logs").insert({
      actor_id: actorId,
      action,
      target_type: targetType,
      target_id: targetId,
      metadata
    });
  } catch {
    // auditing must never block a restore/purge
  }
}

export async function listRecycleBin(): Promise<RecycleBinSnapshot> {
  const { recycleBinDays } = await getRetentionSettings();
  const empty: RecycleBinSnapshot = { ready: false, retentionDays: recycleBinDays, campaigns: [], creatives: [] };
  if (!(await isRecycleBinReady())) return empty;

  const admin = createSupabaseAdminClient();
  const [campaignRes, adRes] = await Promise.all([
    admin
      .from("campaigns")
      .select("id,name,description,deleted_at,deleted_by")
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false })
      .limit(500),
    admin
      .from("ads")
      .select("id,name,campaign_id,previous_campaign_id,production_stage,script_text,script_html,drive_file_id,deleted_at,deleted_by")
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false })
      .limit(2000)
  ]);
  if (campaignRes.error || adRes.error) return { ...empty, ready: true };

  type CampaignRow = { id: string; name: string; description: string | null; deleted_at: string; deleted_by: string | null };
  type AdRow = {
    id: string; name: string; campaign_id: string | null; previous_campaign_id: string | null; production_stage: string;
    script_text: string | null; script_html: string | null; drive_file_id: string | null; deleted_at: string; deleted_by: string | null;
  };
  type LinkedRow = Omit<AdRow, "campaign_id" | "deleted_at" | "deleted_by" | "previous_campaign_id"> & { previous_campaign_id: string };
  const campaignRows = (campaignRes.data ?? []) as CampaignRow[];
  const adRows = (adRes.data ?? []) as AdRow[];
  const binnedCampaignIds = campaignRows.map((row) => row.id);

  // Live creatives that were unlinked when their campaign was deleted (restoring re-links them).
  let linkedRows: LinkedRow[] = [];
  if (binnedCampaignIds.length) {
    const { data } = await admin
      .from("ads")
      .select("id,name,production_stage,script_text,script_html,drive_file_id,previous_campaign_id")
      .is("deleted_at", null)
      .is("campaign_id", null)
      .in("previous_campaign_id", binnedCampaignIds)
      .limit(5000);
    linkedRows = (data ?? []) as LinkedRow[];
  }

  const actorIds = [...new Set([...campaignRows, ...adRows].map((row) => row.deleted_by).filter((id): id is string => Boolean(id)))];
  const binnedSet = new Set(binnedCampaignIds);
  const parentIds = [...new Set(adRows.map((row) => row.campaign_id ?? row.previous_campaign_id).filter((id): id is string => Boolean(id) && !binnedSet.has(id as string)))];
  const [actorRes, parentRes] = await Promise.all([
    actorIds.length ? admin.from("profiles").select("id,name").in("id", actorIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    parentIds.length ? admin.from("campaigns").select("id,name").in("id", parentIds) : Promise.resolve({ data: [] as { id: string; name: string }[] })
  ]);
  const actorNames = new Map(((actorRes.data ?? []) as { id: string; name: string }[]).map((row) => [row.id, row.name]));
  const parentNames = new Map(((parentRes.data ?? []) as { id: string; name: string }[]).map((row) => [row.id, row.name]));
  for (const row of campaignRows) parentNames.set(row.id, row.name);

  const childrenByCampaign = new Map<string, BinnedCampaign["unlinkedCreatives"]>();
  for (const row of linkedRows) {
    const list = childrenByCampaign.get(row.previous_campaign_id) ?? [];
    list.push({
      id: row.id,
      name: row.name,
      productionStage: row.production_stage,
      hasScript: Boolean(row.script_text || row.script_html),
      hasVideo: Boolean(row.drive_file_id)
    });
    childrenByCampaign.set(row.previous_campaign_id, list);
  }

  return {
    ready: true,
    retentionDays: recycleBinDays,
    campaigns: campaignRows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      deletedAt: row.deleted_at,
      deletedByName: row.deleted_by ? actorNames.get(row.deleted_by) ?? null : null,
      expiresAt: expiryFor(row.deleted_at, recycleBinDays),
      unlinkedCreatives: childrenByCampaign.get(row.id) ?? []
    })),
    creatives: adRows.map((row) => {
      const parentId = row.campaign_id ?? row.previous_campaign_id;
      return {
        id: row.id,
        name: row.name,
        campaignName: parentId ? parentNames.get(parentId) ?? null : null,
        productionStage: row.production_stage,
        hasScript: Boolean(row.script_text || row.script_html),
        hasVideo: Boolean(row.drive_file_id),
        deletedAt: row.deleted_at,
        deletedByName: row.deleted_by ? actorNames.get(row.deleted_by) ?? null : null,
        expiresAt: expiryFor(row.deleted_at, recycleBinDays)
      };
    })
  };
}

/**
 * Move a campaign to the bin. Its creatives are left untouched and live: they only lose the
 * campaign association (and remember it so a restore can re-link them).
 */
export async function softDeleteCampaign(campaignId: string, actorId: string): Promise<(Result & { creativeCount?: number })> {
  const admin = createSupabaseAdminClient();
  const now = new Date().toISOString();

  const { data: campaign, error: findError } = await admin
    .from("campaigns")
    .select("id,name")
    .eq("id", campaignId)
    .is("deleted_at", null)
    .maybeSingle();
  if (findError || !campaign) return fail(findError?.message ?? "Campaign not found.");

  const { error: campaignError } = await admin
    .from("campaigns")
    .update({ deleted_at: now, deleted_by: actorId })
    .eq("id", campaignId)
    .is("deleted_at", null);
  if (campaignError) return fail(campaignError.message);

  const { data: unlinked, error: adsError } = await admin
    .from("ads")
    .update({ campaign_id: null, previous_campaign_id: campaignId })
    .eq("campaign_id", campaignId)
    .select("id,deleted_at");
  if (adsError) {
    // Never leave a half-deleted campaign behind.
    await admin.from("campaigns").update({ deleted_at: null, deleted_by: null }).eq("id", campaignId);
    return fail(adsError.message);
  }

  const liveCount = ((unlinked ?? []) as { id: string; deleted_at: string | null }[]).filter((row) => !row.deleted_at).length;
  await audit(actorId, "deleted_campaign", "campaign", campaignId, {
    name: campaign.name,
    moved_to_recycle_bin: true,
    creatives_unlinked: liveCount
  });
  return { ok: true, creativeCount: liveCount };
}

export async function softDeleteAd(adId: string, actorId: string): Promise<Result> {
  const admin = createSupabaseAdminClient();
  const { data: ad, error: findError } = await admin
    .from("ads")
    .select("id,name,status,campaign_id")
    .eq("id", adId)
    .is("deleted_at", null)
    .maybeSingle();
  if (findError || !ad) return fail(findError?.message ?? "Ad not found.");

  const { error } = await admin
    .from("ads")
    .update({ deleted_at: new Date().toISOString(), deleted_by: actorId })
    .eq("id", adId)
    .is("deleted_at", null);
  if (error) return fail(error.message);

  await audit(actorId, "deleted_ad", "ad", ad.id, {
    name: ad.name,
    status: ad.status,
    campaign_id: ad.campaign_id,
    moved_to_recycle_bin: true
  });
  return { ok: true };
}

/** Restore a campaign and re-link the creatives that were unlinked when it was deleted. */
export async function restoreCampaign(campaignId: string, actorId: string): Promise<Result> {
  const admin = createSupabaseAdminClient();
  const { data: campaign, error: findError } = await admin
    .from("campaigns")
    .select("id,name")
    .eq("id", campaignId)
    .not("deleted_at", "is", null)
    .maybeSingle();
  if (findError || !campaign) return fail(findError?.message ?? "This campaign is no longer in the Recycle Bin.");

  const { error } = await admin
    .from("campaigns")
    .update({ deleted_at: null, deleted_by: null })
    .eq("id", campaignId);
  if (error) {
    return fail(
      error.code === "23505"
        ? `A campaign named "${campaign.name}" already exists. Rename or delete it before restoring this one.`
        : error.message
    );
  }

  // Only creatives that are still without a campaign are re-linked; anything the team has
  // since moved to another campaign is left exactly where it is.
  const { data: relinked, error: adsError } = await admin
    .from("ads")
    .update({ campaign_id: campaignId, previous_campaign_id: null })
    .eq("previous_campaign_id", campaignId)
    .is("campaign_id", null)
    .select("id,deleted_at");
  if (adsError) {
    return fail(`Campaign restored, but its creatives could not be re-linked: ${adsError.message}`);
  }

  const count = ((relinked ?? []) as { id: string; deleted_at: string | null }[]).filter((row) => !row.deleted_at).length;
  await audit(actorId, "restored_campaign", "campaign", campaignId, { name: campaign.name, creatives_relinked: count });
  return { ok: true, message: `${campaign.name} restored${count ? ` and ${count} creative${count === 1 ? "" : "s"} re-linked` : ""}.` };
}

export async function restoreAd(adId: string, actorId: string): Promise<Result> {
  const admin = createSupabaseAdminClient();
  const { data: ad, error: findError } = await admin
    .from("ads")
    .select("id,name,campaign_id,previous_campaign_id")
    .eq("id", adId)
    .not("deleted_at", "is", null)
    .maybeSingle();
  if (findError || !ad) return fail(findError?.message ?? "This creative is no longer in the Recycle Bin.");

  // A creative may exist without a campaign. If its old campaign is still alive, put it back there.
  const patch: Record<string, unknown> = { deleted_at: null, deleted_by: null };
  let campaignName: string | null = null;
  if (!ad.campaign_id && ad.previous_campaign_id) {
    const { data: previous } = await admin.from("campaigns").select("id,name,deleted_at").eq("id", ad.previous_campaign_id).maybeSingle();
    if (previous && !previous.deleted_at) {
      patch.campaign_id = previous.id;
      patch.previous_campaign_id = null;
      campaignName = previous.name;
    }
  }

  const { error } = await admin.from("ads").update(patch).eq("id", adId);
  if (error) {
    return fail(
      error.code === "23505"
        ? `A creative named "${ad.name}" already exists in its campaign. Rename it before restoring this one.`
        : error.message
    );
  }

  await audit(actorId, "restored_ad", "ad", adId, { name: ad.name, campaign_id: (patch.campaign_id as string | undefined) ?? ad.campaign_id });
  return { ok: true, message: campaignName ? `${ad.name} restored to ${campaignName}.` : `${ad.name} restored.` };
}

/** Permanently remove a binned creative (children cascade, exactly like the legacy hard delete). */
export async function purgeAd(adId: string, actorId: string | null): Promise<Result> {
  const admin = createSupabaseAdminClient();
  const { data: ad } = await admin.from("ads").select("id,name,campaign_id").eq("id", adId).not("deleted_at", "is", null).maybeSingle();
  if (!ad) return fail("This creative is no longer in the Recycle Bin.");
  const { error } = await admin.from("ads").delete().eq("id", adId).not("deleted_at", "is", null);
  if (error) return fail(error.message);
  await audit(actorId, "purged_ad", "ad", adId, { name: ad.name, campaign_id: ad.campaign_id });
  return { ok: true };
}

/** Permanently remove a binned campaign. Creatives are never deleted with it; they already live on without a campaign. */
export async function purgeCampaign(campaignId: string, actorId: string | null): Promise<Result> {
  const admin = createSupabaseAdminClient();
  const { data: campaign } = await admin.from("campaigns").select("id,name").eq("id", campaignId).not("deleted_at", "is", null).maybeSingle();
  if (!campaign) return fail("This campaign is no longer in the Recycle Bin.");

  const { error } = await admin.from("campaigns").delete().eq("id", campaignId).not("deleted_at", "is", null);
  if (error) return fail(error.message);

  // previous_campaign_id has no FK (it would make campaign embeds ambiguous), so clear it here.
  await admin.from("ads").update({ previous_campaign_id: null }).eq("previous_campaign_id", campaignId);
  await deleteCampaignGoal(campaignId).catch(() => undefined);
  await audit(actorId, "purged_campaign", "campaign", campaignId, { name: campaign.name });
  return { ok: true };
}

/** Hard-delete everything whose retention window has elapsed. Safe to call repeatedly. */
export async function purgeExpiredRecycleBin(): Promise<{ campaigns: number; creatives: number }> {
  const counts = { campaigns: 0, creatives: 0 };
  if (!(await isRecycleBinReady())) return counts;
  const { recycleBinDays } = await getRetentionSettings();
  const cutoff = new Date(Date.now() - recycleBinDays * DAY_MS).toISOString();
  const admin = createSupabaseAdminClient();

  const { data: campaigns } = await admin.from("campaigns").select("id").not("deleted_at", "is", null).lte("deleted_at", cutoff).limit(100);
  for (const row of (campaigns ?? []) as { id: string }[]) {
    const result = await purgeCampaign(row.id, null);
    if (result.ok) counts.campaigns += 1;
  }

  const { data: ads } = await admin
    .from("ads")
    .select("id")
    .not("deleted_at", "is", null)
    .lte("deleted_at", cutoff)
    .limit(500);
  for (const row of (ads ?? []) as { id: string }[]) {
    const result = await purgeAd(row.id, null);
    if (result.ok) counts.creatives += 1;
  }
  return counts;
}
