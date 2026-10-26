"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireProfile, requireRole } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const campaignSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, "Campaign name is required").max(120),
  productId: z.string().uuid().optional(),
  dailySubmissionTarget: z.number().int().min(1).max(100).optional().default(1),
  targetCpa: z.number().positive().max(10_000_000).optional().default(200),
  gateDays: z.number().int().min(1).max(30).optional().default(3),
  winnerWindowDays: z.number().int().min(1).max(90).optional().default(30),
  evaluationMode: z.enum(["cumulative", "daily"]).optional().default("cumulative"),
  creatorIncentiveAmount: z.number().min(0).max(10_000_000).optional().default(0),
  editorIncentiveAmount: z.number().min(0).max(10_000_000).optional().default(0),
  startsOn: z.string().date().optional(),
  endsOn: z.string().date().optional().or(z.literal("")),
  active: z.boolean().optional().default(true),
  visibleUserIds: z.array(z.string()).optional(),
  adIds: z.array(z.string()).optional()
}).refine((value) => (value.winnerWindowDays ?? 30) >= (value.gateDays ?? 3), {
  message: "The winner window must be at least as long as the initial gate.",
  path: ["winnerWindowDays"]
}).refine((value) => !value.endsOn || !value.startsOn || value.endsOn >= value.startsOn, {
  message: "The end date cannot be before the start date.",
  path: ["endsOn"]
});

const assignCreativesSchema = z.object({
  campaignId: z.string().uuid(),
  adIds: z.array(z.string()).min(1, "Select at least one creative."),
  launchedOn: z.string().date().optional()
});

const creativeSchema = z.object({
  campaignId: z.string().uuid(),
  adId: z.string().uuid(),
  metaAdId: z.string().trim().regex(/^\d+$/, "Meta ad ID must contain only numbers."),
  launchedOn: z.string().date()
});
const creativeBatchSchema = z.object({
  campaignId: z.string().uuid(),
  creatives: z.array(z.object({
    adId: z.string().uuid(),
    metaAdId: z.string().trim().regex(/^\d+$/, "Every Meta ad ID must contain only numbers."),
    launchedOn: z.string().date()
  })).min(1, "Add at least one creative.").max(100)
});

const decisionSchema = z.object({
  id: z.string().uuid(),
  decisionStatus: z.enum(["unreviewed", "winner", "loser", "needs_iteration", "keep_testing"]),
  note: z.string().trim().max(500).optional().or(z.literal("")),
  payoutStatus: z.enum(["not_ready", "pending", "approved", "paid"]).optional()
});
const bulkDecisionSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, "Select at least one tracked creative.").max(5_000),
  decisionStatus: z.enum(["unreviewed", "winner", "loser", "needs_iteration", "keep_testing"]),
  note: z.string().trim().max(500).optional().or(z.literal(""))
});
const metaAdOutcomeSchema = z.object({
  ids: z.array(z.string().trim().regex(/^\d+$/, "Every Meta ad ID must contain only numbers.")).min(1, "Select at least one ad.").max(5_000),
  outcome: z.enum(["unreviewed", "winner", "loser", "needs_iteration", "keep_testing"]).nullable()
});

function incentiveStatusForDecision(decisionStatus: z.infer<typeof decisionSchema>["decisionStatus"], payoutStatus?: z.infer<typeof decisionSchema>["payoutStatus"]) {
  if (payoutStatus === "paid") return "paid";
  if (payoutStatus === "approved") return "approved_for_payout";
  if (decisionStatus === "winner") return "eligible";
  if (decisionStatus === "loser") return "not_eligible";
  return "pending_testing";
}

export async function saveIncentiveCampaign(payload: z.input<typeof campaignSchema>) {
  const profile = await requireRole(["admin", "manager"]);
  const parsed = campaignSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid campaign." };

  const value = parsed.data;
  const admin = createSupabaseAdminClient();

  let productId = value.productId;
  if (!productId) {
    const { data: firstProd } = await admin.from("products").select("id").limit(1).maybeSingle();
    productId = firstProd?.id;
  }
  if (!productId) {
    return { ok: false, message: "No product available in the system." };
  }

  const patch = {
    name: value.name,
    product_id: productId,
    daily_submission_target: value.dailySubmissionTarget ?? 1,
    target_cpa: value.targetCpa ?? 200,
    gate_days: value.gateDays ?? 3,
    winner_window_days: value.winnerWindowDays ?? 30,
    evaluation_mode: value.evaluationMode ?? "cumulative",
    creator_incentive_amount: value.creatorIncentiveAmount ?? 0,
    editor_incentive_amount: value.editorIncentiveAmount ?? 0,
    starts_on: value.startsOn || new Date().toISOString().slice(0, 10),
    ends_on: value.endsOn || null,
    active: value.active ?? true,
    created_by: profile.id
  };

  const { data, error } = value.id
    ? await admin.from("incentive_campaigns").update(patch).eq("id", value.id).select("id").single()
    : await admin.from("incentive_campaigns").insert(patch).select("id").single();
  if (error) return { ok: false, message: error.message };

  if (value.visibleUserIds !== undefined) {
    const { updateCampaignUserVisibility } = await import("@/app/actions/admin");
    const visibilityResult = await updateCampaignUserVisibility({
      campaignId: data.id,
      visibleUserIds: value.visibleUserIds
    });
    if (!visibilityResult.ok) {
      return { ok: false, message: `Campaign saved, but user access failed: ${(visibilityResult as { message?: string }).message ?? "unknown error"}` };
    }
  }

  // Synchronize assigned ads if adIds is passed
  if (value.adIds !== undefined) {
    const campaignId = data.id;
    const targetAdIds = new Set(value.adIds);

    const { data: existingLinks } = await admin
      .from("incentive_creatives")
      .select("id, ad_id, meta_ad_id")
      .eq("incentive_campaign_id", campaignId);

    const existingByAdId = new Map((existingLinks || []).map((l) => [l.ad_id, l]));

    // 1. Ads to remove
    const toRemove = (existingLinks || []).filter((l) => !targetAdIds.has(l.ad_id));
    if (toRemove.length > 0) {
      await admin.from("incentive_creatives").delete().in("id", toRemove.map((l) => l.id));
    }

    // 2. Ads to add
    const toAddAdIds = value.adIds.filter((adId) => !existingByAdId.has(adId));
    if (toAddAdIds.length > 0) {
      await assignCreativesToCampaign({
        campaignId,
        adIds: toAddAdIds
      });
    }
  }

  await admin.from("audit_logs").insert({
    actor_id: profile.id,
    action: value.id ? "updated_incentive_campaign" : "created_incentive_campaign",
    target_type: "incentive_campaign",
    target_id: data.id,
    metadata: patch
  });
  revalidatePath("/incentives");
  return { ok: true, id: data.id };
}

export async function assignCreativesToCampaign(payload: z.input<typeof assignCreativesSchema>) {
  const profile = await requireRole(["admin", "manager"]);
  const parsed = assignCreativesSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid assignment payload." };

  const { campaignId, adIds, launchedOn: customLaunch } = parsed.data;
  const admin = createSupabaseAdminClient();

  const [{ data: campaign, error: campErr }, { data: ads, error: adsErr }, { data: metaAds, error: metaErr }] = await Promise.all([
    admin.from("incentive_campaigns").select("id, product_id, starts_on, ends_on, active").eq("id", campaignId).maybeSingle(),
    admin.from("ads").select("id, name, product_id, creator_id, editor_id, created_at").in("id", adIds),
    admin.from("meta_ads").select("id, matched_ad_id, detected_tag, created_time")
  ]);

  if (campErr || !campaign) return { ok: false, message: campErr?.message ?? "Campaign not found." };
  if (adsErr) return { ok: false, message: adsErr.message };

  const metaByAdId = new Map<string, string>();
  for (const m of metaAds || []) {
    if (m.matched_ad_id && !metaByAdId.has(m.matched_ad_id)) {
      metaByAdId.set(m.matched_ad_id, m.id);
    }
  }

  const { data: existingLinks } = await admin
    .from("incentive_creatives")
    .select("ad_id, meta_ad_id")
    .eq("incentive_campaign_id", campaignId);
  const existingAdIds = new Set((existingLinks || []).map((l) => l.ad_id));
  const existingMetaIds = new Set((existingLinks || []).map((l) => l.meta_ad_id));

  const rowsToInsert = [];
  const today = new Date().toISOString().slice(0, 10);

  for (const ad of ads || []) {
    if (existingAdIds.has(ad.id)) continue;
    let metaAdId = metaByAdId.get(ad.id);
    if (!metaAdId || existingMetaIds.has(metaAdId)) {
      metaAdId = `internal:${ad.id}`;
    }
    const launch = customLaunch || campaign.starts_on || ad.created_at?.slice(0, 10) || today;
    rowsToInsert.push({
      incentive_campaign_id: campaignId,
      ad_id: ad.id,
      meta_ad_id: metaAdId,
      launched_on: launch,
      creator_id: ad.creator_id,
      editor_id: ad.editor_id,
      attribution_source: "manual" as const,
      created_by: profile.id
    });
    existingAdIds.add(ad.id);
    existingMetaIds.add(metaAdId);
  }

  if (rowsToInsert.length === 0) {
    return { ok: true, count: 0, message: "Selected creatives are already assigned to this campaign." };
  }

  const { data: inserted, error: insertErr } = await admin
    .from("incentive_creatives")
    .insert(rowsToInsert)
    .select("id, meta_ad_id");
  if (insertErr) return { ok: false, message: insertErr.message };

  if (inserted?.length) {
    const realMetaIds = inserted.map((i) => i.meta_ad_id).filter((id) => !id.startsWith("internal:"));
    if (realMetaIds.length) {
      const { data: metrics } = await admin
        .from("meta_ad_daily_metrics")
        .select("meta_ad_id, metric_date, spend, impressions, reach, clicks, link_clicks, purchases, revenue")
        .in("meta_ad_id", realMetaIds);
      if (metrics?.length) {
        const linkByMeta = new Map(inserted.map((i) => [i.meta_ad_id, i.id]));
        const metricRows = metrics.map((m) => ({
          incentive_creative_id: linkByMeta.get(m.meta_ad_id),
          metric_date: m.metric_date,
          spend: Number(m.spend),
          impressions: Number(m.impressions),
          reach: Number(m.reach),
          clicks: Number(m.clicks),
          link_clicks: Number(m.link_clicks),
          purchases: Number(m.purchases),
          revenue: Number(m.revenue)
        })).filter((r) => r.incentive_creative_id);
        if (metricRows.length) {
          await admin.from("incentive_daily_metrics").upsert(metricRows, { onConflict: "incentive_creative_id,metric_date" });
        }
      }
    }
  }

  revalidatePath("/incentives");
  return { ok: true, count: rowsToInsert.length, message: `Successfully assigned ${rowsToInsert.length} creatives to campaign.` };
}

export async function deactivateIncentiveCampaign(id: string) {
  const profile = await requireRole(["admin"]);
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) return { ok: false, message: "Invalid campaign." };
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("incentive_campaigns").update({ active: false }).eq("id", parsed.data);
  if (error) return { ok: false, message: error.message };
  await admin.from("audit_logs").insert({ actor_id: profile.id, action: "deactivated_incentive_campaign", target_type: "incentive_campaign", target_id: parsed.data, metadata: {} });
  revalidatePath("/incentives");
  return { ok: true };
}

export async function deleteIncentiveCampaign(id: string) {
  const profile = await requireRole(["admin"]);
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) return { ok: false, message: "Invalid campaign." };
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("incentive_campaigns").delete().eq("id", parsed.data);
  if (error) return { ok: false, message: error.message };
  await admin.from("audit_logs").insert({ actor_id: profile.id, action: "deleted_incentive_campaign", target_type: "incentive_campaign", target_id: parsed.data, metadata: {} });
  try {
    const { updateCampaignPlacement, updateCampaignUserVisibility } = await import("@/app/actions/admin");
    await updateCampaignPlacement({ campaignId: parsed.data, placement: null });
    await updateCampaignUserVisibility({ campaignId: parsed.data, visibleUserIds: [] });
  } catch {
    // Non-fatal: stale config entries are ignored when the campaign no longer exists.
  }
  revalidatePath("/incentives");
  return { ok: true };
}

export async function linkIncentiveCreative(payload: z.input<typeof creativeSchema>) {
  const profile = await requireProfile();
  const parsed = creativeSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid creative." };
  const value = parsed.data;
  const admin = createSupabaseAdminClient();
  const [{ data: campaign, error: campaignError }, { data: ad, error: adError }] = await Promise.all([
    admin.from("incentive_campaigns").select("id,product_id,starts_on,ends_on,active").eq("id", value.campaignId).maybeSingle(),
    admin.from("ads").select("id,name,product_id,creator_id,editor_id").eq("id", value.adId).maybeSingle()
  ]);
  if (campaignError || !campaign) return { ok: false, message: campaignError?.message ?? "Campaign not found." };
  if (adError || !ad) return { ok: false, message: adError?.message ?? "Creative not found." };
  const reviewer = profile.role === "admin" || profile.role === "manager";
  if (!reviewer && ad.creator_id !== profile.id) return { ok: false, message: "You can only submit your own creatives." };
  if (ad.product_id !== campaign.product_id) return { ok: false, message: "The creative product must match the campaign product." };
  if (value.launchedOn < campaign.starts_on || (campaign.ends_on && value.launchedOn > campaign.ends_on)) {
    return { ok: false, message: "Launch date must fall inside the campaign dates." };
  }

  const { error } = await admin.from("incentive_creatives").insert({
    incentive_campaign_id: value.campaignId,
    ad_id: value.adId,
    meta_ad_id: value.metaAdId,
    launched_on: value.launchedOn,
    creator_id: ad.creator_id,
    editor_id: ad.editor_id,
    attribution_source: "manual",
    created_by: profile.id
  });
  if (error) return { ok: false, message: error.code === "23505" ? "This creative or Meta ad is already linked to the campaign." : error.message };

  await admin.from("audit_logs").insert({ actor_id: profile.id, action: "linked_incentive_creative", target_type: "ad", target_id: ad.id, metadata: { incentive_campaign_id: campaign.id, meta_ad_id: value.metaAdId } });
  revalidatePath("/incentives");
  return { ok: true };
}

export async function linkIncentiveCreatives(payload: z.input<typeof creativeBatchSchema>) {
  const profile = await requireProfile();
  const parsed = creativeBatchSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid creatives." };
  const { campaignId, creatives } = parsed.data;
  const uniqueAds = new Set(creatives.map((item) => item.adId));
  const uniqueMetaAds = new Set(creatives.map((item) => item.metaAdId));
  if (uniqueAds.size !== creatives.length) return { ok: false, message: "Each creative can only appear once in this batch." };
  if (uniqueMetaAds.size !== creatives.length) return { ok: false, message: "Each creative needs a different Meta ad ID." };

  const admin = createSupabaseAdminClient();
  const [{ data: campaign, error: campaignError }, { data: ads, error: adsError }] = await Promise.all([
    admin.from("incentive_campaigns").select("id,product_id,starts_on,ends_on,active").eq("id", campaignId).maybeSingle(),
    admin.from("ads").select("id,name,product_id,creator_id,editor_id").in("id", [...uniqueAds])
  ]);
  if (campaignError || !campaign) return { ok: false, message: campaignError?.message ?? "Campaign not found." };
  if (adsError) return { ok: false, message: adsError.message };
  if ((ads ?? []).length !== creatives.length) return { ok: false, message: "One or more creatives could not be found." };

  const reviewer = profile.role === "admin" || profile.role === "manager";
  for (const ad of ads ?? []) {
    if (!reviewer && ad.creator_id !== profile.id) return { ok: false, message: "You can only submit your own creatives." };
    if (ad.product_id !== campaign.product_id) return { ok: false, message: `“${ad.name}” does not match the campaign product.` };
  }
  for (const creative of creatives) {
    if (creative.launchedOn < campaign.starts_on || (campaign.ends_on && creative.launchedOn > campaign.ends_on)) {
      return { ok: false, message: "Every launch date must fall inside the campaign dates." };
    }
  }

  const adById = new Map((ads ?? []).map((ad) => [ad.id, ad]));
  const { error } = await admin.from("incentive_creatives").insert(creatives.map((creative) => {
    const ad = adById.get(creative.adId)!;
    return {
      incentive_campaign_id: campaignId,
      ad_id: creative.adId,
      meta_ad_id: creative.metaAdId,
      launched_on: creative.launchedOn,
      creator_id: ad.creator_id,
      editor_id: ad.editor_id,
      attribution_source: "manual",
      created_by: profile.id
    };
  }));
  if (error) return { ok: false, message: error.code === "23505" ? "A selected creative or Meta ad is already linked to this campaign." : error.message };

  await admin.from("audit_logs").insert({
    actor_id: profile.id,
    action: "linked_incentive_creatives",
    target_type: "incentive_campaign",
    target_id: campaignId,
    metadata: { count: creatives.length, ad_ids: creatives.map((item) => item.adId) }
  });
  revalidatePath("/incentives");
  return { ok: true, count: creatives.length };
}

export async function removeIncentiveCreative(id: string) {
  const profile = await requireRole(["admin", "manager"]);
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) return { ok: false, message: "Invalid tracking record." };
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("incentive_creatives").delete().eq("id", parsed.data);
  if (error) return { ok: false, message: error.message };
  await admin.from("audit_logs").insert({ actor_id: profile.id, action: "removed_incentive_creative", target_type: "incentive_creative", target_id: parsed.data, metadata: {} });
  revalidatePath("/incentives");
  return { ok: true };
}

export async function updateIncentiveDecision(payload: z.input<typeof decisionSchema>) {
  const profile = await requireRole(["admin", "manager"]);
  const parsed = decisionSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid decision." };
  const value = parsed.data;
  const admin = createSupabaseAdminClient();
  const { data: creative, error: creativeError } = await admin
    .from("incentive_creatives")
    .select("id")
    .eq("id", value.id)
    .maybeSingle();
  if (creativeError || !creative) return { ok: false, message: creativeError?.message ?? "Incentive creative not found." };
  const incentiveStatus = incentiveStatusForDecision(value.decisionStatus, value.payoutStatus);
  const { error } = await admin.from("incentive_creatives").update({ decision_status: value.decisionStatus, decision_source: "manual", decision_note: value.note || null, decided_at: new Date().toISOString(), decided_by: profile.id, payout_status: value.payoutStatus ?? "not_ready", incentive_status: incentiveStatus }).eq("id", value.id);
  if (error) return { ok: false, message: error.message };
  await admin.from("audit_logs").insert({ actor_id: profile.id, action: "updated_incentive_decision", target_type: "incentive_creative", target_id: value.id, metadata: value });
  revalidatePath("/incentives");
  return { ok: true };
}

export async function updateIncentiveDecisions(payload: z.input<typeof bulkDecisionSchema>) {
  const profile = await requireRole(["admin", "manager"]);
  const parsed = bulkDecisionSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid bulk decision." };

  const value = parsed.data;
  const ids = [...new Set(value.ids)];
  const admin = createSupabaseAdminClient();
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("incentive_creatives")
    .update({
      decision_status: value.decisionStatus,
      decision_source: "manual",
      decision_note: value.note || null,
      decided_at: now,
      decided_by: profile.id,
      payout_status: "not_ready",
      incentive_status: incentiveStatusForDecision(value.decisionStatus)
    })
    .in("id", ids)
    .select("id");
  if (error) return { ok: false, message: error.message };

  await admin.from("audit_logs").insert({
    actor_id: profile.id,
    action: "bulk_updated_incentive_decisions",
    target_type: "incentive_creative",
    target_id: ids[0],
    metadata: { count: data?.length ?? 0, decision_status: value.decisionStatus, note: value.note || null }
  });
  revalidatePath("/incentives");
  return { ok: true, count: data?.length ?? 0 };
}

export async function updateMetaAdOutcomes(payload: z.input<typeof metaAdOutcomeSchema>) {
  const profile = await requireRole(["admin", "manager"]);
  const parsed = metaAdOutcomeSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid ad outcome." };

  const value = parsed.data;
  const ids = [...new Set(value.ids)];
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("meta_ads")
    .update({
      manual_outcome: value.outcome,
      manual_outcome_at: value.outcome ? new Date().toISOString() : null,
      manual_outcome_by: value.outcome ? profile.id : null
    })
    .in("id", ids)
    .select("id");
  if (error) return { ok: false, message: error.message };

  await admin.from("audit_logs").insert({
    actor_id: profile.id,
    action: "updated_meta_ad_outcomes",
    target_type: "meta_ad",
    target_id: ids[0],
    metadata: { count: data?.length ?? 0, manual_outcome: value.outcome }
  });
  revalidatePath("/incentives");
  return { ok: true, count: data?.length ?? 0 };
}

const campaignDestinationSchema = z.object({
  campaignId: z.string().trim().min(1, "Campaign ID is required."),
  campaignName: z.string().trim().optional().or(z.literal("")),
  destination: z.string().trim().min(1, "Destination is required.")
});

export async function updateCampaignDestination(payload: z.input<typeof campaignDestinationSchema>) {
  await requireRole(["admin"]);
  const parsed = campaignDestinationSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid campaign destination." };

  const { campaignId, campaignName, destination } = parsed.data;
  const { saveCampaignDestinationRecord } = await import("@/lib/campaign-destinations");
  const profile = await requireProfile();

  saveCampaignDestinationRecord({
    campaignId,
    campaignName: campaignName || null,
    destination,
    updatedAt: new Date().toISOString(),
    updatedBy: profile.id
  });

  const admin = createSupabaseAdminClient();
  let outcome: "winner" | "loser" | "keep_testing" | null = null;
  if (destination === "winner" || destination === "winner_only" || destination.includes("winner")) outcome = "winner";
  else if (destination === "loser" || destination === "loser_only" || destination.includes("loser")) outcome = "loser";
  else if (destination === "testing" || destination === "testing_only" || destination.includes("testing")) outcome = "keep_testing";
  else outcome = null;

  const now = new Date().toISOString();
  await admin
    .from("meta_ads")
    .update({
      manual_outcome: outcome,
      manual_outcome_at: outcome ? now : null,
      manual_outcome_by: outcome ? profile.id : null
    })
    .eq("campaign_id", campaignId);

  await admin.from("audit_logs").insert({
    actor_id: profile.id,
    action: "updated_campaign_destination",
    target_type: "meta_campaign",
    target_id: campaignId,
    metadata: { campaign_name: campaignName, destination, manual_outcome: outcome }
  });

  revalidatePath("/incentives");
  return { ok: true, destination };
}
